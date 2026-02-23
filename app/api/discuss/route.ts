import { NextRequest } from 'next/server'
import { anthropic, DEFAULT_MODEL } from '@/lib/anthropic'
import { supabase } from '@/lib/supabase'
import { calculateCost } from '@/lib/cost'
import { logUsage } from '@/lib/usage'
import type { ConversationMessage } from '@/lib/types'

export async function POST(req: NextRequest) {
  const {
    messages,
    briefingContent,
    channelName,
  }: {
    messages: ConversationMessage[]
    briefingContent: string
    channelName: string
  } = await req.json()

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

        const truncated = briefingContent.slice(0, 8000)
        const ellipsis = briefingContent.length > 8000 ? '\n\n[…content truncated…]' : ''

        const systemPrompt =
          `You are a knowledgeable assistant who has just written a briefing about "${channelName}". ` +
          `You know this briefing inside out and can answer questions about it — explaining concepts, ` +
          `going deeper on specific points, comparing to historical context, exploring implications, ` +
          `or clarifying anything confusing. Be conversational, direct, and concise.\n\n` +
          `THE BRIEFING YOU WROTE:\n\n${truncated}${ellipsis}`

        const messageStream = anthropic.messages.stream({
          model,
          max_tokens: 1024,
          system: systemPrompt,
          messages: messages.map((m) => ({ role: m.role, content: m.content })),
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
          callType:    'discuss',
          channelName,
          model,
          inputTokens,
          outputTokens,
          costUsd,
        }).catch(() => {})

        send({ type: 'done' })
      } catch (err) {
        send({
          type: 'error',
          error: err instanceof Error ? err.message : 'Failed to generate response',
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
