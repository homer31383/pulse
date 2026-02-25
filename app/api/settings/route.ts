import { NextRequest } from 'next/server'
import { cookies } from 'next/headers'
import { supabase } from '@/lib/supabase'
import type { AppSettings } from '@/lib/types'

const DEFAULT_PROFILE_ID = '00000000-0000-0000-0000-000000000001'

async function getProfileId(): Promise<string> {
  const cookieStore = await cookies()
  return cookieStore.get('profile_id')?.value ?? DEFAULT_PROFILE_ID
}

export const SETTINGS_DEFAULTS: AppSettings = {
  model: 'claude-sonnet-4-6',
  briefing_density: 'balanced',
  digest_mode: false,
  highlights_enabled: false,
  sharing_enabled: false,
  feedback_enabled: false,
  cross_channel_enabled: false,
  watchlist_enabled: false,
  watchlist_terms: [],
  email_enabled: false,
  email_address: null,
  notifications_enabled: false,
  notification_time: '08:00',
  discuss_enabled: false,
  briefing_retention_days: null,
  tts_enabled: false,
  tts_voice: null,
  tts_speed: 1,
}

// Whitelist of columns that PATCH is allowed to modify
const ALLOWED_FIELDS = [
  'model', 'briefing_density',
  'digest_mode', 'highlights_enabled', 'sharing_enabled',
  'feedback_enabled', 'cross_channel_enabled',
  'watchlist_enabled', 'watchlist_terms',
  'email_enabled', 'email_address',
  'notifications_enabled', 'notification_time',
  'discuss_enabled',
  'briefing_retention_days',
  'tts_enabled', 'tts_voice', 'tts_speed',
] as const

export async function GET() {
  const profileId = await getProfileId()

  const { data } = await supabase
    .from('settings')
    .select('*')
    .eq('id', profileId)
    .single()

  return Response.json(data ?? SETTINGS_DEFAULTS)
}

export async function PATCH(req: NextRequest) {
  const profileId = await getProfileId()
  const body = await req.json()

  const updates: Record<string, unknown> = {}
  for (const field of ALLOWED_FIELDS) {
    if (body[field] !== undefined) {
      updates[field] = body[field]
    }
  }

  if (Object.keys(updates).length === 0) {
    return Response.json({ error: 'Nothing to update' }, { status: 400 })
  }

  const { error } = await supabase
    .from('settings')
    .upsert(
      { id: profileId, ...updates, updated_at: new Date().toISOString() },
      { onConflict: 'id' }
    )

  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ ok: true })
}
