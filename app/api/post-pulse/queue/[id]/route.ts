import { NextRequest } from 'next/server'
import { acceptQueueItem, rejectQueueItem } from '@/lib/post-pulse'

interface RouteContext {
  params: Promise<{ id: string }>
}

// PATCH { action: 'accept' | 'reject' }
// Accept applies the proposal to pp_tools and writes pp_changelog rows;
// reject only resolves the queue row.
export async function PATCH(req: NextRequest, { params }: RouteContext) {
  const { id } = await params
  let action: unknown
  try {
    ;({ action } = await req.json())
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  if (action !== 'accept' && action !== 'reject') {
    return Response.json({ error: "action must be 'accept' or 'reject'" }, { status: 400 })
  }

  const result = action === 'accept' ? await acceptQueueItem(id) : await rejectQueueItem(id)
  if (!result.ok) return Response.json({ error: result.error }, { status: result.status })
  return Response.json(result)
}
