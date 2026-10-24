import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { supabase } from '@/lib/supabase'

// POST {through} — the catch-up panel's "Mark all as seen", the ONLY writer
// of post_pulse_last_seen (leaving, reloading, closing the tab and collapsing
// never advance it). `through` is the panel's snapshotAt, not "now", so
// content that landed after the page rendered stays in the panel.
// Forward-only (a stale tab can't move the stamp back) and clamped to now.
const DEFAULT_PROFILE_ID = '00000000-0000-0000-0000-000000000001'

export async function POST(req: NextRequest) {
  const profileId = (await cookies()).get('profile_id')?.value ?? DEFAULT_PROFILE_ID
  const body = (await req.json().catch(() => ({}))) as { through?: unknown }
  let through = new Date(String(body.through))
  if (typeof body.through !== 'string' || Number.isNaN(through.getTime())) {
    return NextResponse.json({ error: 'through must be an ISO timestamp' }, { status: 400 })
  }
  const now = new Date()
  if (through > now) through = now
  const iso = through.toISOString()

  const { data, error } = await supabase
    .from('settings')
    .update({ post_pulse_last_seen: iso })
    .eq('id', profileId)
    .or(`post_pulse_last_seen.is.null,post_pulse_last_seen.lt."${iso}"`)
    .select('id')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, advanced: (data ?? []).length > 0, through: iso })
}
