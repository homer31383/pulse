import { NextRequest } from 'next/server'
import { supabase } from '@/lib/supabase'

export async function POST(req: NextRequest) {
  const { briefingId } = await req.json()

  if (!briefingId) {
    return Response.json({ error: 'briefingId is required' }, { status: 400 })
  }

  // Return existing share link if one already exists for this briefing
  const { data: existing } = await supabase
    .from('shared_briefings')
    .select('slug')
    .eq('briefing_id', briefingId)
    .single()

  if (existing) {
    return Response.json({ slug: existing.slug })
  }

  // Generate a new short slug
  const slug = crypto.randomUUID().replace(/-/g, '').slice(0, 12)

  const { error } = await supabase
    .from('shared_briefings')
    .insert({ briefing_id: briefingId, slug })

  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ slug })
}
