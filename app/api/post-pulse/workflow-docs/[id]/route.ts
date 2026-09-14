import { NextRequest } from 'next/server'
import { deleteWorkflowDoc, moveWorkflowDoc, verifyWorkflowDoc } from '@/lib/post-pulse'

interface RouteContext {
  params: Promise<{ id: string }>
}

// PATCH { action: 'verify' } — "Mark still accurate": last_verified_at = now.
// PATCH { action: 'move', departmentId, alsoDepartmentIds? } — reclassify:
// new primary department and/or additional departments (migration 031).
export async function PATCH(req: NextRequest, { params }: RouteContext) {
  const { id } = await params
  let body: { action?: unknown; departmentId?: unknown; alsoDepartmentIds?: unknown }
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  if (body.action === 'verify') {
    const result = await verifyWorkflowDoc(id)
    if (!result.ok) return Response.json({ error: result.error }, { status: 500 })
    return Response.json({ ok: true, lastVerifiedAt: new Date().toISOString() })
  }
  if (body.action === 'move') {
    if (typeof body.departmentId !== 'string') return Response.json({ error: 'departmentId is required' }, { status: 400 })
    const also = Array.isArray(body.alsoDepartmentIds) ? body.alsoDepartmentIds.filter((x): x is string => typeof x === 'string') : []
    const result = await moveWorkflowDoc(id, body.departmentId, also)
    if (!result.ok) return Response.json({ error: result.error }, { status: result.status })
    return Response.json({ ok: true, primarySlug: result.primarySlug })
  }
  return Response.json({ error: "action must be 'verify' or 'move'" }, { status: 400 })
}

export async function DELETE(_req: NextRequest, { params }: RouteContext) {
  const { id } = await params
  const result = await deleteWorkflowDoc(id)
  if (!result.ok) return Response.json({ error: result.error }, { status: 500 })
  return Response.json({ ok: true })
}
