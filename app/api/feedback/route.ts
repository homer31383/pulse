import { NextRequest } from 'next/server'
import { supabase } from '@/lib/supabase'

export async function POST(req: NextRequest) {
  const { briefingId, vote } = await req.json()

  if (!briefingId || ![-1, 1].includes(vote)) {
    return Response.json({ error: 'briefingId and vote (-1 or 1) are required' }, { status: 400 })
  }

  // Replace any existing vote for this briefing
  await supabase.from('briefing_feedback').delete().eq('briefing_id', briefingId)

  const { error } = await supabase
    .from('briefing_feedback')
    .insert({ briefing_id: briefingId, vote })

  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ ok: true })
}
