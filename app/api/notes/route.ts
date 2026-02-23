import { NextRequest } from 'next/server'
import { supabase } from '@/lib/supabase'

export async function GET() {
  const { data, error } = await supabase
    .from('notes')
    .select('*')
    .order('created_at', { ascending: false })

  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json(data ?? [])
}

export async function POST(req: NextRequest) {
  const { briefingId, channelName, content } = await req.json()

  if (!content?.trim()) {
    return Response.json({ error: 'Content is required' }, { status: 400 })
  }

  const { data, error } = await supabase
    .from('notes')
    .insert({ briefing_id: briefingId ?? null, channel_name: channelName ?? null, content })
    .select('id')
    .single()

  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ id: data.id })
}
