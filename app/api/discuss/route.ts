import { NextRequest } from 'next/server'
import { cookies } from 'next/headers'
import { anthropic, DEFAULT_MODEL } from '@/lib/anthropic'
import { supabase } from '@/lib/supabase'
import { calculateCost } from '@/lib/cost'
import { logUsage } from '@/lib/usage'
import type { ConversationMessage, Source } from '@/lib/types'

const DEFAULT_PROFILE_ID = '00000000-0000-0000-0000-000000000001'

function friendlyError(err: unknown): string {
  if (!(err instanceof Error)) return 'Failed to generate response'
  const msg = err.message
  // Anthropic SDK errors surface status codes in the message
  if (msg.includes('429') || /rate.?limit/i.test(msg)) {
    return 'Rate limit reached — please wait a moment and try again.'
  }
  if (/credit|billing|payment/i.test(msg)) {
    return 'API credits exhausted. Please check your Anthropic account billing.'
  }
  if (msg.includes('529') || /overload/i.test(msg)) {
    return 'The AI service is temporarily overloaded. Please try again in a moment.'
  }
  if (msg.includes('401') || /auth|api.?key/i.test(msg)) {
    return 'Authentication failed — check that ANTHROPIC_API_KEY is set correctly.'
  }
  return msg
}

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

  const cookieStore = await cookies()
  const profileId = cookieStore.get('profile_id')?.value ?? DEFAULT_PROFILE_ID

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
          .eq('id', profileId)
          .single()
        const model = settings?.model ?? DEFAULT_MODEL

        const truncated = briefingContent.slice(0, 8000)
        const ellipsis = briefingContent.length > 8000 ? '\n\n[…content truncated…]' : ''

        const systemPrompt =
          `You are a knowledgeable research assistant. You have access to a briefing about "${channelName}" ` +
          `that you can reference, and you also have the ability to search the web for additional information. ` +
          `Use your judgment about when to search — for questions that go beyond the briefing, need updated information, ` +
          `require deeper explanation of concepts, or ask about related topics, search the web to give a comprehensive answer. ` +
          `Be conversational, direct, and concise.\n\n` +
          `THE BRIEFING (for reference):\n\n${truncated}${ellipsis}`

        let currentBlockType = ''
        let currentInputJson = ''

        const messageStream = anthropic.messages.stream(
          {
            model,
            max_tokens: 2048,
            system: systemPrompt,
            messages: messages.map((m) => ({ role: m.role, content: m.content })),
            tools: [{ type: 'web_search_20250305', name: 'web_search' }] as any,
          },
          { headers: { 'anthropic-beta': 'web-search-2025-03-05' } },
        )

        for await (const event of messageStream) {
          switch (event.type) {
            case 'content_block_start': {
              const block = event.content_block as any
              currentBlockType = block.type ?? ''
              currentInputJson = ''
              if (block.type === 'web_search_tool_result') {
                const results: unknown[] = Array.isArray(block.content) ? block.content : []
                for (const r of results) {
                  const result = r as any
                  if (result.type === 'web_search_result' && result.url) {
                    const source: Source = { title: result.title || result.url, url: result.url }
                    send({ type: 'source', source })
                  }
                }
              }
              break
            }
            case 'content_block_delta': {
              const delta = event.delta
              if (delta.type === 'text_delta') {
                send({ type: 'text_delta', text: delta.text })
              }
              if (delta.type === 'input_json_delta' && currentBlockType === 'server_tool_use') {
                currentInputJson += (delta as any).partial_json ?? ''
              }
              break
            }
            case 'content_block_stop': {
              if (currentBlockType === 'server_tool_use' && currentInputJson) {
                try {
                  const input = JSON.parse(currentInputJson) as { query?: string }
                  if (input.query) send({ type: 'searching', query: input.query })
                } catch { /* malformed JSON — skip */ }
              }
              currentBlockType = ''
              currentInputJson = ''
              break
            }
          }
        }

        // Signal completion before usage logging so a logging failure
        // can never prevent the client from receiving the done event.
        send({ type: 'done' })

        // ── Capture usage (best-effort) ────────────────────────────────────
        try {
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
        } catch { /* non-critical — don't let this affect the response */ }
      } catch (err) {
        send({
          type: 'error',
          error: friendlyError(err),
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
