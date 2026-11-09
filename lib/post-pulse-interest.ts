// Post-Pulse stars, server-only (migration 038, table pp_interest).
//
// Per-profile marks on the shared pp_* dataset. Every read and write goes
// through the routes under /api/post-pulse/interest (cookie profile) and the
// Post-Pulse layout. Nothing here touches pp_tools, pp_departments,
// pp_changelog, pp_queue, read marks, the listen queue, the seen stamps or
// any model: it only reads those tables to validate targets.
//
// Lifecycle of a proposal star (target_type 'queue_item'):
// - accept: the PATCH queue route runs carryStarsAfterAccept() right after
//   acceptQueueItem() succeeds (accept itself is unchanged). Every profile
//   that starred any pending member of the accepted proposal's group gets
//   the resulting tool or department starred; the proposal's own star rows
//   are deleted.
// - dismiss: the star rows stay, so the 60 s undo (reopen) restores them.
//   keepGroupStarAfterDismiss() re-homes the star onto another pending member
//   of the same group, if any, so dismissing one copy of a duplicate doesn't
//   unstar the thing itself.
// - reconcileInterest() is the lazy cleanup and the safety net. It runs at
//   the start of fetchInterestState(), i.e. on every Post-Pulse page render
//   (app/post-pulse/layout.tsx, including router.refresh() after a queue
//   action) and on GET /api/post-pulse/interest. It deletes stars on
//   proposals rejected more than PP_INTEREST_DISMISS_GRACE_MS ago or no
//   longer in pp_queue, and converts stars on accepted proposals to their
//   tool or department (in case the post-accept step failed).

import { supabase } from './supabase'
import { fetchPendingQueue, type QueueResolution } from './post-pulse'
import type { PpDataset, PpQueueItem } from './post-pulse-types'
import {
  PP_INTEREST_DISMISS_GRACE_MS,
  pendingStarInfo,
  queueGroupKey,
  type PpInterestState,
  type PpInterestTarget,
} from './post-pulse-interest-types'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const CONFLICT = 'profile_id,target_type,target_id'

export function isUuid(v: unknown): v is string {
  return typeof v === 'string' && UUID_RE.test(v)
}

async function upsertStars(rows: { profile_id: string; target_type: PpInterestTarget; target_id: string }[]) {
  if (!rows.length) return
  const { error } = await supabase
    .from('pp_interest')
    .upsert(rows.map((r) => ({ ...r, level: 'starred' })), { onConflict: CONFLICT, ignoreDuplicates: true })
  if (error) throw new Error(`pp_interest: ${error.message}`)
}

// ── Lazy cleanup + safety net ───────────────────────────────────────────────

export async function reconcileInterest(now = Date.now()): Promise<void> {
  const { data: stars, error } = await supabase
    .from('pp_interest')
    .select('id, profile_id, target_id')
    .eq('target_type', 'queue_item')
  if (error) throw new Error(`pp_interest: ${error.message}`)
  if (!stars?.length) return

  const ids = [...new Set(stars.map((s) => s.target_id as string))]
  const { data: rows, error: qErr } = await supabase
    .from('pp_queue')
    .select('id, status, resolved_at, target_type, proposed_tool_id, proposed_department_id')
    .in('id', ids)
  if (qErr) throw new Error(`pp_queue: ${qErr.message}`)
  const byId = new Map((rows ?? []).map((r) => [r.id as string, r]))

  const drop: string[] = []
  const convert: { profile_id: string; target_type: PpInterestTarget; target_id: string }[] = []
  for (const s of stars) {
    const q = byId.get(s.target_id)
    if (!q) {
      drop.push(s.id)
    } else if (q.status === 'accepted') {
      const isDept = q.target_type === 'department'
      const tid = (isDept ? q.proposed_department_id : q.proposed_tool_id) as string | null
      if (tid) convert.push({ profile_id: s.profile_id, target_type: isDept ? 'department' : 'tool', target_id: tid })
      drop.push(s.id)
    } else if (q.status === 'rejected') {
      const at = q.resolved_at ? Date.parse(q.resolved_at as string) : 0
      if (now - at > PP_INTEREST_DISMISS_GRACE_MS) drop.push(s.id)
    }
  }
  await upsertStars(convert)
  if (drop.length) {
    const { error: delErr } = await supabase.from('pp_interest').delete().in('id', drop)
    if (delErr) throw new Error(`pp_interest: ${delErr.message}`)
    console.log(`[interest] cleanup: ${drop.length} proposal star(s) removed, ${convert.length} carried to a tool or department`)
  }
}

// ── Reads ──────────────────────────────────────────────────────────────────

export async function fetchInterestState(profileId: string, dataset: Pick<PpDataset, 'tools' | 'departments'>): Promise<PpInterestState> {
  try {
    await reconcileInterest()
  } catch (err) {
    // Cleanup is best effort; the listing below hides non-pending stars anyway
    console.warn(`[interest] cleanup skipped: ${err instanceof Error ? err.message : String(err)}`)
  }
  const [starsRes, pending, settingsRes] = await Promise.all([
    supabase.from('pp_interest').select('target_type, target_id').eq('profile_id', profileId),
    fetchPendingQueue(),
    supabase.from('settings').select('post_pulse_starred_collapsed').eq('id', profileId).maybeSingle(),
  ])
  if (starsRes.error) throw new Error(`pp_interest: ${starsRes.error.message}`)
  const stars = starsRes.data ?? []
  const pendingIds = new Set(pending.map((p) => p.id))
  const toolIds = new Set(dataset.tools.map((t) => t.id))
  const deptIds = new Set(dataset.departments.map((d) => d.id))
  const of = (type: PpInterestTarget) => stars.filter((s) => s.target_type === type).map((s) => s.target_id as string)
  return {
    tools: of('tool').filter((id) => toolIds.has(id)),
    departments: of('department').filter((id) => deptIds.has(id)),
    // A dismissed proposal keeps its star row for the undo window, hidden here
    queueItems: of('queue_item').filter((id) => pendingIds.has(id)),
    pending: pending.map((p) => pendingStarInfo(p, dataset)),
    collapsed: settingsRes.error ? false : !!settingsRes.data?.post_pulse_starred_collapsed,
  }
}

// ── Writes (one profile) ───────────────────────────────────────────────────

export type InterestWriteResult =
  | { ok: true; queueItemsCleared: string[] }
  | { ok: false; status: number; error: string }

// Star or unstar one target for one profile. The target must exist (a tool,
// a department, or a PENDING proposal to star). Unstarring a proposal clears
// the star rows of every pending member of its group, so the whole group
// agrees; starring writes one row (the group shows starred from it).
export async function setInterest(
  profileId: string,
  targetType: PpInterestTarget,
  targetId: string,
  starred: boolean,
  dataset: Pick<PpDataset, 'tools' | 'departments'>,
): Promise<InterestWriteResult> {
  if (targetType === 'tool' && !dataset.tools.some((t) => t.id === targetId)) {
    return { ok: false, status: 404, error: 'No tracked tool with that id' }
  }
  if (targetType === 'department' && !dataset.departments.some((d) => d.id === targetId)) {
    return { ok: false, status: 404, error: 'No department with that id' }
  }

  if (targetType !== 'queue_item') {
    if (starred) {
      await upsertStars([{ profile_id: profileId, target_type: targetType, target_id: targetId }])
    } else {
      const { error } = await supabase
        .from('pp_interest')
        .delete()
        .eq('profile_id', profileId)
        .eq('target_type', targetType)
        .eq('target_id', targetId)
      if (error) throw new Error(`pp_interest: ${error.message}`)
    }
    return { ok: true, queueItemsCleared: [] }
  }

  const pending = await fetchPendingQueue()
  const item = pending.find((p) => p.id === targetId)
  if (starred) {
    if (!item) return { ok: false, status: 404, error: 'No pending proposal with that id' }
    await upsertStars([{ profile_id: profileId, target_type: 'queue_item', target_id: targetId }])
    return { ok: true, queueItemsCleared: [] }
  }
  // Unstar: this row plus every pending member of its group
  const key = item ? queueGroupKey(item, dataset) : null
  const ids = new Set([targetId, ...(key ? pending.filter((p) => queueGroupKey(p, dataset) === key).map((p) => p.id) : [])])
  const { error } = await supabase
    .from('pp_interest')
    .delete()
    .eq('profile_id', profileId)
    .eq('target_type', 'queue_item')
    .in('target_id', [...ids])
  if (error) throw new Error(`pp_interest: ${error.message}`)
  return { ok: true, queueItemsCleared: [...ids] }
}

export async function setStarredCollapsed(profileId: string, collapsed: boolean): Promise<void> {
  const { error } = await supabase.from('settings').update({ post_pulse_starred_collapsed: collapsed }).eq('id', profileId)
  if (error) throw new Error(error.message)
}

// ── Queue resolution hooks (all profiles; called by the PATCH queue route) ──

export interface AcceptStarSnapshot {
  queueId: string
  profiles: string[] // profiles with a star on any pending member of the proposal's group
}

// Read BEFORE accept: accept stamps the new tool id onto the row, which
// would change a new-tool proposal's group key.
export async function snapshotQueueStars(queueId: string, dataset: Pick<PpDataset, 'tools' | 'departments'>): Promise<AcceptStarSnapshot | null> {
  const pending = await fetchPendingQueue()
  const item = pending.find((p) => p.id === queueId)
  if (!item) return null
  const key = queueGroupKey(item, dataset)
  const members = pending.filter((p) => queueGroupKey(p, dataset) === key).map((p) => p.id)
  const { data, error } = await supabase
    .from('pp_interest')
    .select('profile_id')
    .eq('target_type', 'queue_item')
    .in('target_id', members)
  if (error) throw new Error(`pp_interest: ${error.message}`)
  return { queueId, profiles: [...new Set((data ?? []).map((r) => r.profile_id as string))] }
}

export async function carryStarsAfterAccept(snap: AcceptStarSnapshot, result: Extract<QueueResolution, { ok: true }>): Promise<number> {
  const isDept = result.targetType === 'department'
  const tid = isDept ? result.departmentId : result.toolId
  if (tid && snap.profiles.length) {
    await upsertStars(snap.profiles.map((p) => ({ profile_id: p, target_type: isDept ? 'department' : 'tool', target_id: tid })))
  }
  const { error } = await supabase.from('pp_interest').delete().eq('target_type', 'queue_item').eq('target_id', snap.queueId)
  if (error) throw new Error(`pp_interest: ${error.message}`)
  return tid ? snap.profiles.length : 0
}

export async function keepGroupStarAfterDismiss(queueId: string, dataset: Pick<PpDataset, 'tools' | 'departments'>): Promise<number> {
  const { data: own, error } = await supabase
    .from('pp_interest')
    .select('profile_id')
    .eq('target_type', 'queue_item')
    .eq('target_id', queueId)
  if (error) throw new Error(`pp_interest: ${error.message}`)
  if (!own?.length) return 0
  const { data: row } = await supabase.from('pp_queue').select('*').eq('id', queueId).maybeSingle()
  if (!row) return 0
  const pending = await fetchPendingQueue()
  // The dismissed row is no longer pending; group it the way it was
  const dismissed: PpQueueItem = {
    ...(row as PpQueueItem),
    target_type: row.target_type === 'department' ? 'department' : 'tool',
    proposed_department_id: row.proposed_department_id ?? null,
    proposed_changes: row.proposed_changes && typeof row.proposed_changes === 'object' ? row.proposed_changes : {},
  }
  const key = queueGroupKey(dismissed, dataset)
  const members = pending.filter((p) => queueGroupKey(p, dataset) === key).sort((a, b) => b.created_at.localeCompare(a.created_at))
  if (!members.length) return 0
  const { data: memberStars } = await supabase
    .from('pp_interest')
    .select('profile_id')
    .eq('target_type', 'queue_item')
    .in('target_id', members.map((m) => m.id))
  const covered = new Set((memberStars ?? []).map((r) => r.profile_id as string))
  const rows = own
    .map((r) => r.profile_id as string)
    .filter((p) => !covered.has(p))
    .map((p) => ({ profile_id: p, target_type: 'queue_item' as const, target_id: members[0].id }))
  await upsertStars(rows)
  return rows.length
}
