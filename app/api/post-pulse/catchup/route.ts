import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { supabase } from '@/lib/supabase'

// Post-Pulse catch-up panel state for the current profile (cookie-scoped).
//   PATCH {collapsed} → remember the panel's collapsed state across devices.
// Collapsing is not a dismiss: it never touches post_pulse_last_seen.
const DEFAULT_PROFILE_ID = '00000000-0000-0000-0000-000000000001'

export async function PATCH(req: NextRequest) {
  const profileId = (await cookies()).get('profile_id')?.value ?? DEFAULT_PROFILE_ID
  const body = (await req.json().catch(() => ({}))) as { collapsed?: unknown }
  if (typeof body.collapsed !== 'boolean') {
    return NextResponse.json({ error: 'collapsed must be a boolean' }, { status: 400 })
  }
  const { error } = await supabase
    .from('settings')
    .update({ post_pulse_catchup_collapsed: body.collapsed })
    .eq('id', profileId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
