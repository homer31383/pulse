import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { searchChannelHistory } from '@/lib/channel-history-search'
import { fullTextQueryError } from '@/lib/channel-history-types'

export const dynamic = 'force-dynamic'

const DEFAULT_PROFILE_ID = '00000000-0000-0000-0000-000000000001'
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

interface RouteContext {
  params: Promise<{ id: string }>
}

// GET ?q=<text>&whole=1: full-text search over the channel's briefings and
// the digests that include it. Scoped to the cookie profile (another
// profile's channel, or an unknown id, is a 404). Read only.
export async function GET(req: NextRequest, { params }: RouteContext) {
  const { id } = await params
  if (!UUID_RE.test(id)) return NextResponse.json({ error: 'Channel not found' }, { status: 404 })
  const profileId = (await cookies()).get('profile_id')?.value ?? DEFAULT_PROFILE_ID
  const q = req.nextUrl.searchParams.get('q') ?? ''
  const whole = req.nextUrl.searchParams.get('whole') === '1'
  const refusal = fullTextQueryError(q)
  if (refusal) return NextResponse.json({ error: refusal }, { status: 400 })
  try {
    const result = await searchChannelHistory(profileId, id, q, whole)
    if (!result) return NextResponse.json({ error: 'Channel not found' }, { status: 404 })
    console.log(
      `[history-search] channel ${id.slice(0, 8)} "${result.query}"${whole ? ' (whole word)' : ''}: ${result.total} hits in ${result.tookMs} ms`,
    )
    return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Search failed' }, { status: 500 })
  }
}
