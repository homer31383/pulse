import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

export async function GET() {
  const { data, error } = await supabase
    .from('channels')
    .select('*')
    .order('position', { ascending: true })
    .order('created_at', { ascending: true })

  if (error) {
    // Fall back to created_at order if position column not yet added (migration 002)
    const fallback = await supabase
      .from('channels')
      .select('*')
      .order('created_at', { ascending: true })
    if (fallback.error) return NextResponse.json({ error: fallback.error.message }, { status: 500 })
    return NextResponse.json(fallback.data)
  }
  return NextResponse.json(data)
}

export async function POST(req: NextRequest) {
  const body = await req.json()

  const { data, error } = await supabase
    .from('channels')
    .insert({
      name: body.name,
      description: body.description ?? null,
      instructions: body.instructions ?? '',
      search_queries: body.search_queries ?? [],
    })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data, { status: 201 })
}
