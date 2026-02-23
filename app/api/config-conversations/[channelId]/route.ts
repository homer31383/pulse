import { NextRequest } from 'next/server'
import { supabase } from '@/lib/supabase'
import type { ConversationMessage } from '@/lib/types'

interface Params {
  params: Promise<{ channelId: string }>
}

// GET — fetch the current conversation for a channel
export async function GET(_req: NextRequest, { params }: Params) {
  const { channelId } = await params

  const { data, error } = await supabase
    .from('config_conversations')
    .select('*')
    .eq('channel_id', channelId)
    .single()

  if (error || !data) {
    return Response.json({ messages: [] })
  }

  return Response.json({ messages: data.messages ?? [] })
}

// PUT — upsert the conversation messages for a channel
export async function PUT(req: NextRequest, { params }: Params) {
  const { channelId } = await params
  const { messages }: { messages: ConversationMessage[] } = await req.json()

  const { error } = await supabase
    .from('config_conversations')
    .upsert(
      {
        channel_id: channelId,
        messages,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'channel_id' }
    )

  if (error) {
    return Response.json({ error: error.message }, { status: 500 })
  }

  return Response.json({ ok: true })
}
