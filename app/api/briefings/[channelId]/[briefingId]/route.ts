import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { deleteTtsAudio } from '@/lib/tts'

interface Params {
  params: Promise<{ channelId: string; briefingId: string }>
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const { channelId, briefingId } = await params

  const { error } = await supabase
    .from('briefings')
    .delete()
    .eq('id', briefingId)
    .eq('channel_id', channelId)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  // Storage has no cascade — drop any cached premium audio for this briefing
  deleteTtsAudio('briefing', [briefingId]).catch(() => {})
  return NextResponse.json({ ok: true })
}
