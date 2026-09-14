// Post Pulse — server-only data access. Imports the service-role Supabase
// client, so this file must never be imported from a 'use client' file.
import { supabase } from '@/lib/supabase'
import {
  PP_TOOL_EDITABLE_FIELDS,
  type PpChangelogEntry,
  type PpDataset,
  type PpDepartment,
  type PpQueueItem,
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
  return (data ?? []).map((row) => ({
    ...(row as PpQueueItem),
    proposed_changes:
      row.proposed_changes && typeof row.proposed_changes === 'object' ? row.proposed_changes : {},
    source_urls: Array.isArray(row.source_urls) ? row.source_urls : [],
  }))
}

// ── Queue resolution ──────────────────────────────────────────────────────

function stringifyValue(value: unknown): string | null {
  if (value === null || value === undefined) return null
  if (typeof value === 'string') return value
  return JSON.stringify(value)
}

function pickEditable(changes: Record<string, unknown>): Partial<Record<PpToolEditableField, unknown>> {
  const out: Partial<Record<PpToolEditableField, unknown>> = {}
  for (const key of PP_TOOL_EDITABLE_FIELDS) {
    if (key in changes) out[key] = changes[key]
  }
  return out
}

export type QueueResolution =
  | { ok: true; toolId: string; changedFields: string[] }
  | { ok: false; status: number; error: string }

// Accepting a queue item is the only write path into pp_tools other than
// the seed: apply the proposed columns, write one pp_changelog row per
// field that actually changed, and mark the queue row resolved. A proposal
// with no proposed_tool_id creates a new tool (it must carry at least a
// name, a department, and a tier).
export async function acceptQueueItem(queueId: string): Promise<QueueResolution> {
  const { data: item, error: itemErr } = await supabase
    .from('pp_queue')
    .select('*')
    .eq('id', queueId)
    .maybeSingle()
  if (itemErr) return { ok: false, status: 500, error: itemErr.message }
  if (!item) return { ok: false, status: 404, error: 'Queue item not found' }
  if (item.status !== 'pending') return { ok: false, status: 409, error: `Queue item already ${item.status}` }

  const rawChanges =
    item.proposed_changes && typeof item.proposed_changes === 'object'
      ? (item.proposed_changes as Record<string, unknown>)
      : {}
  const changes = pickEditable(rawChanges)

  // Proposals may name a department by slug instead of id — resolve it.
  if (!changes.department_id && typeof rawChanges.department_slug === 'string') {
    const { data: dept } = await supabase
      .from('pp_departments')
      .select('id')
      .eq('slug', rawChanges.department_slug)
      .maybeSingle()
    if (dept) changes.department_id = dept.id
  }

  const source = `${item.source}:${queueId}`
  const now = new Date().toISOString()
  const changedFields: string[] = []
  let toolId: string

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
    toolId = current.id
  } else {
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
      source_urls: Array.isArray(changes.source_urls)
        ? changes.source_urls
        : Array.isArray(item.source_urls)
          ? item.source_urls
          : [],
      last_verified_at: now,
      confidence: 'verified',
    }
    const { data: created, error: insErr } = await supabase
      .from('pp_tools')
      .insert(insert)
      .select('id')
      .single()
    if (insErr) return { ok: false, status: 500, error: insErr.message }
    toolId = created.id
    changedFields.push('created')
    const { error: logErr } = await supabase.from('pp_changelog').insert({
      tool_id: toolId,
      field_changed: 'created',
      old_value: null,
      new_value: String(changes.name),
      source,
    })
    if (logErr) return { ok: false, status: 500, error: logErr.message }
  }

  const { error: resolveErr } = await supabase
    .from('pp_queue')
    .update({ status: 'accepted', resolved_at: now, proposed_tool_id: toolId })
    .eq('id', queueId)
  if (resolveErr) return { ok: false, status: 500, error: resolveErr.message }

  return { ok: true, toolId, changedFields }
}

export async function rejectQueueItem(queueId: string): Promise<QueueResolution> {
  const { data: item, error } = await supabase
    .from('pp_queue')
    .update({ status: 'rejected', resolved_at: new Date().toISOString() })
    .eq('id', queueId)
    .eq('status', 'pending')
    .select('id, proposed_tool_id')
    .maybeSingle()
  if (error) return { ok: false, status: 500, error: error.message }
  if (!item) return { ok: false, status: 404, error: 'No pending queue item with that id' }
  return { ok: true, toolId: item.proposed_tool_id ?? '', changedFields: [] }
}

// Used by the (future) automation and chat passes, and by the manual
// POST /api/post-pulse/queue: every proposal lands here, nothing writes
// pp_tools directly.
export async function enqueueProposal(input: {
  proposedToolId?: string | null
  proposedChanges: Record<string, unknown>
  source: PpQueueItem['source']
  sourceUrls?: string[]
}): Promise<{ id: string } | { error: string }> {
  const { data, error } = await supabase
    .from('pp_queue')
    .insert({
      proposed_tool_id: input.proposedToolId ?? null,
      proposed_changes: input.proposedChanges,
      source: input.source,
      source_urls: input.sourceUrls ?? [],
    })
    .select('id')
    .single()
  if (error) return { error: error.message }
  return { id: data.id }
}
