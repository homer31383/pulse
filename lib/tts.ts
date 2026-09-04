// Server-only: ElevenLabs synthesis, the per-briefing audio cache in Supabase
// Storage, and TTS spend logging. Never import in 'use client' files.
import { supabase } from '@/lib/supabase'
import { logUsage } from '@/lib/usage'
import { splitSentences, stripMarkdown } from '@/lib/speech'
import {
  ELEVENLABS_DEFAULT_MODEL,
  ELEVENLABS_MODELS,
  ELEVENLABS_OUTPUT_FORMAT,
  ELEVENLABS_VOICES,
  chunkText,
  estimateTtsCost,
  type ElevenLabsModelId,
  type ElevenLabsVoice,
} from '@/lib/elevenlabs'

export const TTS_BUCKET = 'tts-audio'
export type TtsKind = 'briefing' | 'digest'

const SIGNED_URL_TTL_S = 3600

export class TtsNotConfiguredError extends Error {
  constructor() {
    super('ElevenLabs is not configured — set ELEVENLABS_API_KEY')
    this.name = 'TtsNotConfiguredError'
  }
}

function apiKey(): string {
  const key = process.env.ELEVENLABS_API_KEY
  if (!key) throw new TtsNotConfiguredError()
  return key
}

export function isTtsConfigured(): boolean {
  return !!process.env.ELEVENLABS_API_KEY
}

// ── Item text ─────────────────────────────────────────────────────────────────

export interface TtsItem {
  kind: TtsKind
  id: string
  plain: string        // stripMarkdown(content) — the text that gets spoken
  channelId: string | null
  channelName: string
}

export async function loadTtsItem(kind: TtsKind, id: string): Promise<TtsItem | null> {
  if (kind === 'briefing') {
    const { data } = await supabase
      .from('briefings')
      .select('id, content, channel_id, channels(name)')
      .eq('id', id)
      .single()
    if (!data) return null
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const channel = (data as any).channels as { name?: string } | { name?: string }[] | null
    const channelName = (Array.isArray(channel) ? channel[0]?.name : channel?.name) ?? 'Briefing'
    return { kind, id, plain: stripMarkdown(data.content ?? ''), channelId: data.channel_id, channelName }
  }
  const { data } = await supabase.from('digests').select('id, content').eq('id', id).single()
  if (!data) return null
  return { kind, id, plain: stripMarkdown(data.content ?? ''), channelId: null, channelName: 'Digest' }
}

// ── Cache rows ────────────────────────────────────────────────────────────────

export interface TtsAudioRow {
  id: string
  kind: TtsKind
  item_id: string
  voice_id: string
  model_id: string
  storage_path: string
  char_count: number
  chunk_count: number
  duration_seconds: number | null
  cost_usd: number
  sentences: string[]
  sentence_times: number[]
  created_at: string
}

export async function getCachedAudio(
  kind: TtsKind, itemId: string, voiceId: string, modelId: ElevenLabsModelId,
): Promise<TtsAudioRow | null> {
  const { data } = await supabase
    .from('tts_audio')
    .select('*')
    .eq('kind', kind)
    .eq('item_id', itemId)
    .eq('voice_id', voiceId)
    .eq('model_id', modelId)
    .maybeSingle()
  return (data as TtsAudioRow | null) ?? null
}

// Playback URL: the app's own range-capable stream (app/api/tts/audio/[id]).
// Chrome's <audio> stalled on Supabase's signed-download URL; same-origin
// streaming with explicit Content-Length/Accept-Ranges plays and seeks.
export function audioUrlFor(row: { id: string }): string {
  return `/api/tts/audio/${row.id}`
}

// Direct signed URL (server-to-server use, e.g. tests)
export async function signedAudioUrl(storagePath: string): Promise<string> {
  const { data, error } = await supabase.storage.from(TTS_BUCKET).createSignedUrl(storagePath, SIGNED_URL_TTL_S)
  if (error || !data) throw new Error(`Could not sign audio URL: ${error?.message ?? 'unknown'}`)
  return data.signedUrl
}

let bucketReady = false
async function ensureBucket(): Promise<void> {
  if (bucketReady) return
  const { data: buckets } = await supabase.storage.listBuckets()
  if (!buckets?.some((b) => b.name === TTS_BUCKET)) {
    const { error } = await supabase.storage.createBucket(TTS_BUCKET, {
      public: false,
      allowedMimeTypes: ['audio/mpeg'],
      fileSizeLimit: 50 * 1024 * 1024,
    })
    // Another request may have created it first
    if (error && !/already exists/i.test(error.message)) throw new Error(`Could not create bucket: ${error.message}`)
  }
  bucketReady = true
}

// ── Synthesis ─────────────────────────────────────────────────────────────────

interface Alignment {
  characters: string[]
  character_start_times_seconds: number[]
  character_end_times_seconds: number[]
}

interface TimestampResponse {
  audio_base64: string
  alignment: Alignment | null
  normalized_alignment: Alignment | null
}

// Later chunks may carry an ID3 header; MP3 frames concatenate cleanly
// without it.
function stripId3(buf: Buffer): Buffer {
  if (buf.length < 10 || buf.toString('latin1', 0, 3) !== 'ID3') return buf
  const size = ((buf[6] & 0x7f) << 21) | ((buf[7] & 0x7f) << 14) | ((buf[8] & 0x7f) << 7) | (buf[9] & 0x7f)
  return buf.subarray(10 + size)
}

async function synthesizeChunk(opts: {
  text: string
  voiceId: string
  modelId: ElevenLabsModelId
  previousText?: string
  nextText?: string
  previousRequestIds: string[]
}): Promise<{ audio: Buffer; alignment: Alignment | null; requestId: string | null }> {
  const url = `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(opts.voiceId)}/with-timestamps?output_format=${ELEVENLABS_OUTPUT_FORMAT}`
  const body: Record<string, unknown> = {
    text: opts.text,
    model_id: opts.modelId,
    apply_text_normalization: 'auto',
  }
  // Request stitching: neighbouring text + prior request ids keep prosody
  // and voice consistent across the seams of a split job.
  if (opts.previousText) body.previous_text = opts.previousText
  if (opts.nextText) body.next_text = opts.nextText
  if (opts.previousRequestIds.length) body.previous_request_ids = opts.previousRequestIds.slice(-3)

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'xi-api-key': apiKey(), 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new Error(`ElevenLabs ${res.status}: ${detail.slice(0, 300) || res.statusText}`)
  }
  const json = (await res.json()) as TimestampResponse
  return {
    audio: stripId3(Buffer.from(json.audio_base64, 'base64')),
    alignment: json.alignment ?? json.normalized_alignment ?? null,
    requestId: res.headers.get('request-id'),
  }
}

export interface SynthesisResult {
  row: TtsAudioRow
  url: string
  cached: boolean
}

// Generate (or return cached) audio for an item. One object per
// (item, voice, model); the row carries the sentences and their start
// times so the client can highlight without estimating.
export async function synthesizeItem(opts: {
  item: TtsItem
  voiceId: string
  modelId?: ElevenLabsModelId
  // Test hook: force chunking below the model's real cap
  chunkCap?: number
}): Promise<SynthesisResult> {
  const modelId = opts.modelId ?? ELEVENLABS_DEFAULT_MODEL
  const { item, voiceId } = opts

  const cached = await getCachedAudio(item.kind, item.id, voiceId, modelId)
  if (cached) return { row: cached, url: audioUrlFor(cached), cached: true }

  apiKey() // fail fast before any work
  const chunks = chunkText(item.plain, opts.chunkCap ?? ELEVENLABS_MODELS[modelId].maxChars)
  const full = chunks.join('\n\n')
  const { sentences, starts } = splitSentences(full)

  // Char offset of each chunk within `full`
  const chunkStarts: number[] = []
  let cursor = 0
  for (const c of chunks) { chunkStarts.push(cursor); cursor += c.length + 2 }

  const buffers: Buffer[] = []
  const chunkTimeOffsets: number[] = []
  const alignments: (Alignment | null)[] = []
  const requestIds: string[] = []
  let timeOffset = 0
  for (let i = 0; i < chunks.length; i++) {
    const r = await synthesizeChunk({
      text: chunks[i],
      voiceId,
      modelId,
      previousText: i > 0 ? chunks[i - 1].slice(-1000) : undefined,
      nextText: i < chunks.length - 1 ? chunks[i + 1].slice(0, 1000) : undefined,
      previousRequestIds: requestIds,
    })
    buffers.push(r.audio)
    alignments.push(r.alignment)
    chunkTimeOffsets.push(timeOffset)
    if (r.requestId) requestIds.push(r.requestId)
    const ends = r.alignment?.character_end_times_seconds
    timeOffset += ends && ends.length ? ends[ends.length - 1] : 0
  }
  const duration = timeOffset

  // Sentence start times: locate each sentence's chunk, then its character
  // in that chunk's alignment (proportional fallback if lengths disagree).
  const sentenceTimes = starts.map((start) => {
    let ci = 0
    for (let i = 0; i < chunkStarts.length; i++) if (chunkStarts[i] <= start) ci = i
    const a = alignments[ci]
    const rel = start - chunkStarts[ci]
    if (!a || a.character_start_times_seconds.length === 0) return chunkTimeOffsets[ci]
    const n = a.character_start_times_seconds.length
    const idx = n === chunks[ci].length ? rel : Math.round((rel / Math.max(1, chunks[ci].length)) * n)
    const t = a.character_start_times_seconds[Math.min(Math.max(0, idx), n - 1)] ?? 0
    return Math.round((chunkTimeOffsets[ci] + t) * 100) / 100
  })

  await ensureBucket()
  const storagePath = `${item.kind}/${item.id}/${voiceId}.${modelId}.mp3`
  const { error: upErr } = await supabase.storage
    .from(TTS_BUCKET)
    .upload(storagePath, Buffer.concat(buffers), { contentType: 'audio/mpeg', upsert: true })
  if (upErr) throw new Error(`Audio upload failed: ${upErr.message}`)

  const charCount = full.length
  const costUsd = estimateTtsCost(charCount, modelId)
  const { data: row, error: rowErr } = await supabase
    .from('tts_audio')
    .upsert(
      {
        kind: item.kind,
        item_id: item.id,
        voice_id: voiceId,
        model_id: modelId,
        storage_path: storagePath,
        char_count: charCount,
        chunk_count: chunks.length,
        duration_seconds: Math.round(duration * 100) / 100,
        cost_usd: costUsd,
        sentences,
        sentence_times: sentenceTimes,
      },
      { onConflict: 'kind,item_id,voice_id,model_id' },
    )
    .select('*')
    .single()
  if (rowErr || !row) throw new Error(`Could not record audio: ${rowErr?.message ?? 'unknown'}`)

  console.log(
    `[tts] generated ${item.kind} ${item.id}: ${charCount} chars, ${chunks.length} chunk(s), ` +
    `${duration.toFixed(1)}s, ${modelId}, voice ${voiceId}, $${costUsd.toFixed(4)}`
  )
  logUsage({
    callType: 'tts',
    channelId: item.channelId ?? undefined,
    channelName: item.channelName,
    model: `elevenlabs/${modelId}`,
    inputTokens: charCount, // characters billed
    outputTokens: 0,
    costUsd,
  }).catch(() => {})

  return { row: row as TtsAudioRow, url: audioUrlFor(row as TtsAudioRow), cached: false }
}

// ── Cleanup ───────────────────────────────────────────────────────────────────

// Storage has no cascade: call this wherever briefings/digests are deleted.
export async function deleteTtsAudio(kind: TtsKind, itemIds: string[]): Promise<void> {
  if (itemIds.length === 0) return
  const { data } = await supabase
    .from('tts_audio')
    .select('id, storage_path')
    .eq('kind', kind)
    .in('item_id', itemIds)
  const rows = (data ?? []) as { id: string; storage_path: string }[]
  if (rows.length === 0) return
  await supabase.storage.from(TTS_BUCKET).remove(rows.map((r) => r.storage_path))
  await supabase.from('tts_audio').delete().in('id', rows.map((r) => r.id))
}

// ── Voices ────────────────────────────────────────────────────────────────────

let voiceCache: { at: number; voices: ElevenLabsVoice[] } | null = null

// Curated list first, then the account's other premade voices when the key
// is configured (cached in-process for an hour).
export async function listVoices(): Promise<{ configured: boolean; voices: ElevenLabsVoice[] }> {
  if (!isTtsConfigured()) return { configured: false, voices: ELEVENLABS_VOICES }
  if (voiceCache && Date.now() - voiceCache.at < 3_600_000) return { configured: true, voices: voiceCache.voices }
  try {
    const res = await fetch('https://api.elevenlabs.io/v1/voices', { headers: { 'xi-api-key': apiKey() } })
    if (!res.ok) throw new Error(`ElevenLabs ${res.status}`)
    const json = (await res.json()) as {
      voices?: { voice_id: string; name: string; category?: string; labels?: Record<string, string> }[]
    }
    const curatedIds = new Set(ELEVENLABS_VOICES.map((v) => v.id))
    const extra: ElevenLabsVoice[] = (json.voices ?? [])
      .filter((v) => v.category === 'premade' && !curatedIds.has(v.voice_id))
      .map((v) => ({
        id: v.voice_id,
        name: v.name,
        description: [v.labels?.accent, v.labels?.description ?? v.labels?.descriptive, v.labels?.use_case ?? v.labels?.['use case']]
          .filter(Boolean)
          .join(' · '),
      }))
      .slice(0, 24)
    const voices = [...ELEVENLABS_VOICES, ...extra]
    voiceCache = { at: Date.now(), voices }
    return { configured: true, voices }
  } catch (err) {
    console.warn('[tts] voice list fetch failed, using curated list:', (err as Error).message)
    return { configured: true, voices: ELEVENLABS_VOICES }
  }
}
