import { NextRequest } from 'next/server'
import { createChatSession, listChatSessions } from '@/lib/post-pulse'

export const dynamic = 'force-dynamic'

// GET: sessions by most recent activity. POST { name?, departmentContextId? }: create.
export async function GET() {
  try {
    return Response.json(await listChatSessions())
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : 'Failed' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  let body: { name?: unknown; departmentContextId?: unknown } = {}
  try {
    body = await req.json()
  } catch {
    /* empty body is fine */
  }
  try {
    const session = await createChatSession({
      name: typeof body.name === 'string' ? body.name : undefined,
      departmentContextId: typeof body.departmentContextId === 'string' ? body.departmentContextId : null,
    })
    return Response.json(session, { status: 201 })
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : 'Failed' }, { status: 500 })
  }
}
