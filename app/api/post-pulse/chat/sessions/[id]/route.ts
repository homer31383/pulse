import { NextRequest } from 'next/server'
import { deleteChatSession, getChatSession, updateChatSession } from '@/lib/post-pulse'

interface RouteContext {
  params: Promise<{ id: string }>
}

export async function GET(_req: NextRequest, { params }: RouteContext) {
  const { id } = await params
  const session = await getChatSession(id)
  if (!session) return Response.json({ error: 'Session not found' }, { status: 404 })
  return Response.json(session)
}

// PATCH { name }: rename. Messages are only written by the chat engine.
export async function PATCH(req: NextRequest, { params }: RouteContext) {
  const { id } = await params
  let body: { name?: unknown }
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  if (typeof body.name !== 'string') return Response.json({ error: 'name is required' }, { status: 400 })
  const result = await updateChatSession(id, { name: body.name.slice(0, 120) })
  if (!result.ok) return Response.json({ error: result.error }, { status: 500 })
  return Response.json({ ok: true })
}

export async function DELETE(_req: NextRequest, { params }: RouteContext) {
  const { id } = await params
  const result = await deleteChatSession(id)
  if (!result.ok) return Response.json({ error: result.error }, { status: 500 })
  return Response.json({ ok: true })
}
