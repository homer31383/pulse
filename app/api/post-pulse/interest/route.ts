import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { fetchPostPulseDataset } from '@/lib/post-pulse'
import { fetchInterestState, isUuid, setInterest, setStarredCollapsed } from '@/lib/post-pulse-interest'
import { PP_INTEREST_TARGETS, type PpInterestTarget } from '@/lib/post-pulse-interest-types'

export const dynamic = 'force-dynamic'

// Post-Pulse stars for the cookie profile (migration 038, pp_interest).
//   GET                                   → the profile's stars + pending proposal info (runs the lazy cleanup)
//   POST  {targetType, targetId, starred} → star / unstar one tool, department or pending proposal
//   PATCH {collapsed}                     → "Your starred" collapsed state on the landing page
// Writes only pp_interest (and the one settings column); never the dataset,
// the changelog, the queue, read marks, audio, or any model.
const DEFAULT_PROFILE_ID = '00000000-0000-0000-0000-000000000001'

async function profileId(): Promise<string | null> {
  const id = (await cookies()).get('profile_id')?.value ?? DEFAULT_PROFILE_ID
  return isUuid(id) ? id : null
}

export async function GET() {
  const pid = await profileId()
  if (!pid) return NextResponse.json({ error: 'Unknown profile' }, { status: 400 })
  try {
    const dataset = await fetchPostPulseDataset()
    return NextResponse.json(await fetchInterestState(pid, dataset), { headers: { 'Cache-Control': 'no-store' } })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Failed' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const pid = await profileId()
  if (!pid) return NextResponse.json({ error: 'Unknown profile' }, { status: 400 })
  const body = (await req.json().catch(() => null)) as { targetType?: unknown; targetId?: unknown; starred?: unknown } | null
  if (!body || !PP_INTEREST_TARGETS.includes(body.targetType as PpInterestTarget)) {
    return NextResponse.json({ error: "targetType must be 'tool', 'department' or 'queue_item'" }, { status: 400 })
  }
  if (!isUuid(body.targetId)) return NextResponse.json({ error: 'targetId must be a uuid' }, { status: 400 })
  if (typeof body.starred !== 'boolean') return NextResponse.json({ error: 'starred must be a boolean' }, { status: 400 })
  try {
    const dataset = await fetchPostPulseDataset()
    const result = await setInterest(pid, body.targetType as PpInterestTarget, body.targetId, body.starred, dataset)
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
    return NextResponse.json(result)
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Failed' }, { status: 500 })
  }
}

export async function PATCH(req: NextRequest) {
  const pid = await profileId()
  if (!pid) return NextResponse.json({ error: 'Unknown profile' }, { status: 400 })
  const body = (await req.json().catch(() => ({}))) as { collapsed?: unknown }
  if (typeof body.collapsed !== 'boolean') return NextResponse.json({ error: 'collapsed must be a boolean' }, { status: 400 })
  try {
    await setStarredCollapsed(pid, body.collapsed)
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Failed' }, { status: 500 })
  }
}
