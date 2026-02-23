import { anthropic, DEFAULT_MODEL } from '@/lib/anthropic'
import { supabase } from '@/lib/supabase'
import { calculateCost } from '@/lib/cost'
import { logUsage } from '@/lib/usage'

export async function POST() {
  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    async start(controller) {
      function send(data: object) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`))
      }

      try {
        const { data: settings } = await supabase
          .from('settings')
          .select('model')
          .eq('id', 'default')
          .single()

        const model = settings?.model ?? DEFAULT_MODEL

        // Fetch briefings from the past 7 days
        const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
        const { data: briefings } = await supabase
          .from('briefings')
          .select('content, created_at, channel_id')
          .gte('created_at', since)
          .order('created_at', { ascending: false })
          .limit(20)

        if (!briefings || briefings.length === 0) {
          send({ type: 'error', error: 'No recent briefings found. Generate some briefings first.' })
          controller.close()
          return
        }

        const channelIds = [...new Set(briefings.map((b) => b.channel_id))]
        const { data: channels } = await supabase
          .from('channels')
          .select('id, name')
          .in('id', channelIds)

        const channelMap = new Map((channels ?? []).map((c) => [c.id, c.name]))

        const briefingContext = briefings
          .map((b) => {
            const channelName = channelMap.get(b.channel_id) ?? 'Unknown'
            const date = new Date(b.created_at).toDateString()
            const truncated = b.content.slice(0, 2000)
            const ellipsis = b.content.length > 2000 ? '\n[…]' : ''
            return `### ${channelName} (${date})\n${truncated}${ellipsis}`
          })
          .join('\n\n---\n\n')

        const systemPrompt =
          `You are an analyst identifying meaningful thematic connections across multiple topic areas.\n` +
          `The user follows ${channelIds.length} channels covering different topics.\n` +
          `Your job: surface the 3–5 most significant thematic links, converging trends, or interesting tensions that span multiple channels.\n\n` +
          `For each connection:\n` +
          `- Give it a clear ## heading\n` +
          `- Explain the connection in 2–3 sentences\n` +
          `- Cite the specific channels and examples that support it\n\n` +
          `Be analytical and specific. Avoid obvious observations.`

        const userMessage =
          `Here are recent briefings from ${briefings.length} entries across ${channelIds.length} channels.\n` +
          `Today's date: ${new Date().toDateString()}\n\n` +
          `${briefingContext}`

        const messageStream = anthropic.messages.stream({
          model,
          max_tokens: 3000,
          system: systemPrompt,
          messages: [{ role: 'user', content: userMessage }],
        })

        for await (const event of messageStream) {
          if (
            event.type === 'content_block_delta' &&
            event.delta.type === 'text_delta'
          ) {
            send({ type: 'text_delta', text: event.delta.text })
          }
        }

        // ── Capture usage ─────────────────────────────────────────────────
        const finalMsg     = await messageStream.finalMessage()
        const inputTokens  = finalMsg.usage.input_tokens
        const outputTokens = finalMsg.usage.output_tokens
        const costUsd      = calculateCost(model, inputTokens, outputTokens)

        logUsage({
          callType: 'cross_channel',
          model,
          inputTokens,
          outputTokens,
          costUsd,
        }).catch(() => {})

        send({ type: 'done', usage: { inputTokens, outputTokens, costUsd } })
      } catch (err) {
        send({ type: 'error', error: err instanceof Error ? err.message : 'Analysis failed' })
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
