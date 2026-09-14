import { NextRequest } from 'next/server'
import { enqueueProposal, fetchPendingQueue } from '@/lib/post-pulse'
import { supabase } from '@/lib/supabase'
import type { PpProposalInput } from '@/lib/post-pulse-proposals'

export const dynamic = 'force-dynamic'

const SOURCES = new Set(['rss', 'search', 'chat'])

// GET: pending review items. POST: file a proposal. Every change to the
// dataset goes through here — the automation and chat passes will call
// enqueueProposal() server-side, and this endpoint is the manual entry
// point for testing the review flow before those exist.
export async function GET() {
  try {
    return Response.json(await fetchPendingQueue())
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : 'Failed' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const changes = body.proposedChanges ?? body.proposed_changes
  const source = String(body.source ?? 'chat')
  if (!changes || typeof changes !== 'object' || Array.isArray(changes)) {
    return Response.json({ error: 'proposedChanges must be an object' }, { status: 400 })
  }
  if (!SOURCES.has(source)) {
    return Response.json({ error: 'source must be rss, search, or chat' }, { status: 400 })
  }
  const sourceUrls = body.sourceUrls ?? body.source_urls
  const proposedToolId = body.proposedToolId ?? body.proposed_tool_id
  const proposedDepartmentId = body.proposedDepartmentId ?? body.proposed_department_id
  const targetType = body.targetType ?? body.target_type ?? 'tool'
  if (targetType !== 'tool' && targetType !== 'department') {
    return Response.json({ error: 'targetType must be tool or department' }, { status: 400 })
  }

  // Map the raw body onto the shared proposal shape so this entry point is
  // held to the same rules as chat and the research job.
  const fields = changes as Record<string, unknown>
  const note = typeof fields.note === 'string' ? fields.note : 'Filed via the queue API.'
  const common = { note, source: source as 'rss' | 'search' | 'chat', sourceUrls: Array.isArray(sourceUrls) ? sourceUrls.map(String) : [] }
  let input: PpProposalInput
  if (targetType === 'department') {
    input =
      typeof proposedDepartmentId === 'string'
        ? { kind: 'department_update', departmentId: proposedDepartmentId, changes: fields, ...common }
        : { kind: 'department_create', fields, ...common }
  } else if (typeof proposedToolId === 'string') {
    input = { kind: 'tool_update', toolId: proposedToolId, changes: fields, ...common }
  } else {
    // A new tool needs its department resolved (id or slug) before the row exists.
    const slug = typeof fields.department_slug === 'string' ? fields.department_slug : null
    const id = typeof fields.department_id === 'string' ? fields.department_id : null
    const q = supabase.from('pp_departments').select('id, slug')
    const { data: dept } = await (id ? q.eq('id', id) : q.eq('slug', slug ?? '')).maybeSingle()
    if (!dept) return Response.json({ error: 'a new tool needs department_id or department_slug naming an existing department' }, { status: 400 })
    input = { kind: 'tool_create', department: { id: dept.id, slug: dept.slug }, fields, ...common }
  }

  const result = await enqueueProposal(input)
  if ('error' in result) return Response.json({ error: result.error }, { status: 422 })
  return Response.json(result, { status: 201 })
}
