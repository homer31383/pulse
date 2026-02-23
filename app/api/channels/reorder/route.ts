import { NextRequest } from 'next/server'
import { supabase } from '@/lib/supabase'

// PATCH /api/channels/reorder
// Body: { ids: string[] } — ordered list of channel IDs
// Sets position = index for each channel
export async function PATCH(req: NextRequest) {
  const { ids }: { ids: string[] } = await req.json()

  if (!Array.isArray(ids) || ids.length === 0) {
    return Response.json({ error: 'ids must be a non-empty array' }, { status: 400 })
  }

  // Update each channel's position in parallel
  const results = await Promise.all(
    ids.map((id, index) =>
      supabase.from('channels').update({ position: index }).eq('id', id)
    )
  )

  const failed = results.find((r) => r.error)
  if (failed?.error) {
    return Response.json({ error: failed.error.message }, { status: 500 })
  }

  return Response.json({ ok: true })
}
