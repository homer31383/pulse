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
  cacheCreationTokens,
  cacheReadTokens,
  webSearchCount,
}: {
  callType: string
  channelId?: string
  channelName?: string
  model: string
  inputTokens: number
  outputTokens: number
  costUsd: number
  cacheCreationTokens?: number
  cacheReadTokens?: number
  webSearchCount?: number
}) {
  const baseRow = {
    call_type:     callType,
    channel_id:    channelId    ?? null,
    channel_name:  channelName  ?? null,
    model,
    input_tokens:  inputTokens,
    output_tokens: outputTokens,
    cost_usd:      costUsd,
  }

  const fullRow = {
    ...baseRow,
    cache_creation_tokens: cacheCreationTokens ?? 0,
    cache_read_tokens:     cacheReadTokens ?? 0,
    web_search_count:      webSearchCount ?? 0,
  }

  const { error } = await supabase.from('usage_logs').insert(fullRow)
  if (!error) return

  // Migration 015 not applied yet — fall back to the pre-migration columns
  // so cost tracking never silently stops.
  if (/cache_creation_tokens|cache_read_tokens|web_search_count|schema cache/i.test(error.message)) {
    const { error: fallbackError } = await supabase.from('usage_logs').insert(baseRow)
    if (!fallbackError) {
      console.warn('[logUsage] usage_logs missing migration-015 columns — logged without cache/search detail. Run supabase/migrations/015_usage_log_details.sql.')
      return
    }
    console.error('[logUsage] Failed to insert usage_logs:', fallbackError.message)
    return
  }

  console.error('[logUsage] Failed to insert usage_logs:', error.message)
}
