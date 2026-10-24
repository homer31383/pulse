import { NextRequest } from 'next/server'
import { acceptQueueItem, rejectQueueItem, reopenQueueItem } from '@/lib/post-pulse'

interface RouteContext {
  params: Promise<{ id: string }>
}

// PATCH { action: 'accept' | 'reject' | 'reopen' }
// Accept applies the proposal to pp_tools and writes pp_changelog rows;
// reject only resolves the queue row. Reopen is the dismiss undo: it puts a
// row rejected in the last 60 s back to pending (409 otherwise, or when
// another pending item already covers the same target).
export async function PATCH(req: NextRequest, { params }: RouteContext) {
  const { id } = await params
  let action: unknown
  try {
    ;({ action } = await req.json())
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  if (action !== 'accept' && action !== 'reject' && action !== 'reopen') {
    return Response.json({ error: "action must be 'accept', 'reject' or 'reopen'" }, { status: 400 })
  }

  const result =
    action === 'accept' ? await acceptQueueItem(id) : action === 'reject' ? await rejectQueueItem(id) : await reopenQueueItem(id)
  if (!result.ok) return Response.json({ error: result.error }, { status: result.status })
  return Response.json(result)
}
