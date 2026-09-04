// Content of one queued item, fetched when the queue starts playing it.
import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { getQueueItemContent } from '@/lib/queue'

const DEFAULT_PROFILE_ID = '00000000-0000-0000-0000-000000000001'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const cookieStore = await cookies()
  const profileId = cookieStore.get('profile_id')?.value ?? DEFAULT_PROFILE_ID
  const item = await getQueueItemContent(profileId, id)
  if (!item) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json(item)
}
