import { NextRequest } from 'next/server'
import { cookies } from 'next/headers'
import { supabase } from '@/lib/supabase'

const DEFAULT_PROFILE_ID = '00000000-0000-0000-0000-000000000001'

export async function GET() {
  const cookieStore = await cookies()
  const profileId = cookieStore.get('profile_id')?.value ?? DEFAULT_PROFILE_ID

  const { data, error } = await supabase
    .from('pinned_insights')
    .select('*')
    .eq('profile_id', profileId)
    .order('created_at', { ascending: false })

  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json(data ?? [])
}

export async function POST(req: NextRequest) {
  const { content, channelName, sourceDate } = await req.json()

  if (!content?.trim()) {
    return Response.json({ error: 'Content is required' }, { status: 400 })
  }

  const cookieStore = await cookies()
  const profileId = cookieStore.get('profile_id')?.value ?? DEFAULT_PROFILE_ID

  const { data, error } = await supabase
    .from('pinned_insights')
    .insert({
      content: content.trim(),
      channel_name: channelName ?? null,
      ...(sourceDate ? { source_date: sourceDate } : {}),
      profile_id: profileId,
    })
    .select('id')
    .single()

  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ id: data.id })
}
