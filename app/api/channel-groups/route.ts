import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

export async function GET() {
  const { data, error } = await supabase
    .from('channel_groups')
    .select('*')
    .order('position', { ascending: true })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data ?? [])
}

export async function POST(req: NextRequest) {
  const { name } = await req.json()
  if (!name?.trim()) {
    return NextResponse.json({ error: 'Name is required' }, { status: 400 })
  }

  // Place new group at the end
  const { data: existing } = await supabase
    .from('channel_groups')
    .select('position')
    .order('position', { ascending: false })
    .limit(1)
    .single()

  const position = (existing?.position ?? -1) + 1

  const { data, error } = await supabase
    .from('channel_groups')
    .insert({ name: name.trim(), position })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}
