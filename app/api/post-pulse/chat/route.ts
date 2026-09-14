import { NextRequest } from 'next/server'
import { createChatSession, getChatSession } from '@/lib/post-pulse'
import { runChatTurn, type PpChatStreamEvent } from '@/lib/post-pulse-chat'

// Research chat can search several times per reply.
export const maxDuration = 300
export const dynamic = 'force-dynamic'

// POST { sessionId?, departmentContextId?, message } → SSE
// Events: session {id} (when created here), searching, source, text_delta,
// queued (a pp_queue row written this turn), done {name, message}, error.
// Proposals are filed by the engine in the same turn — see lib/post-pulse-chat.ts.
export async function POST(req: NextRequest) {
  let body: { sessionId?: unknown; departmentContextId?: unknown; message?: unknown }
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  const message = typeof body.message === 'string' ? body.message.trim() : ''
  if (!message) return Response.json({ error: 'message is required' }, { status: 400 })
  if (message.length > 8000) return Response.json({ error: 'message is too long (8000 chars max)' }, { status: 400 })

  let session = typeof body.sessionId === 'string' ? await getChatSession(body.sessionId) : null
  if (typeof body.sessionId === 'string' && !session) {
    return Response.json({ error: 'Session not found' }, { status: 404 })
  }
  let created = false
  if (!session) {
    session = await createChatSession({
      departmentContextId: typeof body.departmentContextId === 'string' ? body.departmentContextId : null,
    })
    created = true
  }

  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: object) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`))
      if (created) send({ type: 'session', id: session!.id })
      try {
        await runChatTurn({ session: session!, userMessage: message, onEvent: (e: PpChatStreamEvent) => send(e) })
      } catch (err) {
        send({ type: 'error', error: err instanceof Error ? err.message : 'Failed' })
      } finally {
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  })
}
