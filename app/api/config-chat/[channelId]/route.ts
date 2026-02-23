import { NextRequest } from 'next/server'
import { anthropic, DEFAULT_MODEL } from '@/lib/anthropic'
import { calculateCost } from '@/lib/cost'
import { logUsage } from '@/lib/usage'
import type { Channel, ConversationMessage } from '@/lib/types'

interface Params {
  params: Promise<{ channelId: string }>
}

export async function POST(req: NextRequest, { params }: Params) {
  const { channelId } = await params

  const {
    messages,
    channel,
  }: { messages: ConversationMessage[]; channel: Channel } = await req.json()

  const encoder = new TextEncoder()

  const systemPrompt = `You are a helpful assistant that specialises in configuring AI news briefing channels.

The user is setting up a channel called "${channel.name}".${
    channel.description ? `\nChannel description: ${channel.description}` : ''
  }

A channel has two configuration fields:
1. **instructions** — A system prompt given to the AI when generating briefings. It shapes the perspective, tone, format, and focus of the output.
2. **search_queries** — An array of search terms used to find relevant news and information on the web.

Current configuration:
- Instructions: ${channel.instructions ? `"${channel.instructions}"` : 'Not yet set'}
- Search queries: ${channel.search_queries?.length ? channel.search_queries.map((q) => `"${q}"`).join(', ') : 'Not yet set'}

Your goal is to have a focused conversation that helps the user clarify:
- Which specific aspects of "${channel.name}" they care most about
- What format they prefer (executive summary, bullet points, deep-dive analysis, etc.)
- What perspective or angle they want (technical, business, general audience, etc.)
- What to include and what to exclude
- Any sources, regions, or topics to prioritise

Ask one or two targeted questions at a time. When you have a clear picture of what they want, suggest a revised instructions block and updated search queries. Once they seem satisfied, remind them to click **"Save instructions from this chat"** to automatically extract and apply the configuration.`

  const stream = new ReadableStream({
    async start(controller) {
      function send(data: object) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`))
      }

      try {
        const model = DEFAULT_MODEL

        const messageStream = anthropic.messages.stream({
          model,
          max_tokens: 1024,
          system: systemPrompt,
          messages: messages.map((m) => ({
            role: m.role,
            content: m.content,
          })),
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
          callType:    'config_chat',
          channelId,
          channelName: channel.name,
          model,
          inputTokens,
          outputTokens,
          costUsd,
        }).catch(() => {})

        send({ type: 'done' })
      } catch (err) {
        send({
          type: 'error',
          error: err instanceof Error ? err.message : 'Chat generation failed',
        })
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
