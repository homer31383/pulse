// Post Pulse — server-only data access. Imports the service-role Supabase
// client, so this file must never be imported from a 'use client' file.
import { supabase } from '@/lib/supabase'
import {
  buildProposal,
  findNameCollision,
  validateStoredProposal,
  type PpProposalContext,
  type PpProposalInput,
} from '@/lib/post-pulse-proposals'
import {
  PP_CHAT_DEFAULT_NAME,
  PP_DEPARTMENT_EDITABLE_FIELDS,
  PP_TOOL_EDITABLE_FIELDS,
  slugifyHeading,
  type PpChatMessage,
  type PpActivityEntry,
  type PpWorkflowDoc,
  type PpWorkflowDocWithStatus,
  type PpChatSession,
  type PpChatSessionSummary,
  type PpChangelogEntry,
  type PpDataset,
  type PpDepartment,
  type PpDepartmentEditableField,
  type PpQueueItem,
  type PpQueueTargetType,
  type PpTool,
  type PpToolEditableField,
} from '@/lib/post-pulse-types'

const TOOL_ORDER = { column: 'name', ascending: true } as const

function normalizeDepartment(row: Record<string, unknown>): PpDepartment {
  return {
    ...(row as unknown as PpDepartment),
    comparison_attributes: Array.isArray(row.comparison_attributes)
      ? (row.comparison_attributes as PpDepartment['comparison_attributes'])
      : [],
    pipeline_stage: (row.pipeline_stage as PpDepartment['pipeline_stage']) ?? null,
    pipeline_substage: (row.pipeline_substage as PpDepartment['pipeline_substage']) ?? null,
    last_researched_at: (row.last_researched_at as string | null) ?? null,
    related_department_ids: Array.isArray(row.related_department_ids) ? (row.related_department_ids as string[]) : [],
    follow_up_sources: Array.isArray(row.follow_up_sources)
      ? (row.follow_up_sources as unknown[]).filter(
          (f): f is PpDepartment['follow_up_sources'][number] =>
            !!f && typeof f === 'object' && typeof (f as { source?: unknown }).source === 'string'
        )
      : [],
  }
}

function normalizeTool(row: Record<string, unknown>): PpTool {
  return {
    ...(row as unknown as PpTool),
    attributes:
      row.attributes && typeof row.attributes === 'object' && !Array.isArray(row.attributes)
        ? (row.attributes as Record<string, unknown>)
        : {},
    source_urls: Array.isArray(row.source_urls) ? (row.source_urls as string[]) : [],
  }
}

function normalizeQueueItem(row: Record<string, unknown>): PpQueueItem {
  return {
    ...(row as unknown as PpQueueItem),
    target_type: (row.target_type as PpQueueTargetType) ?? 'tool',
    proposed_department_id: (row.proposed_department_id as string | null) ?? null,
    proposed_changes:
      row.proposed_changes && typeof row.proposed_changes === 'object'
        ? (row.proposed_changes as Record<string, unknown>)
        : {},
    source_urls: Array.isArray(row.source_urls) ? (row.source_urls as string[]) : [],
  }
}

// The whole dataset in one round trip set. Loaded by the /post-pulse layout.
export async function fetchPostPulseDataset(): Promise<PpDataset> {
  const dayAgo = new Date(Date.now() - 86_400_000).toISOString()
  const [deptRes, toolRes, queueRes, lastDeptRun, lastScan, deptRuns24h, scans24h] = await Promise.all([
    supabase.from('pp_departments').select('*').order('name', { ascending: true }),
    supabase.from('pp_tools').select('*').order(TOOL_ORDER.column, { ascending: TOOL_ORDER.ascending }),
    supabase.from('pp_queue').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
    supabase.from('pp_department_research_runs').select('ran_at').order('ran_at', { ascending: false }).limit(1).maybeSingle(),
    supabase.from('pp_frontier_scans').select('ran_at').order('ran_at', { ascending: false }).limit(1).maybeSingle(),
    supabase.from('pp_department_research_runs').select('id', { count: 'exact', head: true }).gte('ran_at', dayAgo),
    supabase.from('pp_frontier_scans').select('id', { count: 'exact', head: true }).gte('ran_at', dayAgo),
  ])

  if (deptRes.error) throw new Error(`pp_departments: ${deptRes.error.message}`)
  if (toolRes.error) throw new Error(`pp_tools: ${toolRes.error.message}`)

  // The run tables (migrations 028/029) are optional for the rest of the UI:
  // an error here (not yet applied) just leaves the indicator empty.
  const stamps = [lastDeptRun.data?.ran_at as string | undefined, lastScan.data?.ran_at as string | undefined].filter((s): s is string => !!s)
  return {
    departments: (deptRes.data ?? []).map((r) => normalizeDepartment(r as Record<string, unknown>)),
    tools: (toolRes.data ?? []).map((r) => normalizeTool(r as Record<string, unknown>)),
    pendingQueueCount: queueRes.count ?? 0,
    lastRunAt: stamps.length ? stamps.sort().reverse()[0] : null,
    runsLast24h: (deptRuns24h.count ?? 0) + (scans24h.count ?? 0),
  }
}

export async function fetchTool(id: string): Promise<PpTool | null> {
  const { data, error } = await supabase.from('pp_tools').select('*').eq('id', id).maybeSingle()
  if (error || !data) return null
  return normalizeTool(data as Record<string, unknown>)
}

export async function fetchDepartmentBySlug(slug: string): Promise<PpDepartment | null> {
  const { data, error } = await supabase.from('pp_departments').select('*').eq('slug', slug).maybeSingle()
  if (error || !data) return null
  return normalizeDepartment(data as Record<string, unknown>)
}

export async function fetchDepartmentById(id: string): Promise<PpDepartment | null> {
  const { data, error } = await supabase.from('pp_departments').select('*').eq('id', id).maybeSingle()
  if (error || !data) return null
  return normalizeDepartment(data as Record<string, unknown>)
}

export async function fetchToolChangelog(toolId: string): Promise<PpChangelogEntry[]> {
  const { data } = await supabase
    .from('pp_changelog')
    .select('*')
    .eq('tool_id', toolId)
    .order('created_at', { ascending: false })
  return (data ?? []) as PpChangelogEntry[]
}

export interface PpChangelogWithTool extends PpChangelogEntry {
  tool: { id: string; name: string; department_id: string } | null
  department: { id: string; name: string; slug: string } | null
}

function one<T>(v: T | T[] | null | undefined): T | null {
  return Array.isArray(v) ? (v[0] ?? null) : (v ?? null)
}

// Recent changes across every tool and department, newest first. Powers
// "what changed since I last looked".
export async function fetchRecentChanges(limit = 100): Promise<PpChangelogWithTool[]> {
  const { data } = await supabase
    .from('pp_changelog')
    .select('*, tool:pp_tools(id, name, department_id), department:pp_departments(id, name, slug)')
    .order('created_at', { ascending: false })
    .limit(limit)
  return ((data ?? []) as unknown[]).map((row) => {
    const r = row as PpChangelogEntry & {
      tool: PpChangelogWithTool['tool'] | PpChangelogWithTool['tool'][]
      department: PpChangelogWithTool['department'] | PpChangelogWithTool['department'][]
    }
    return { ...r, target_type: r.target_type ?? 'tool', tool: one(r.tool), department: one(r.department) }
  })
}

export async function fetchDepartmentChangelog(departmentId: string): Promise<PpChangelogEntry[]> {
  const { data } = await supabase
    .from('pp_changelog')
    .select('*')
    .eq('department_id', departmentId)
    .order('created_at', { ascending: false })
  return (data ?? []) as PpChangelogEntry[]
}

export async function fetchPendingQueue(): Promise<PpQueueItem[]> {
  const { data, error } = await supabase
    .from('pp_queue')
    .select('*')
    .eq('status', 'pending')
    .order('created_at', { ascending: true })
  if (error) throw new Error(`pp_queue: ${error.message}`)
  return (data ?? []).map((row) => normalizeQueueItem(row as Record<string, unknown>))
}

// ── Queue resolution ──────────────────────────────────────────────────────

function stringifyValue(value: unknown): string | null {
  if (value === null || value === undefined) return null
  if (typeof value === 'string') return value
  return JSON.stringify(value)
}

function pickFields<K extends string>(changes: Record<string, unknown>, keys: readonly K[]): Partial<Record<K, unknown>> {
  const out: Partial<Record<K, unknown>> = {}
  for (const key of keys) {
    if (key in changes) out[key] = changes[key]
  }
  return out
}

export type QueueResolution =
  | { ok: true; targetType: PpQueueTargetType; toolId: string | null; departmentId: string | null; changedFields: string[] }
  | { ok: false; status: number; error: string }

// Accepting a queue item is the only write path into pp_tools / pp_departments
// other than the seed. Tool targets: apply the proposed columns, write one
// pp_changelog row per field that actually changed, resolve the row. A
// proposal with no proposed_tool_id creates a tool (needs name, department,
// tier). Department targets (migration 023): same shape, overview_doc is
// replaced wholesale (spec §6a), and since migration 025 the change logs to
// pp_changelog with target_type='department' / department_id.
export async function acceptQueueItem(queueId: string): Promise<QueueResolution> {
  const { data: item, error: itemErr } = await supabase
    .from('pp_queue')
    .select('*')
    .eq('id', queueId)
    .maybeSingle()
  if (itemErr) return { ok: false, status: 500, error: itemErr.message }
  if (!item) return { ok: false, status: 404, error: 'Queue item not found' }
  if (item.status !== 'pending') return { ok: false, status: 409, error: `Queue item already ${item.status}` }

  const queued = normalizeQueueItem(item as Record<string, unknown>)
  // Same rules the producers wrote the row under (lib/post-pulse-proposals.ts):
  // a malformed or flagged row is refused here with a reason, never applied.
  const shape = validateStoredProposal(queued)
  if (!shape.ok) return { ok: false, status: 422, error: shape.error }
  const result = queued.target_type === 'department' ? await acceptDepartmentItem(queued) : await acceptToolItem(queued)
  if (!result.ok) return result

  const { error: resolveErr } = await supabase
    .from('pp_queue')
    .update({
      status: 'accepted',
      resolved_at: new Date().toISOString(),
      proposed_tool_id: result.toolId,
      proposed_department_id: result.departmentId,
    })
    .eq('id', queueId)
  if (resolveErr) return { ok: false, status: 500, error: resolveErr.message }
  return result
}

async function resolveDepartmentId(changes: Record<string, unknown>): Promise<string | null> {
  if (typeof changes.department_id === 'string') return changes.department_id
  if (typeof changes.department_slug === 'string') {
    const { data } = await supabase.from('pp_departments').select('id').eq('slug', changes.department_slug).maybeSingle()
    return data?.id ?? null
  }
  return null
}

// The single write path for changes to an existing tool: diff against the
// current row, apply, log one pp_changelog row per changed field, and stamp
// the row verified. Used by queue accept AND by the research auto-publish
// path (spec §5), so both leave identical history.
export async function applyToolUpdate(
  toolId: string,
  changes: Record<string, unknown>,
  source: string
): Promise<{ ok: true; changedFields: string[] } | { ok: false; status: number; error: string }> {
  const { data: current, error: curErr } = await supabase.from('pp_tools').select('*').eq('id', toolId).maybeSingle()
  if (curErr) return { ok: false, status: 500, error: curErr.message }
  if (!current) return { ok: false, status: 404, error: 'Tool no longer exists' }

  const update: Record<string, unknown> = {}
  const changedFields: string[] = []
  const logRows: Omit<PpChangelogEntry, 'id' | 'created_at'>[] = []
  for (const [field, value] of Object.entries(pickFields(changes, PP_TOOL_EDITABLE_FIELDS))) {
    const before = stringifyValue(current[field])
    const after = stringifyValue(value)
    if (before === after) continue
    update[field] = value
    changedFields.push(field)
    logRows.push({ target_type: 'tool', tool_id: current.id, department_id: null, field_changed: field, old_value: before, new_value: after, source })
  }

  // Even a no-op acceptance is a verification: bump the verified stamp.
  update.last_verified_at = new Date().toISOString()
  update.confidence = 'verified'

  const { error: updErr } = await supabase.from('pp_tools').update(update).eq('id', current.id)
  if (updErr) return { ok: false, status: 500, error: updErr.message }
  if (logRows.length) {
    const { error: logErr } = await supabase.from('pp_changelog').insert(logRows)
    if (logErr) return { ok: false, status: 500, error: logErr.message }
  }
  return { ok: true, changedFields }
}

// Research runs stamp what they touched (migration 024) and what they
// confirmed. Both are best-effort: a stamp failure never fails a run.
export async function stampDepartmentsResearched(departmentIds: string[], at = new Date().toISOString()): Promise<void> {
  if (!departmentIds.length) return
  const { error } = await supabase.from('pp_departments').update({ last_researched_at: at }).in('id', departmentIds)
  if (error) console.warn('[post-pulse] last_researched_at stamp failed:', error.message)
}

// Replaces a department's follow-up list with what the latest pass
// recommended (an empty list clears it). Degrades to a warning until
// migration 027 adds the column, so a run never fails on it.
let followUpColumnMissing = false
export async function saveDepartmentFollowUps(departmentId: string, sources: string[]): Promise<void> {
  if (followUpColumnMissing) return
  const at = new Date().toISOString()
  const rows = Array.from(new Set(sources.map((s) => s.trim()).filter(Boolean))).slice(0, 12).map((source) => ({ source, added_at: at }))
  const { error } = await supabase.from('pp_departments').update({ follow_up_sources: rows }).eq('id', departmentId)
  if (error) {
    if (/follow_up_sources|schema cache/i.test(error.message)) {
      followUpColumnMissing = true
      console.warn('[post-pulse] pp_departments.follow_up_sources missing — run supabase/migrations/027_post_pulse_follow_up_sources.sql; follow-up sources not persisted.')
      return
    }
    console.warn('[post-pulse] follow_up_sources save failed:', error.message)
  }
}

// Frontier scan cadence (migration 028) is tracked per pipeline stage in
// pp_frontier_scans, not on departments — three stages have none.
export async function fetchLatestFrontierScans(): Promise<Record<string, string>> {
  const { data, error } = await supabase
    .from('pp_frontier_scans')
    .select('pipeline_stage, ran_at')
    .order('ran_at', { ascending: false })
    .limit(200)
  if (error) {
    console.warn('[post-pulse] pp_frontier_scans read failed (run migration 028?):', error.message)
    return {}
  }
  const latest: Record<string, string> = {}
  for (const row of data ?? []) {
    if (!latest[row.pipeline_stage as string]) latest[row.pipeline_stage as string] = row.ran_at as string
  }
  return latest
}

// Native record of a department maintenance pass (migration 029): the
// data that used to be written into a Pulse briefing, stored in Post Pulse.
export async function recordDepartmentResearchRun(row: {
  department_id: string
  summary: string | null
  findings_count: number
  queued_count: number
  auto_published_count: number
}): Promise<void> {
  const { error } = await supabase.from('pp_department_research_runs').insert(row)
  if (error) console.warn('[post-pulse] pp_department_research_runs insert failed (run migration 029?):', error.message)
}

// The activity feed: both run tables merged, newest first.
export async function fetchActivity(limit = 100): Promise<PpActivityEntry[]> {
  const [runs, scans] = await Promise.all([
    supabase
      .from('pp_department_research_runs')
      .select('id, ran_at, summary, findings_count, queued_count, auto_published_count, department:pp_departments(id, name, slug)')
      .order('ran_at', { ascending: false })
      .limit(limit),
    supabase.from('pp_frontier_scans').select('id, pipeline_stage, ran_at, summary, findings_count, queued_count').order('ran_at', { ascending: false }).limit(limit),
  ])
  if (runs.error) console.warn('[post-pulse] activity: department runs unreadable:', runs.error.message)
  if (scans.error) console.warn('[post-pulse] activity: frontier scans unreadable:', scans.error.message)
  const entries: PpActivityEntry[] = []
  for (const r of (runs.data ?? []) as unknown[]) {
    const row = r as { id: string; ran_at: string; summary: string | null; findings_count: number; queued_count: number; auto_published_count: number; department: PpActivityEntry['department'] | PpActivityEntry['department'][] }
    entries.push({
      id: row.id,
      kind: 'maintenance',
      ranAt: row.ran_at,
      summary: row.summary,
      findingsCount: row.findings_count,
      queuedCount: row.queued_count,
      autoPublishedCount: row.auto_published_count,
      department: one(row.department),
      stage: null,
    })
  }
  for (const s of scans.data ?? []) {
    entries.push({
      id: s.id as string,
      kind: 'frontier',
      ranAt: s.ran_at as string,
      summary: (s.summary as string | null) ?? null,
      findingsCount: s.findings_count as number,
      queuedCount: s.queued_count as number,
      autoPublishedCount: 0,
      department: null,
      stage: s.pipeline_stage as PpActivityEntry['stage'],
    })
  }
  return entries.sort((a, b) => b.ranAt.localeCompare(a.ranAt)).slice(0, limit)
}

export async function recordFrontierScan(row: {
  pipeline_stage: string
  summary: string | null
  findings_count: number
  queued_count: number
}): Promise<void> {
  const { error } = await supabase.from('pp_frontier_scans').insert(row)
  if (error) console.warn('[post-pulse] pp_frontier_scans insert failed:', error.message)
}

export async function stampToolsVerified(toolIds: string[], at = new Date().toISOString()): Promise<void> {
  if (!toolIds.length) return
  const { error } = await supabase.from('pp_tools').update({ last_verified_at: at }).in('id', toolIds)
  if (error) console.warn('[post-pulse] last_verified_at stamp failed:', error.message)
}

// Every URL the dataset has already seen — used to skip RSS items that
// were already proposed or cited, so a fortnightly sweep doesn't re-file
// the same story.
export async function fetchKnownSourceUrls(): Promise<Set<string>> {
  const [tools, queue] = await Promise.all([
    supabase.from('pp_tools').select('source_urls'),
    supabase.from('pp_queue').select('source_urls'),
  ])
  const seen = new Set<string>()
  for (const row of [...(tools.data ?? []), ...(queue.data ?? [])]) {
    for (const u of (row.source_urls as string[] | null) ?? []) seen.add(u)
  }
  return seen
}

async function acceptToolItem(item: PpQueueItem): Promise<QueueResolution> {
  const rawChanges = item.proposed_changes
  const changes = pickFields(rawChanges, PP_TOOL_EDITABLE_FIELDS) as Partial<Record<PpToolEditableField, unknown>>
  if (!changes.department_id) {
    const deptId = await resolveDepartmentId(rawChanges)
    if (deptId) changes.department_id = deptId
  }

  const source = `${item.source}:${item.id}`
  const now = new Date().toISOString()
  const changedFields: string[] = []

  if (item.proposed_tool_id) {
    const applied = await applyToolUpdate(item.proposed_tool_id, changes, source)
    if (!applied.ok) return { ok: false, status: applied.status, error: applied.error }
    return { ok: true, targetType: 'tool', toolId: item.proposed_tool_id, departmentId: null, changedFields: applied.changedFields }
  }

  if (!changes.name || !changes.department_id || !changes.tier) {
    return {
      ok: false,
      status: 400,
      error: 'A new-tool proposal needs at least name, department (id or slug), and tier',
    }
  }
  // Rows written before the cross-department check existed can still
  // collide; refuse them here rather than create a duplicate.
  const dataset = await fetchPostPulseDataset()
  const clash = findNameCollision(String(changes.name), dataset)
  if (clash) {
    return {
      ok: false,
      status: 422,
      error: `"${changes.name}" is already tracked as "${clash.tool.name}" in ${clash.departmentName} (id=${clash.tool.id}). Propose an update to that entry, or link the departments via related_department_ids, instead of duplicating it.`,
    }
  }
  const insert: Record<string, unknown> = {
    ...changes,
    status: changes.status ?? 'active',
    attributes: changes.attributes ?? {},
    source_urls: Array.isArray(changes.source_urls) ? changes.source_urls : item.source_urls,
    last_verified_at: now,
    confidence: 'verified',
  }
  const { data: created, error: insErr } = await supabase.from('pp_tools').insert(insert).select('id').single()
  if (insErr) return { ok: false, status: 500, error: insErr.message }
  const { error: logErr } = await supabase.from('pp_changelog').insert({
    target_type: 'tool',
    tool_id: created.id,
    department_id: null,
    field_changed: 'created',
    old_value: null,
    new_value: String(changes.name),
    source,
  })
  if (logErr) return { ok: false, status: 500, error: logErr.message }
  return { ok: true, targetType: 'tool', toolId: created.id, departmentId: null, changedFields: ['created'] }
}

async function acceptDepartmentItem(item: PpQueueItem): Promise<QueueResolution> {
  const changes = pickFields(item.proposed_changes, PP_DEPARTMENT_EDITABLE_FIELDS) as Partial<
    Record<PpDepartmentEditableField, unknown>
  >
  const changedFields: string[] = []
  const source = `${item.source}:${item.id}`

  if (item.proposed_department_id) {
    const { data: current, error: curErr } = await supabase
      .from('pp_departments')
      .select('*')
      .eq('id', item.proposed_department_id)
      .maybeSingle()
    if (curErr) return { ok: false, status: 500, error: curErr.message }
    if (!current) return { ok: false, status: 404, error: 'Proposed department no longer exists' }

    const update: Record<string, unknown> = {}
    const logRows: Omit<PpChangelogEntry, 'id' | 'created_at'>[] = []
    for (const [field, value] of Object.entries(changes)) {
      const before = stringifyValue(current[field])
      const after = stringifyValue(value)
      if (before === after) continue
      update[field] = value
      changedFields.push(field)
      // Same shape as tool entries; an overview_doc edit logs the whole
      // before/after text, which is the audit trail spec §6a relies on.
      logRows.push({ target_type: 'department', tool_id: null, department_id: current.id, field_changed: field, old_value: before, new_value: after, source })
    }
    if (Object.keys(update).length) {
      const { error: updErr } = await supabase.from('pp_departments').update(update).eq('id', current.id)
      if (updErr) return { ok: false, status: 500, error: updErr.message }
    }
    if (logRows.length) {
      const { error: logErr } = await supabase.from('pp_changelog').insert(logRows)
      if (logErr) return { ok: false, status: 500, error: logErr.message }
    }
    return { ok: true, targetType: 'department', toolId: null, departmentId: current.id, changedFields }
  }

  if (typeof changes.name !== 'string' || !changes.name.trim()) {
    return { ok: false, status: 400, error: 'A new-department proposal needs at least a name' }
  }
  const slug = typeof changes.slug === 'string' && changes.slug.trim() ? changes.slug.trim() : slugifyHeading(changes.name)
  const insert: Record<string, unknown> = {
    name: changes.name.trim(),
    slug,
    overview_doc: typeof changes.overview_doc === 'string' ? changes.overview_doc : '',
    comparison_attributes: Array.isArray(changes.comparison_attributes) ? changes.comparison_attributes : [],
    pipeline_stage: changes.pipeline_stage ?? null,
    pipeline_substage: changes.pipeline_substage ?? null,
  }
  const { data: created, error: insErr } = await supabase.from('pp_departments').insert(insert).select('id').single()
  if (insErr) return { ok: false, status: 500, error: insErr.message }
  const { error: logErr } = await supabase.from('pp_changelog').insert({
    target_type: 'department',
    tool_id: null,
    department_id: created.id,
    field_changed: 'created',
    old_value: null,
    new_value: insert.name,
    source,
  })
  if (logErr) return { ok: false, status: 500, error: logErr.message }
  return { ok: true, targetType: 'department', toolId: null, departmentId: created.id, changedFields: ['created'] }
}

export async function rejectQueueItem(queueId: string): Promise<QueueResolution> {
  const { data: item, error } = await supabase
    .from('pp_queue')
    .update({ status: 'rejected', resolved_at: new Date().toISOString() })
    .eq('id', queueId)
    .eq('status', 'pending')
    .select('id, target_type, proposed_tool_id, proposed_department_id')
    .maybeSingle()
  if (error) return { ok: false, status: 500, error: error.message }
  if (!item) return { ok: false, status: 404, error: 'No pending queue item with that id' }
  return {
    ok: true,
    targetType: (item.target_type as PpQueueTargetType) ?? 'tool',
    toolId: item.proposed_tool_id ?? null,
    departmentId: item.proposed_department_id ?? null,
    changedFields: [],
  }
}

// The only way a proposal gets into pp_queue. Every producer — chat, the
// research job, the manual POST /api/post-pulse/queue — passes a typed
// PpProposalInput; buildProposal() validates and normalises it, so a row
// that the accept handler could not apply is refused HERE, at write time.
export async function enqueueProposal(
  input: PpProposalInput,
  context?: PpProposalContext
): Promise<{ id: string; label: string } | { error: string }> {
  // The cross-department name check needs the live roster; callers that
  // already hold the dataset pass it, everyone else pays one fetch.
  const ctx = context ?? (await fetchPostPulseDataset())
  const built = buildProposal(input, ctx)
  if (!built.ok) return { error: built.error }
  const { data, error } = await supabase.from('pp_queue').insert(built.row).select('id').single()
  if (error) return { error: error.message }
  return { id: data.id, label: built.kind }
}

// ── Workflow docs (migration 030) ───────────────────────────────────────

function normalizeWorkflowDoc(row: Record<string, unknown>): PpWorkflowDoc {
  return {
    ...(row as unknown as PpWorkflowDoc),
    referenced_tool_ids: Array.isArray(row.referenced_tool_ids) ? (row.referenced_tool_ids as string[]) : [],
    source_urls: Array.isArray(row.source_urls) ? (row.source_urls as string[]) : [],
    last_verified_at: (row.last_verified_at as string | null) ?? null,
    source_chat_session_id: (row.source_chat_session_id as string | null) ?? null,
  }
}

// Staleness, computed now: a doc is possibly stale when any referenced tool
// has a pp_changelog row newer than coalesce(last_verified_at, created_at).
// One changelog query covers every doc in the list.
async function withStatus(docs: PpWorkflowDoc[]): Promise<PpWorkflowDocWithStatus[]> {
  const toolIds = Array.from(new Set(docs.flatMap((d) => d.referenced_tool_ids)))
  if (!docs.length) return []
  const [{ data: tools }, { data: changes }] = await Promise.all([
    toolIds.length ? supabase.from('pp_tools').select('id, name').in('id', toolIds) : Promise.resolve({ data: [] as { id: string; name: string }[] }),
    toolIds.length
      ? supabase
          .from('pp_changelog')
          .select('tool_id, field_changed, created_at')
          .in('tool_id', toolIds)
          .gte('created_at', docs.map((d) => d.last_verified_at ?? d.created_at).sort()[0])
          .order('created_at', { ascending: false })
      : Promise.resolve({ data: [] as { tool_id: string; field_changed: string; created_at: string }[] }),
  ])
  const nameOf = new Map((tools ?? []).map((t) => [t.id as string, t.name as string]))
  return docs.map((d) => {
    const baseline = d.last_verified_at ?? d.created_at
    const staleChanges = ((changes ?? []) as { tool_id: string; field_changed: string; created_at: string }[])
      .filter((c) => d.referenced_tool_ids.includes(c.tool_id) && c.created_at > baseline)
      .map((c) => ({ toolId: c.tool_id, toolName: nameOf.get(c.tool_id) ?? 'a tool', field: c.field_changed, changedAt: c.created_at }))
    return {
      ...d,
      stale: staleChanges.length > 0,
      staleChanges,
      referencedTools: d.referenced_tool_ids.map((id) => ({ id, name: nameOf.get(id) ?? '(deleted tool)' })),
    }
  })
}

export async function listWorkflowDocs(departmentId: string): Promise<PpWorkflowDocWithStatus[]> {
  const { data, error } = await supabase
    .from('pp_workflow_docs')
    .select('*')
    .eq('department_id', departmentId)
    .order('created_at', { ascending: false })
  if (error) {
    console.warn('[post-pulse] pp_workflow_docs read failed (run migration 030?):', error.message)
    return []
  }
  return withStatus((data ?? []).map((r) => normalizeWorkflowDoc(r as Record<string, unknown>)))
}

export async function getWorkflowDoc(id: string): Promise<PpWorkflowDocWithStatus | null> {
  const { data, error } = await supabase.from('pp_workflow_docs').select('*').eq('id', id).maybeSingle()
  if (error || !data) return null
  const [doc] = await withStatus([normalizeWorkflowDoc(data as Record<string, unknown>)])
  return doc ?? null
}

export async function createWorkflowDoc(input: {
  departmentId: string
  title: string
  prompt: string
  content: string
  referencedToolIds: string[]
  sourceUrls: string[]
  sourceChatSessionId: string | null
}): Promise<{ id: string } | { error: string }> {
  const { data, error } = await supabase
    .from('pp_workflow_docs')
    .insert({
      department_id: input.departmentId,
      title: input.title.trim().slice(0, 160),
      prompt: input.prompt,
      content: input.content,
      referenced_tool_ids: input.referencedToolIds,
      source_urls: input.sourceUrls,
      source_chat_session_id: input.sourceChatSessionId,
    })
    .select('id')
    .single()
  if (error) return { error: error.message }
  return { id: data.id }
}

// "Mark still accurate": moves the staleness baseline to now, no re-run.
export async function verifyWorkflowDoc(id: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const { error } = await supabase.from('pp_workflow_docs').update({ last_verified_at: new Date().toISOString() }).eq('id', id)
  return error ? { ok: false, error: error.message } : { ok: true }
}

export async function deleteWorkflowDoc(id: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const { error } = await supabase.from('pp_workflow_docs').delete().eq('id', id)
  return error ? { ok: false, error: error.message } : { ok: true }
}

// ── Chat sessions (migration 023) ────────────────────────────────────────

function normalizeSession(row: Record<string, unknown>): PpChatSession {
  return {
    ...(row as unknown as PpChatSession),
    name: typeof row.name === 'string' && row.name.trim() ? row.name : PP_CHAT_DEFAULT_NAME,
    department_context_id: (row.department_context_id as string | null) ?? null,
    messages: Array.isArray(row.messages) ? (row.messages as PpChatMessage[]) : [],
    proposed_queue_ids: Array.isArray(row.proposed_queue_ids) ? (row.proposed_queue_ids as string[]) : [],
    updated_at: (row.updated_at as string) ?? (row.created_at as string),
  }
}

// Plain-text preview of a markdown message for the session list.
function snippet(md: string): string {
  return md
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/[*_`#>]+/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 160)
}

// Session list, most recent activity first, with a snippet of the last
// message. Messages are pulled to derive the snippet — sessions are few.
export async function listChatSessions(): Promise<PpChatSessionSummary[]> {
  const { data, error } = await supabase
    .from('pp_chat_sessions')
    .select('*')
    .order('updated_at', { ascending: false })
    .limit(100)
  if (error) throw new Error(`pp_chat_sessions: ${error.message}`)
  return (data ?? []).map((row) => {
    const s = normalizeSession(row as Record<string, unknown>)
    const last = s.messages[s.messages.length - 1]
    return {
      id: s.id,
      name: s.name,
      department_context_id: s.department_context_id,
      updated_at: s.updated_at,
      created_at: s.created_at,
      messageCount: s.messages.length,
      lastMessage: last ? snippet(last.content) : null,
      lastRole: last?.role ?? null,
    }
  })
}

export async function getChatSession(id: string): Promise<PpChatSession | null> {
  const { data, error } = await supabase.from('pp_chat_sessions').select('*').eq('id', id).maybeSingle()
  if (error || !data) return null
  return normalizeSession(data as Record<string, unknown>)
}

export async function createChatSession(input: {
  name?: string
  departmentContextId?: string | null
}): Promise<PpChatSession> {
  const { data, error } = await supabase
    .from('pp_chat_sessions')
    .insert({
      name: input.name?.trim() || PP_CHAT_DEFAULT_NAME,
      department_context_id: input.departmentContextId ?? null,
      messages: [],
    })
    .select('*')
    .single()
  if (error) throw new Error(`pp_chat_sessions insert: ${error.message}`)
  return normalizeSession(data as Record<string, unknown>)
}

// The most recent session scoped to a department, for the in-context
// launch from a department doc. Returns null when none exists.
export async function findLatestDepartmentSession(departmentId: string): Promise<PpChatSession | null> {
  const { data } = await supabase
    .from('pp_chat_sessions')
    .select('*')
    .eq('department_context_id', departmentId)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  return data ? normalizeSession(data as Record<string, unknown>) : null
}

export async function updateChatSession(
  id: string,
  patch: { name?: string; messages?: PpChatMessage[]; proposedQueueIds?: string[] }
): Promise<{ ok: true } | { ok: false; error: string }> {
  const update: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (patch.name !== undefined) update.name = patch.name.trim() || PP_CHAT_DEFAULT_NAME
  if (patch.messages !== undefined) update.messages = patch.messages
  if (patch.proposedQueueIds !== undefined) update.proposed_queue_ids = patch.proposedQueueIds
  const { error } = await supabase.from('pp_chat_sessions').update(update).eq('id', id)
  if (error) return { ok: false, error: error.message }
  return { ok: true }
}

export async function deleteChatSession(id: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const { error } = await supabase.from('pp_chat_sessions').delete().eq('id', id)
  if (error) return { ok: false, error: error.message }
  return { ok: true }
}
