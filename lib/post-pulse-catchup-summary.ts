// Post-Pulse catch-up summary — server-only, ON DEMAND ONLY.
//
// The one model call behind the panel's "Summarize" button: no tools, no web
// search, effort low, on the profile's model, reading only the text of the
// panel's items (capped by buildSummaryInput). The result is cached on the
// settings row against the item set, so reopening the panel doesn't pay
// again. Truncation/empty output goes through the same assertCompleteOutput
// guard as briefings: nothing is cached and the spend is logged as
// pp_catchup_failed.

import { supabase } from './supabase'
import { anthropic } from './anthropic'
import { assertCompleteOutput } from './generation'
import { calculateCost } from './cost'
import { logUsage } from './usage'
import {
  CATCHUP_SUMMARY_MAX_TOKENS,
  CATCHUP_SUMMARY_SYSTEM,
  buildSummaryInput,
  catchupRange,
  compileCatchup,
  fetchCatchupSettings,
} from './post-pulse-catchup'
import type { CatchupSummary } from './post-pulse-catchup-types'

const CHANNEL_NAME = 'Post-Pulse catch-up'

export async function summarizeCatchup(
  profileId: string,
  until: Date,
): Promise<{ summary: CatchupSummary; cached: boolean; itemKey: string } | { empty: true }> {
  const settings = await fetchCatchupSettings(profileId)
  const range = catchupRange(settings.lastSeen, until)
  const compiled = await compileCatchup(profileId, range, range.longAbsence)
  if (compiled.items.length === 0) return { empty: true }

  if (settings.cached?.itemKey === compiled.itemKey) {
    const { itemKey: _k, ...summary } = settings.cached
    void _k
    return { summary, cached: true, itemKey: compiled.itemKey }
  }

  const input = buildSummaryInput(compiled)
  const model = settings.model

  let inputTokens = 0
  let outputTokens = 0
  let content = ''
  try {
    const stream = anthropic.messages.stream({
      model,
      max_tokens: CATCHUP_SUMMARY_MAX_TOKENS,
      output_config: { effort: 'low' },
      system: CATCHUP_SUMMARY_SYSTEM,
      messages: [
        {
          role: 'user',
          content:
            `${compiled.summaryItems.length} item(s) published since my last visit` +
            `${compiled.items.length > compiled.summaryItems.length ? ` (the newest ${compiled.summaryItems.length} of ${compiled.items.length})` : ''}:\n\n` +
            input,
        },
      ],
    } as Parameters<typeof anthropic.messages.stream>[0])

    for await (const event of stream) {
      // Track usage as it streams so a mid-stream failure still logs its spend.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const e = event as any
      if (e.type === 'message_start') {
        inputTokens = e.message?.usage?.input_tokens ?? 0
        outputTokens = e.message?.usage?.output_tokens ?? 0
      } else if (e.type === 'message_delta' && e.usage) {
        outputTokens = e.usage.output_tokens ?? outputTokens
      } else if (e.type === 'content_block_delta' && e.delta?.type === 'text_delta') {
        content += e.delta.text
      }
    }
    const final = await stream.finalMessage()
    inputTokens = final.usage.input_tokens
    outputTokens = final.usage.output_tokens

    assertCompleteOutput({
      content,
      stopReason: final.stop_reason as string,
      maxTokens: CATCHUP_SUMMARY_MAX_TOKENS,
      minChars: 100,
      tag: '[catchup]',
      label: 'Catch-up summary',
      noun: 'summary',
      context: `items=${compiled.summaryItems.length}, input_chars=${input.length}, output_tokens=${outputTokens}`,
      emptyDetail: `${outputTokens} output tokens spent`,
    })
  } catch (err) {
    if (inputTokens + outputTokens > 0) {
      await logUsage({
        callType: 'pp_catchup_failed',
        channelName: CHANNEL_NAME,
        model,
        inputTokens,
        outputTokens,
        costUsd: calculateCost(model, inputTokens, outputTokens),
      })
    }
    throw err
  }

  const costUsd = calculateCost(model, inputTokens, outputTokens)
  await logUsage({ callType: 'pp_catchup', channelName: CHANNEL_NAME, model, inputTokens, outputTokens, costUsd })
  console.log(
    `[catchup] summary: model=${model} items=${compiled.summaryItems.length} input_chars=${input.length} ` +
    `in=${inputTokens} out=${outputTokens} cost=$${costUsd.toFixed(4)}`,
  )

  const summary: CatchupSummary = { content: content.trim(), model, costUsd, createdAt: new Date().toISOString() }
  const { error } = await supabase
    .from('settings')
    .update({
      post_pulse_catchup_summary: {
        item_key: compiled.itemKey,
        content: summary.content,
        model,
        cost_usd: costUsd,
        created_at: summary.createdAt,
      },
    })
    .eq('id', profileId)
  if (error) console.warn(`[catchup] summary not cached: ${error.message}`)

  return { summary, cached: false, itemKey: compiled.itemKey }
}
