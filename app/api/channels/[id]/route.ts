import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { deleteTtsAudio } from '@/lib/tts'
import { removeQueueItemsFor } from '@/lib/queue'

interface Params {
  params: Promise<{ id: string }>
}

export async function GET(_req: NextRequest, { params }: Params) {
  const { id } = await params
  const { data, error } = await supabase
    .from('channels')
    .select('*')
    .eq('id', id)
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 404 })
  return NextResponse.json(data)
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const { id } = await params
  const body = await req.json()
  const allowed = ['name', 'description', 'instructions', 'search_queries', 'group_id', 'serendipity_mode', 'schedule_interval_days', 'schedule_output']
  const updates: Record<string, unknown> = {}
  for (const key of allowed) {
    if (key in body) updates[key] = body[key]
  }

  const { data, error } = await supabase
    .from('channels')
    .update(updates)
    .eq('id', id)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const { id } = await params
  // Briefings cascade in Postgres; their cached premium audio does not
  const { data: briefingRows } = await supabase.from('briefings').select('id').eq('channel_id', id)
  const { error } = await supabase.from('channels').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  const briefingIds = (briefingRows ?? []).map((b: { id: string }) => b.id)
  deleteTtsAudio('briefing', briefingIds).catch(() => {})
  removeQueueItemsFor('briefing', briefingIds).catch(() => {})
  return new NextResponse(null, { status: 204 })
}
