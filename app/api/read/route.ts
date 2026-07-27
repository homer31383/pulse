import { NextRequest } from 'next/server'
import { supabase } from '@/lib/supabase'

// Batch mark briefings/digests as read. Fire-and-forget from reading views.
// Only unread items are touched so read_at keeps the FIRST read time.
export async function POST(req: NextRequest) {
  const { briefingIds = [], digestIds = [] }: { briefingIds?: string[]; digestIds?: string[] } =
    await req.json()

  if (briefingIds.length === 0 && digestIds.length === 0) {
    return Response.json({ error: 'Nothing to mark' }, { status: 400 })
  }

  const now = new Date().toISOString()
  const ops: PromiseLike<{ error: { message: string } | null }>[] = []
  if (briefingIds.length > 0) {
    ops.push(supabase.from('briefings').update({ read_at: now }).in('id', briefingIds).is('read_at', null))
  }
  if (digestIds.length > 0) {
    ops.push(supabase.from('digests').update({ read_at: now }).in('id', digestIds).is('read_at', null))
  }

  const settled = await Promise.all(ops)
  const failed = settled.find((r) => r.error)
  if (failed?.error) return Response.json({ error: failed.error.message }, { status: 500 })
  return Response.json({ ok: true })
}
