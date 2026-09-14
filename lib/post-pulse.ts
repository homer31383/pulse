// Post Pulse — server-only data access. Imports the service-role Supabase
// client, so this file must never be imported from a 'use client' file.
import { supabase } from '@/lib/supabase'
import {
  PP_CHAT_DEFAULT_NAME,
  PP_DEPARTMENT_EDITABLE_FIELDS,
  PP_TOOL_EDITABLE_FIELDS,
  slugifyHeading,
  type PpChatMessage,
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
  const [deptRes, toolRes, queueRes] = await Promise.all([
    supabase.from('pp_departments').select('*').order('name', { ascending: true }),
    supabase.from('pp_tools').select('*').order(TOOL_ORDER.column, { ascending: TOOL_ORDER.ascending }),
    supabase.from('pp_queue').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
  ])

  if (deptRes.error) throw new Error(`pp_departments: ${deptRes.error.message}`)
  if (toolRes.error) throw new Error(`pp_tools: ${toolRes.error.message}`)

  return {
    departments: (deptRes.data ?? []).map((r) => normalizeDepartment(r as Record<string, unknown>)),
    tools: (toolRes.data ?? []).map((r) => normalizeTool(r as Record<string, unknown>)),
    pendingQueueCount: queueRes.count ?? 0,
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
}

// Recent changes across every tool, newest first. Powers "what changed
// since I last looked".
export async function fetchRecentChanges(limit = 100): Promise<PpChangelogWithTool[]> {
  const { data } = await supabase
    .from('pp_changelog')
    .select('*, tool:pp_tools(id, name, department_id)')
    .order('created_at', { ascending: false })
    .limit(limit)
  return ((data ?? []) as unknown[]).map((row) => {
    const r = row as PpChangelogEntry & { tool: PpChangelogWithTool['tool'] | PpChangelogWithTool['tool'][] }
    const tool = Array.isArray(r.tool) ? (r.tool[0] ?? null) : (r.tool ?? null)
    return { ...r, tool }
  })
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
// tier). Department targets (migration 023): same shape, but overview_doc is
// replaced wholesale (spec §6a) and — since pp_changelog.tool_id is a NOT
// NULL FK to pp_tools — department changes are not changelog-logged.
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
    const { data: current, error: curErr } = await supabase
      .from('pp_tools')
      .select('*')
      .eq('id', item.proposed_tool_id)
      .maybeSingle()
    if (curErr) return { ok: false, status: 500, error: curErr.message }
    if (!current) return { ok: false, status: 404, error: 'Proposed tool no longer exists' }

    const update: Record<string, unknown> = {}
    const logRows: Omit<PpChangelogEntry, 'id' | 'created_at'>[] = []
    for (const [field, value] of Object.entries(changes)) {
      const before = stringifyValue(current[field])
      const after = stringifyValue(value)
      if (before === after) continue
      update[field] = value
      changedFields.push(field)
      logRows.push({ tool_id: current.id, field_changed: field, old_value: before, new_value: after, source })
    }

    // Even a no-op acceptance is a verification: bump the verified stamp.
    update.last_verified_at = now
    update.confidence = 'verified'

    const { error: updErr } = await supabase.from('pp_tools').update(update).eq('id', current.id)
    if (updErr) return { ok: false, status: 500, error: updErr.message }
    if (logRows.length) {
      const { error: logErr } = await supabase.from('pp_changelog').insert(logRows)
      if (logErr) return { ok: false, status: 500, error: logErr.message }
    }
    return { ok: true, targetType: 'tool', toolId: current.id, departmentId: null, changedFields }
  }

  if (!changes.name || !changes.department_id || !changes.tier) {
    return {
      ok: false,
      status: 400,
      error: 'A new-tool proposal needs at least name, department (id or slug), and tier',
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
    tool_id: created.id,
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

  if (item.proposed_department_id) {
    const { data: current, error: curErr } = await supabase
      .from('pp_departments')
      .select('*')
      .eq('id', item.proposed_department_id)
      .maybeSingle()
    if (curErr) return { ok: false, status: 500, error: curErr.message }
    if (!current) return { ok: false, status: 404, error: 'Proposed department no longer exists' }

    const update: Record<string, unknown> = {}
    for (const [field, value] of Object.entries(changes)) {
      if (stringifyValue(current[field]) === stringifyValue(value)) continue
      update[field] = value
      changedFields.push(field)
    }
    if (Object.keys(update).length) {
      const { error: updErr } = await supabase.from('pp_departments').update(update).eq('id', current.id)
      if (updErr) return { ok: false, status: 500, error: updErr.message }
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

// Used by the chat engine, the (future) automation pass, and the manual
// POST /api/post-pulse/queue: every proposal lands here, nothing writes
// pp_tools or pp_departments directly.
export async function enqueueProposal(input: {
  targetType?: PpQueueTargetType
  proposedToolId?: string | null
  proposedDepartmentId?: string | null
  proposedChanges: Record<string, unknown>
  source: PpQueueItem['source']
  sourceUrls?: string[]
}): Promise<{ id: string } | { error: string }> {
  const { data, error } = await supabase
    .from('pp_queue')
    .insert({
      target_type: input.targetType ?? 'tool',
      proposed_tool_id: input.proposedToolId ?? null,
      proposed_department_id: input.proposedDepartmentId ?? null,
      proposed_changes: input.proposedChanges,
      source: input.source,
      source_urls: input.sourceUrls ?? [],
    })
    .select('id')
    .single()
  if (error) return { error: error.message }
  return { id: data.id }
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
