import { NextRequest } from 'next/server'
import { enqueueProposal, fetchPendingQueue } from '@/lib/post-pulse'

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

  const result = await enqueueProposal({
    proposedToolId: typeof proposedToolId === 'string' ? proposedToolId : null,
    proposedChanges: changes as Record<string, unknown>,
    source: source as 'rss' | 'search' | 'chat',
    sourceUrls: Array.isArray(sourceUrls) ? sourceUrls.map(String) : [],
  })
  if ('error' in result) return Response.json({ error: result.error }, { status: 500 })
  return Response.json(result, { status: 201 })
}
