import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

export async function PATCH(req: NextRequest) {
  const { ids }: { ids: string[] } = await req.json()

  if (!Array.isArray(ids) || ids.length === 0) {
    return NextResponse.json({ error: 'ids array required' }, { status: 400 })
  }

  const updates = ids.map((id, position) => ({ id, position }))
  const promises = updates.map(({ id, position }) =>
    supabase.from('channel_groups').update({ position }).eq('id', id)
  )
  await Promise.all(promises)

  return NextResponse.json({ ok: true })
}
