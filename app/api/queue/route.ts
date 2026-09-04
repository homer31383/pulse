// Listen Queue: GET list (+ cost summary), POST add, PATCH reorder.
import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { supabase } from '@/lib/supabase'
import { enqueue, listQueue, reorderQueue } from '@/lib/queue'
import type { TtsProvider } from '@/lib/types'

const DEFAULT_PROFILE_ID = '00000000-0000-0000-0000-000000000001'
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

async function profileIdFromCookie(): Promise<string> {
  const cookieStore = await cookies()
  return cookieStore.get('profile_id')?.value ?? DEFAULT_PROFILE_ID
}

export async function GET() {
  const profileId = await profileIdFromCookie()
  const { data: settings } = await supabase
    .from('settings')
    .select('tts_provider, tts_elevenlabs_voice_id')
    .eq('id', profileId)
    .maybeSingle()
  const provider: TtsProvider = settings?.tts_provider === 'elevenlabs' ? 'elevenlabs' : 'browser'
  const result = await listQueue(profileId, { provider, voiceId: settings?.tts_elevenlabs_voice_id ?? null })
  return NextResponse.json(result)
}

export async function POST(req: NextRequest) {
  const profileId = await profileIdFromCookie()
  const body = (await req.json().catch(() => ({}))) as { kind?: string; itemId?: string }
  if ((body.kind !== 'briefing' && body.kind !== 'digest') || !body.itemId || !UUID_RE.test(body.itemId)) {
    return NextResponse.json({ error: 'kind must be briefing|digest and itemId a UUID' }, { status: 400 })
  }
  const row = await enqueue(profileId, body.kind, body.itemId, 'manual')
  return NextResponse.json({ ok: true, id: row?.id ?? null })
}

export async function PATCH(req: NextRequest) {
  const profileId = await profileIdFromCookie()
  const body = (await req.json().catch(() => ({}))) as { orderedIds?: string[] }
  if (!Array.isArray(body.orderedIds) || body.orderedIds.some((id) => !UUID_RE.test(id))) {
    return NextResponse.json({ error: 'orderedIds must be an array of UUIDs' }, { status: 400 })
  }
  await reorderQueue(profileId, body.orderedIds)
  return NextResponse.json({ ok: true })
}
