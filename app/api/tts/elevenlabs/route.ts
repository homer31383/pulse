// Premium TTS: cost estimate (GET) and generate-or-fetch-cached audio (POST).
// The ElevenLabs key never leaves the server; the client gets a signed URL.
import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { supabase } from '@/lib/supabase'
import {
  ELEVENLABS_DEFAULT_MODEL,
  ELEVENLABS_DEFAULT_VOICE_ID,
  ELEVENLABS_MODELS,
  ELEVENLABS_VOICES,
  estimateTtsCost,
} from '@/lib/elevenlabs'
import {
  TtsNotConfiguredError,
  getCachedAudio,
  isTtsConfigured,
  listVoices,
  loadTtsItem,
  signedAudioUrl,
  synthesizeItem,
  type TtsKind,
} from '@/lib/tts'

const DEFAULT_PROFILE_ID = '00000000-0000-0000-0000-000000000001'
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const VOICE_RE = /^[A-Za-z0-9]{8,64}$/

async function resolveVoiceId(requested: string | null): Promise<string> {
  if (requested && VOICE_RE.test(requested)) return requested
  const cookieStore = await cookies()
  const profileId = cookieStore.get('profile_id')?.value ?? DEFAULT_PROFILE_ID
  const { data } = await supabase.from('settings').select('tts_elevenlabs_voice_id').eq('id', profileId).single()
  const fromSettings = data?.tts_elevenlabs_voice_id as string | null | undefined
  return fromSettings && VOICE_RE.test(fromSettings) ? fromSettings : ELEVENLABS_DEFAULT_VOICE_ID
}

function parseTarget(kind: string | null, id: string | null): { kind: TtsKind; id: string } | null {
  if ((kind !== 'briefing' && kind !== 'digest') || !id || !UUID_RE.test(id)) return null
  return { kind, id }
}

// Curated list first, then the account's live premade voices (the settings
// picker offers both), so a non-curated pick still shows its real name.
async function voiceName(voiceId: string): Promise<string> {
  const curated = ELEVENLABS_VOICES.find((v) => v.id === voiceId)
  if (curated) return curated.name
  const { voices } = await listVoices()
  return voices.find((v) => v.id === voiceId)?.name ?? 'Custom voice'
}

// GET /api/tts/elevenlabs?kind=briefing&id=<uuid>[&voiceId=…]
// → { configured, cached, chars, estimatedCost, model, modelLabel, voiceId, voiceName, audio? }
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const target = parseTarget(searchParams.get('kind'), searchParams.get('id'))
  if (!target) return NextResponse.json({ error: 'kind must be briefing|digest and id a UUID' }, { status: 400 })

  const [item, voiceId] = await Promise.all([loadTtsItem(target.kind, target.id), resolveVoiceId(searchParams.get('voiceId'))])
  if (!item) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const model = ELEVENLABS_DEFAULT_MODEL
  const cached = await getCachedAudio(item.kind, item.id, voiceId, model)
  const chars = item.plain.length

  return NextResponse.json({
    configured: isTtsConfigured(),
    cached: !!cached,
    chars,
    estimatedCost: estimateTtsCost(chars, model),
    model,
    modelLabel: ELEVENLABS_MODELS[model].label,
    voiceId,
    voiceName: await voiceName(voiceId),
    audio: cached
      ? {
          url: await signedAudioUrl(cached.storage_path),
          sentences: cached.sentences,
          sentenceTimes: cached.sentence_times,
          duration: cached.duration_seconds,
        }
      : null,
  })
}

// POST /api/tts/elevenlabs { kind, id, voiceId? }
// → { cached, cost, chars, chunks, audio: { url, sentences, sentenceTimes, duration } }
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as { kind?: string; id?: string; voiceId?: string }
  const target = parseTarget(body.kind ?? null, body.id ?? null)
  if (!target) return NextResponse.json({ error: 'kind must be briefing|digest and id a UUID' }, { status: 400 })
  if (!isTtsConfigured()) {
    return NextResponse.json({ error: 'ElevenLabs is not configured — set ELEVENLABS_API_KEY' }, { status: 503 })
  }

  const [item, voiceId] = await Promise.all([loadTtsItem(target.kind, target.id), resolveVoiceId(body.voiceId ?? null)])
  if (!item) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (item.plain.trim().length === 0) return NextResponse.json({ error: 'Nothing to read' }, { status: 400 })

  try {
    const { row, url, cached } = await synthesizeItem({ item, voiceId })
    return NextResponse.json({
      cached,
      cost: cached ? 0 : row.cost_usd,
      chars: row.char_count,
      chunks: row.chunk_count,
      audio: { url, sentences: row.sentences, sentenceTimes: row.sentence_times, duration: row.duration_seconds },
    })
  } catch (err) {
    if (err instanceof TtsNotConfiguredError) return NextResponse.json({ error: err.message }, { status: 503 })
    const message = err instanceof Error ? err.message : 'Audio generation failed'
    console.error('[tts] generation failed:', message)
    return NextResponse.json({ error: message }, { status: 502 })
  }
}

export const maxDuration = 120
