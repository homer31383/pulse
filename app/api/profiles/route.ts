import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

export async function GET() {
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .order('created_at', { ascending: true })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data ?? [])
}

export async function POST(req: NextRequest) {
  const { name } = await req.json()
  if (!name?.trim()) {
    return NextResponse.json({ error: 'Name is required' }, { status: 400 })
  }

  // Create the profile
  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .insert({ name: name.trim() })
    .select()
    .single()

  if (profileError || !profile) {
    return NextResponse.json({ error: profileError?.message ?? 'Failed to create profile' }, { status: 500 })
  }

  // Create default settings row for the new profile
  await supabase.from('settings').insert({ id: profile.id }).select().single()

  return NextResponse.json(profile, { status: 201 })
}
