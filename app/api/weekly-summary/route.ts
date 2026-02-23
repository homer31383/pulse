import { NextRequest } from 'next/server'
import { anthropic, DEFAULT_MODEL } from '@/lib/anthropic'
import { supabase } from '@/lib/supabase'
import { calculateCost } from '@/lib/cost'
import { logUsage } from '@/lib/usage'

export async function POST(_req: NextRequest) {
  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    async start(controller) {
      function send(data: object) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`))
      }

      try {
        // ── Fetch settings + last 7 days of briefings in parallel ────────
        const weekStart = new Date()
        weekStart.setDate(weekStart.getDate() - 7)
        const weekStartIso = weekStart.toISOString()

        const [settingsResult, briefingsResult] = await Promise.all([
          supabase.from('settings').select('*').eq('id', 'default').single(),
          supabase
            .from('briefings')
            .select('channel_id, content, created_at, channels(name)')
            .gte('created_at', weekStartIso)
            .order('created_at', { ascending: false }),
        ])

        const settings = settingsResult.data
        const model = settings?.model ?? DEFAULT_MODEL

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const rawBriefings = (briefingsResult.data ?? []) as any[] as Array<{
          channel_id: string
          content: string
          created_at: string
          channels: { name: string } | null
        }>

        if (rawBriefings.length === 0) {
          send({ type: 'error', error: 'No briefings found in the past 7 days. Generate some briefings first.' })
          controller.close()
          return
        }

        // ── Group briefings by channel (max 3 per channel, max 2000 chars each) ──
        const byChannel = new Map<string, { name: string; entries: string[] }>()
        for (const b of rawBriefings) {
          const channelName = b.channels?.name ?? 'Unknown'
          if (!byChannel.has(b.channel_id)) {
            byChannel.set(b.channel_id, { name: channelName, entries: [] })
          }
          const bucket = byChannel.get(b.channel_id)!
          if (bucket.entries.length < 3) {
            const date = new Date(b.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
            const truncated = b.content.length > 2000 ? b.content.slice(0, 2000) + '\n[…truncated]' : b.content
            bucket.entries.push(`**${date}**\n${truncated}`)
          }
        }

        const channelNames = Array.from(byChannel.values()).map((v) => v.name)

        const channelSections = Array.from(byChannel.values())
          .map(({ name, entries }) => `### ${name}\n\n${entries.join('\n\n---\n\n')}`)
          .join('\n\n')

        const systemPrompt =
          `You are a senior analyst producing a Weekly Summary that synthesises the past 7 days ` +
          `of briefings across multiple interest channels. ` +
          `Your job is to identify what truly mattered this week, spot patterns across channels, ` +
          `and surface insights that a busy reader would want.\n\n` +
          `Structure your response as well-formatted Markdown with these sections:\n` +
          `1. ## Key Developments — The 4–6 most important things that happened this week across all channels\n` +
          `2. ## Emerging Themes — Patterns, trends, or narratives that appear across multiple channels\n` +
          `3. ## Cross-Channel Connections — Notable links or interactions between topics\n` +
          `4. ## What to Watch — Top 3–5 things to keep an eye on next week\n\n` +
          `Channels covered: ${channelNames.join(', ')}\n\n` +
          `Be analytical and editorial, not just descriptive. Prioritise synthesis over summary.`

        const userMessage =
          `Here are the briefings from the past 7 days. Please produce the weekly summary.\n\n` +
          `Week of ${weekStart.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })} — ` +
          `${new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}\n\n` +
          channelSections

        let fullContent = ''

        // ── Stream (no web search — synthesis only) ───────────────────────
        const messageStream = anthropic.messages.stream({
          model,
          max_tokens: 4096,
          system: systemPrompt,
          messages: [{ role: 'user', content: userMessage }],
        })

        for await (const event of messageStream) {
          if (
            event.type === 'content_block_delta' &&
            event.delta.type === 'text_delta'
          ) {
            fullContent += event.delta.text
            send({ type: 'text_delta', text: event.delta.text })
          }
        }

        const finalMsg     = await messageStream.finalMessage()
        const inputTokens  = finalMsg.usage.input_tokens
        const outputTokens = finalMsg.usage.output_tokens
        const costUsd      = calculateCost(model, inputTokens, outputTokens)

        // ── Persist ───────────────────────────────────────────────────────
        const weekStartDate = weekStart.toISOString().slice(0, 10)
        const { data: summaryRow } = await supabase
          .from('weekly_summaries')
          .insert({
            content:       fullContent,
            channel_names: channelNames,
            model,
            week_start:    weekStartDate,
          })
          .select('id')
          .single()

        logUsage({
          callType:    'weekly_summary',
          model,
          inputTokens,
          outputTokens,
          costUsd,
        }).catch(() => {})

        send({ type: 'done', briefingId: summaryRow?.id, usage: { inputTokens, outputTokens, costUsd } })
      } catch (err) {
        send({ type: 'error', error: err instanceof Error ? err.message : 'Weekly summary generation failed' })
      } finally {
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  })
}
