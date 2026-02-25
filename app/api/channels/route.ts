import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { supabase } from '@/lib/supabase'

const DEFAULT_PROFILE_ID = '00000000-0000-0000-0000-000000000001'

async function getProfileId(): Promise<string> {
  const cookieStore = await cookies()
  return cookieStore.get('profile_id')?.value ?? DEFAULT_PROFILE_ID
}

export async function GET() {
  const profileId = await getProfileId()

  const { data, error } = await supabase
    .from('channels')
    .select('*')
    .eq('profile_id', profileId)
    .order('position', { ascending: true })
    .order('created_at', { ascending: true })

  if (error) {
    // Fall back to created_at order if position column not yet added (migration 002)
    const fallback = await supabase
      .from('channels')
      .select('*')
      .eq('profile_id', profileId)
      .order('created_at', { ascending: true })
    if (fallback.error) return NextResponse.json({ error: fallback.error.message }, { status: 500 })
    return NextResponse.json(fallback.data)
  }
  return NextResponse.json(data)
}

export async function POST(req: NextRequest) {
  const profileId = await getProfileId()
  const body = await req.json()

  const { data, error } = await supabase
    .from('channels')
    .insert({
      name: body.name,
      description: body.description ?? null,
      instructions: body.instructions ?? '',
      search_queries: body.search_queries ?? [],
      profile_id: profileId,
    })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data, { status: 201 })
}
