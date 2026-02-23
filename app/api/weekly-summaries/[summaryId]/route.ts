import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

interface Params {
  params: Promise<{ summaryId: string }>
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const { summaryId } = await params

  const { error } = await supabase
    .from('weekly_summaries')
    .delete()
    .eq('id', summaryId)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
