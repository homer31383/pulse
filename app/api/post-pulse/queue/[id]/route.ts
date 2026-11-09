import { NextRequest } from 'next/server'
import { acceptQueueItem, fetchPostPulseDataset, rejectQueueItem, reopenQueueItem } from '@/lib/post-pulse'
import { carryStarsAfterAccept, keepGroupStarAfterDismiss, snapshotQueueStars, type AcceptStarSnapshot } from '@/lib/post-pulse-interest'

interface RouteContext {
  params: Promise<{ id: string }>
}

// PATCH { action: 'accept' | 'reject' | 'reopen' }
// Accept applies the proposal to pp_tools and writes pp_changelog rows;
// reject only resolves the queue row. Reopen is the dismiss undo: it puts a
// row rejected in the last 60 s back to pending (409 otherwise, or when
// another pending item already covers the same target).
//
// Stars (migration 038) ride along as separate steps that only touch
// pp_interest, around the unchanged accept/reject functions: before accept,
// note which profiles starred the proposal's group; after a successful
// accept, star the resulting tool or department for them and drop the
// proposal's star rows; after a dismiss, keep the group starred through
// another pending copy. A failure there is logged and never fails the
// request (accept has already happened); the stars listing's cleanup
// (reconcileInterest) converts any leftover star on an accepted proposal.
export async function PATCH(req: NextRequest, { params }: RouteContext) {
  const { id } = await params
  let action: unknown
  try {
    ;({ action } = await req.json())
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  if (action !== 'accept' && action !== 'reject' && action !== 'reopen') {
    return Response.json({ error: "action must be 'accept', 'reject' or 'reopen'" }, { status: 400 })
  }

  let snap: AcceptStarSnapshot | null = null
  if (action === 'accept') {
    try {
      snap = await snapshotQueueStars(id, await fetchPostPulseDataset())
    } catch (err) {
      console.warn(`[interest] star snapshot before accept ${id} failed: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  const result =
    action === 'accept' ? await acceptQueueItem(id) : action === 'reject' ? await rejectQueueItem(id) : await reopenQueueItem(id)
  if (!result.ok) return Response.json({ error: result.error }, { status: result.status })

  try {
    if (action === 'accept' && snap) {
      const n = await carryStarsAfterAccept(snap, result)
      if (n) console.log(`[interest] accept ${id}: star carried to ${result.targetType} for ${n} profile(s)`)
    } else if (action === 'reject') {
      const n = await keepGroupStarAfterDismiss(id, await fetchPostPulseDataset())
      if (n) console.log(`[interest] dismiss ${id}: group star kept on another copy for ${n} profile(s)`)
    }
  } catch (err) {
    console.warn(`[interest] ${action} ${id}: star step failed: ${err instanceof Error ? err.message : String(err)}`)
  }
  return Response.json(result)
}
