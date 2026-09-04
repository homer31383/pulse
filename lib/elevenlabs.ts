// Client-safe ElevenLabs constants and pure helpers (no secrets, no Supabase).
// Server-side synthesis and caching live in lib/tts.ts.

export type ElevenLabsModelId = 'eleven_flash_v2_5' | 'eleven_multilingual_v2' | 'eleven_v3'

export interface ElevenLabsModel {
  label: string
  // Per-request input cap. Flash's 40k means a briefing is one request in
  // practice; v3's 5k means every briefing is chunked.
  maxChars: number
  // Effective API price (elevenlabs.io/pricing/api, Sept 2026)
  usdPer1kChars: number
}

export const ELEVENLABS_MODELS: Record<ElevenLabsModelId, ElevenLabsModel> = {
  eleven_flash_v2_5:      { label: 'Flash v2.5',      maxChars: 40_000, usdPer1kChars: 0.05 },
  eleven_multilingual_v2: { label: 'Multilingual v2', maxChars: 10_000, usdPer1kChars: 0.10 },
  eleven_v3:              { label: 'Eleven v3',       maxChars: 5_000,  usdPer1kChars: 0.10 },
}

// Flash: half the price, one request per briefing, delivery a touch flatter
// than v2. Swap here (per-model chunking kicks in automatically).
export const ELEVENLABS_DEFAULT_MODEL: ElevenLabsModelId = 'eleven_flash_v2_5'

// 64 kbps mono is plenty for speech and keeps a 9-minute briefing near 4 MB
// (the free Storage tier is 1 GB).
export const ELEVENLABS_OUTPUT_FORMAT = 'mp3_44100_64'

export interface ElevenLabsVoice {
  id: string
  name: string
  description: string
}

// Curated premade voices — verified against the account's /v1/voices list on
// 2026-09-04 (Rachel, the old default, is no longer a premade voice and the
// free tier can't use library voices via the API). Names/descriptions follow
// ElevenLabs' current labels. The settings picker merges in the account's
// other premade voices when the API key is configured.
export const ELEVENLABS_VOICES: ElevenLabsVoice[] = [
  { id: 'onwK4e9ZLuTAKqWW03F9', name: 'Daniel',  description: 'Steady British broadcaster — the classic news read' },
  { id: 'JBFqnCBsd6RMkjVDRZzb', name: 'George',  description: 'Warm, captivating British storyteller' },
  { id: 'EXAVITQu4vr4xnSDxMaL', name: 'Sarah',   description: 'Mature, reassuring American voice' },
  { id: 'Xb7hH8MSUJpSbSDYk0k2', name: 'Alice',   description: 'Clear, engaging British educator' },
  { id: 'nPczCjzI2devNBz1zQrb', name: 'Brian',   description: 'Deep, resonant, comforting American narrator' },
  { id: 'XrExE9yKIg1WjnnlVkGX', name: 'Matilda', description: 'Knowledgeable, professional American voice' },
]

export const ELEVENLABS_DEFAULT_VOICE_ID = ELEVENLABS_VOICES[0].id

export function estimateTtsCost(chars: number, model: ElevenLabsModelId = ELEVENLABS_DEFAULT_MODEL): number {
  return (chars / 1000) * ELEVENLABS_MODELS[model].usdPer1kChars
}

export function formatTtsCost(usd: number): string {
  return usd < 0.01 ? '<$0.01' : `$${usd.toFixed(2)}`
}

// ── Chunking ──────────────────────────────────────────────────────────────────
//
// Split plain text into pieces under `maxChars` for models whose cap is below
// the briefing length. Rules that matter for audio quality:
//   - split at paragraph breaks first; a paragraph that alone exceeds the cap
//     falls back to sentence boundaries; a single oversize sentence is cut hard
//   - balance the chunks (minimise the largest one for the fewest chunks that
//     fit) rather than fill greedily, so there's never a tiny tail chunk —
//     voice consistency is per request and a 200-char final chunk audibly
//     differs from the rest
// Chunks are re-joined with a blank line, so `chunks.join('\n\n')` is the
// canonical text the timings refer to.
export function chunkText(text: string, maxChars: number, safetyMargin = 200): string[] {
  const cap = Math.max(500, maxChars - safetyMargin)
  const trimmed = text.trim()
  if (trimmed.length <= cap) return [trimmed]

  const pieces: string[] = []
  for (const para of trimmed.split(/\n{2,}/)) {
    const p = para.trim()
    if (!p) continue
    if (p.length <= cap) { pieces.push(p); continue }
    // Oversize paragraph → sentences (hard-cut any single oversize sentence)
    for (const s of splitIntoSentences(p)) {
      if (s.length <= cap) pieces.push(s)
      else for (let i = 0; i < s.length; i += cap) pieces.push(s.slice(i, i + cap))
    }
  }
  if (pieces.length === 0) return [trimmed]

  const total = pieces.reduce((n, p) => n + p.length, 0) + (pieces.length - 1) * 2
  const minChunks = Math.max(1, Math.ceil(total / cap))
  for (let k = minChunks; k <= pieces.length; k++) {
    const parts = balancedPartition(pieces, k)
    if (parts && parts.every((c) => c.length <= cap)) return parts
  }
  return pieces // every piece is ≤ cap, so this always fits
}

// Contiguous partition of `pieces` into exactly `k` chunks minimising the
// largest chunk (classic linear-partition DP; ~100 pieces × ~10 chunks).
function balancedPartition(pieces: string[], k: number): string[] | null {
  const n = pieces.length
  if (k > n) return null
  // prefix[i] = chars of pieces[0..i) joined with '\n\n'
  const prefix = [0]
  for (let i = 0; i < n; i++) prefix.push(prefix[i] + pieces[i].length + (i > 0 ? 2 : 0))
  const span = (a: number, b: number) => prefix[b] - prefix[a] - (a > 0 ? 2 : 0) // chars of pieces[a..b)

  const INF = Number.POSITIVE_INFINITY
  // dp[j][i]: min possible largest chunk using j chunks for pieces[0..i)
  const dp: number[][] = Array.from({ length: k + 1 }, () => new Array<number>(n + 1).fill(INF))
  const cut: number[][] = Array.from({ length: k + 1 }, () => new Array<number>(n + 1).fill(0))
  for (let i = 1; i <= n; i++) dp[1][i] = span(0, i)
  for (let j = 2; j <= k; j++) {
    for (let i = j; i <= n; i++) {
      for (let m = j - 1; m < i; m++) {
        const worst = Math.max(dp[j - 1][m], span(m, i))
        if (worst < dp[j][i]) { dp[j][i] = worst; cut[j][i] = m }
      }
    }
  }
  if (dp[k][n] === INF) return null

  const bounds: number[] = [n]
  let i = n
  for (let j = k; j > 1; j--) { i = cut[j][i]; bounds.push(i) }
  bounds.push(0)
  bounds.reverse()
  const chunks: string[] = []
  for (let b = 0; b < bounds.length - 1; b++) chunks.push(pieces.slice(bounds[b], bounds[b + 1]).join('\n\n'))
  return chunks
}

// Sentence split used only for oversize paragraphs (kept local so this file
// stays dependency-free for the client bundle).
function splitIntoSentences(text: string): string[] {
  const out: string[] = []
  const re = /[^.!?]+[.!?]+(?:\s+|$)|[^.!?]+$/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    const s = m[0].trim()
    if (s) out.push(s)
  }
  return out.length ? out : [text]
}
