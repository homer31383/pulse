// One queue row: PATCH progress / played, DELETE remove.
import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { supabase } from '@/lib/supabase'
import { removeFromQueue, updateQueueItem } from '@/lib/queue'

const DEFAULT_PROFILE_ID = '00000000-0000-0000-0000-000000000001'

interface Params { params: Promise<{ id: string }> }

async function profileId(): Promise<string> {
  const cookieStore = await cookies()
  return cookieStore.get('profile_id')?.value ?? DEFAULT_PROFILE_ID
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const { id } = await params
  const pid = await profileId()
  const body = (await req.json().catch(() => ({}))) as {
    progress_sentence?: number; progress_seconds?: number; played?: boolean
  }
  const row = await updateQueueItem(pid, id, body)
  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Listening to the end counts as reading (same rule as opening it)
  if (body.played === true) {
    const table = row.kind === 'briefing' ? 'briefings' : 'digests'
    await supabase.from(table).update({ read_at: new Date().toISOString() }).eq('id', row.item_id).is('read_at', null)
  }
  return NextResponse.json({ ok: true, item: row })
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const { id } = await params
  await removeFromQueue(await profileId(), id)
  return NextResponse.json({ ok: true })
}
