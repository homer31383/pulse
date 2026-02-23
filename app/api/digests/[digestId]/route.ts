import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

interface Params {
  params: Promise<{ digestId: string }>
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const { digestId } = await params

  const { error } = await supabase
    .from('digests')
    .delete()
    .eq('id', digestId)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
