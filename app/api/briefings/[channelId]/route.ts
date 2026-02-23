import { NextRequest } from 'next/server'
import { anthropic, DEFAULT_MODEL } from '@/lib/anthropic'
import { supabase } from '@/lib/supabase'
import { calculateCost } from '@/lib/cost'
import { logUsage } from '@/lib/usage'
import type { Channel, Source } from '@/lib/types'

const DENSITY_INSTRUCTIONS: Record<string, string> = {
  dense:
    'Write in dense, information-rich style: include all significant data points, statistics, percentages, names, dates, and technical detail. Prioritise completeness over brevity.',
  balanced:
    'Write in a balanced style: cover key developments with enough context to understand their significance. Include the most important data points but avoid exhaustive detail.',
  narrative:
    'Write in flowing narrative prose. Focus on the 3–5 most impactful stories. Summarise supporting details into clear, readable paragraphs rather than bullet lists.',
}

interface Params {
  params: Promise<{ channelId: string }>
}

export async function POST(req: NextRequest, { params }: Params) {
  const { channelId } = await params
  const { channel }: { channel: Channel } = await req.json()

  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    async start(controller) {
      function send(data: object) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`))
      }

      try {
        // ── Fetch previous briefing + app settings in parallel ────────────
        const [prevResult, settingsResult] = await Promise.all([
          supabase
            .from('briefings')
            .select('content, created_at')
            .eq('channel_id', channelId)
            .order('created_at', { ascending: false })
            .limit(1)
            .single(),
          supabase
            .from('settings')
            .select('*')
            .eq('id', 'default')
            .single(),
        ])

        const previousBriefing = prevResult.data
        const settings = settingsResult.data
        const model = settings?.model ?? DEFAULT_MODEL
        const density = settings?.briefing_density ?? 'balanced'

        const queries = channel.search_queries?.join(', ') || channel.name
        let systemPrompt = channel.instructions?.trim()
          ? channel.instructions
          : `You are a research assistant. Search the web and provide a concise, well-structured briefing about: ${channel.name}`

        // Append density instruction
        const densityInstruction = DENSITY_INSTRUCTIONS[density]
        if (densityInstruction) {
          systemPrompt += `\n\n${densityInstruction}`
        }

        // Inject watchlist terms
        if (settings?.watchlist_enabled && settings?.watchlist_terms?.length > 0) {
          const terms = settings.watchlist_terms.join(', ')
          systemPrompt += `\n\nAlways surface any relevant information about these watchlist items: ${terms}`
        }

        // Build user message — include previous briefing context when available
        let previousContext = ''
        if (previousBriefing?.content) {
          const prevDate = new Date(previousBriefing.created_at).toDateString()
          const truncated = previousBriefing.content.slice(0, 5000)
          const ellipsis = previousBriefing.content.length > 5000 ? '\n\n[…truncated…]' : ''
          previousContext =
            `\n\n---\nPREVIOUS BRIEFING (${prevDate}):\n${truncated}${ellipsis}\n---\n\n` +
            `Where relevant, note what has changed, developed further, or dropped off since the previous briefing above.`
        }

        const userMessage =
          `Search queries to use: ${queries}\n\n` +
          `Please search the web for the latest information and produce a comprehensive briefing as well-formatted Markdown.\n` +
          `Include a short "## Key Takeaways" section at the top, then detailed sections below.\n` +
          `Today's date: ${new Date().toDateString()}` +
          previousContext

        let fullContent = ''
        const sources: Source[] = []

        // ── Stream with web search tool ───────────────────────────────────
        const messageStream = anthropic.messages.stream(
          {
            model,
            max_tokens: 4096,
            system: systemPrompt,
            messages: [{ role: 'user', content: userMessage }],
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            tools: [{ type: 'web_search_20250305', name: 'web_search' }] as any,
          },
          { headers: { 'anthropic-beta': 'web-search-2025-03-05' } },
        )

        let currentBlockType = ''
        let currentInputJson = ''

        for await (const event of messageStream) {
          switch (event.type) {
            case 'content_block_start': {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const block = event.content_block as any
              currentBlockType = block.type ?? ''
              currentInputJson = ''

              if (block.type === 'web_search_tool_result') {
                const results: unknown[] = Array.isArray(block.content)
                  ? block.content
                  : []
                for (const r of results) {
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  const result = r as any
                  if (result.type === 'web_search_result' && result.url) {
                    const source: Source = {
                      title: result.title || result.url,
                      url: result.url,
                      snippet: result.encrypted_content
                        ? undefined
                        : result.snippet,
                    }
                    sources.push(source)
                    send({ type: 'source', source })
                  }
                }
              }
              break
            }

            case 'content_block_delta': {
              const delta = event.delta
              if (delta.type === 'text_delta') {
                fullContent += delta.text
                send({ type: 'text_delta', text: delta.text })
              }
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              if (delta.type === 'input_json_delta' && currentBlockType === 'server_tool_use') {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                currentInputJson += (delta as any).partial_json ?? ''
              }
              break
            }

            case 'content_block_stop': {
              if (currentBlockType === 'server_tool_use' && currentInputJson) {
                try {
                  const input = JSON.parse(currentInputJson) as { query?: string }
                  if (input.query) {
                    send({ type: 'searching', query: input.query })
                  }
                } catch {
                  // malformed JSON — skip
                }
              }
              currentBlockType = ''
              currentInputJson = ''
              break
            }
          }
        }

        // ── Capture usage ─────────────────────────────────────────────────
        const finalMsg     = await messageStream.finalMessage()
        const inputTokens  = finalMsg.usage.input_tokens
        const outputTokens = finalMsg.usage.output_tokens
        const costUsd      = calculateCost(model, inputTokens, outputTokens)

        // ── Persist to Supabase ───────────────────────────────────────────
        const [briefingResult] = await Promise.all([
          supabase
            .from('briefings')
            .insert({ channel_id: channelId, content: fullContent, sources, model })
            .select('id')
            .single(),
          supabase
            .from('channels')
            .update({ last_briefed_at: new Date().toISOString() })
            .eq('id', channelId),
        ])

        // ── Log usage (fire-and-forget) ───────────────────────────────────
        logUsage({
          callType:    'briefing',
          channelId,
          channelName: channel.name,
          model,
          inputTokens,
          outputTokens,
          costUsd,
        }).catch(() => {})

        send({
          type:       'done',
          briefingId: briefingResult.data?.id,
          usage:      { inputTokens, outputTokens, costUsd },
        })
      } catch (err) {
        send({
          type: 'error',
          error: err instanceof Error ? err.message : 'Briefing generation failed',
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
