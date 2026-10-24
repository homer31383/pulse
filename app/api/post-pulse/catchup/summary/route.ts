import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { summarizeCatchup } from '@/lib/post-pulse-catchup-summary'

// POST {until} — the catch-up panel's "Summarize": one model call (no web
// search, effort low) over the items in (post_pulse_last_seen, until], where
// `until` is the panel's snapshotAt so the summary covers exactly what was
// shown. Returns the cached summary when the item set hasn't changed.
export const maxDuration = 120

const DEFAULT_PROFILE_ID = '00000000-0000-0000-0000-000000000001'

export async function POST(req: NextRequest) {
  const profileId = (await cookies()).get('profile_id')?.value ?? DEFAULT_PROFILE_ID
  const body = (await req.json().catch(() => ({}))) as { until?: unknown }
  const until = new Date(String(body.until))
  if (typeof body.until !== 'string' || Number.isNaN(until.getTime())) {
    return NextResponse.json({ error: 'until must be an ISO timestamp' }, { status: 400 })
  }
  const now = new Date()
  try {
    const result = await summarizeCatchup(profileId, until > now ? now : until)
    if ('empty' in result) return NextResponse.json({ error: 'Nothing new to summarize.' }, { status: 409 })
    return NextResponse.json(result)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`[catchup] summary failed: ${message}`)
    return NextResponse.json({ error: message }, { status: 502 })
  }
}
