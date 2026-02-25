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
    .from('channel_groups')
    .select('*')
    .eq('profile_id', profileId)
    .order('position', { ascending: true })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data ?? [])
}

export async function POST(req: NextRequest) {
  const profileId = await getProfileId()
  const { name } = await req.json()
  if (!name?.trim()) {
    return NextResponse.json({ error: 'Name is required' }, { status: 400 })
  }

  // Place new group at the end (within this profile)
  const { data: existing } = await supabase
    .from('channel_groups')
    .select('position')
    .eq('profile_id', profileId)
    .order('position', { ascending: false })
    .limit(1)
    .single()

  const position = (existing?.position ?? -1) + 1

  const { data, error } = await supabase
    .from('channel_groups')
    .insert({ name: name.trim(), position, profile_id: profileId })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}
