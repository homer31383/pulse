import { NextRequest } from 'next/server'
import { deleteWorkflowDoc, verifyWorkflowDoc } from '@/lib/post-pulse'

interface RouteContext {
  params: Promise<{ id: string }>
}

// PATCH { action: 'verify' } — "Mark still accurate": last_verified_at = now.
export async function PATCH(req: NextRequest, { params }: RouteContext) {
  const { id } = await params
  let action: unknown
  try {
    ;({ action } = await req.json())
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  if (action !== 'verify') return Response.json({ error: "action must be 'verify'" }, { status: 400 })
  const result = await verifyWorkflowDoc(id)
  if (!result.ok) return Response.json({ error: result.error }, { status: 500 })
  return Response.json({ ok: true, lastVerifiedAt: new Date().toISOString() })
}

export async function DELETE(_req: NextRequest, { params }: RouteContext) {
  const { id } = await params
  const result = await deleteWorkflowDoc(id)
  if (!result.ok) return Response.json({ error: result.error }, { status: 500 })
  return Response.json({ ok: true })
}
