import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

interface RouteParams {
  params: Promise<{ id: string }>
}

export async function POST(req: NextRequest, { params }: RouteParams) {
  const { id } = await params
  const { target_profile_id } = await req.json()

  if (!target_profile_id) {
    return NextResponse.json({ error: 'target_profile_id required' }, { status: 400 })
  }

  // Fetch source channel fields to copy
  const { data: channel, error } = await supabase
    .from('channels')
    .select('name, description, instructions, search_queries, serendipity_mode')
    .eq('id', id)
    .single()

  if (error || !channel) {
    return NextResponse.json({ error: 'Channel not found' }, { status: 404 })
  }

  // Get max position in target profile so the copy goes to the end
  const { data: posData } = await supabase
    .from('channels')
    .select('position')
    .eq('profile_id', target_profile_id)
    .order('position', { ascending: false })
    .limit(1)

  const nextPosition = posData?.[0]?.position != null ? posData[0].position + 1 : 0

  const { data: newChannel, error: insertError } = await supabase
    .from('channels')
    .insert({
      name: channel.name,
      description: channel.description,
      instructions: channel.instructions,
      search_queries: channel.search_queries,
      serendipity_mode: channel.serendipity_mode,
      profile_id: target_profile_id,
      position: nextPosition,
    })
    .select()
    .single()

  if (insertError) {
    return NextResponse.json({ error: 'Failed to copy channel' }, { status: 500 })
  }

  return NextResponse.json(newChannel, { status: 201 })
}
