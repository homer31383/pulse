// Server-only: log a usage event to Supabase
import { supabase } from './supabase'

export async function logUsage({
  callType,
  channelId,
  channelName,
  model,
  inputTokens,
  outputTokens,
  costUsd,
}: {
  callType: string
  channelId?: string
  channelName?: string
  model: string
  inputTokens: number
  outputTokens: number
  costUsd: number
}) {
  const { error } = await supabase.from('usage_logs').insert({
    call_type:     callType,
    channel_id:    channelId    ?? null,
    channel_name:  channelName  ?? null,
    model,
    input_tokens:  inputTokens,
    output_tokens: outputTokens,
    cost_usd:      costUsd,
  })

  if (error) {
    console.error('[logUsage] Failed to insert usage_logs:', error.message)
  }
}
