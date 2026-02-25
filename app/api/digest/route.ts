import { NextRequest } from 'next/server'
import { cookies } from 'next/headers'
import { anthropic, DEFAULT_MODEL } from '@/lib/anthropic'
import { supabase } from '@/lib/supabase'
import { calculateCost } from '@/lib/cost'
import { logUsage } from '@/lib/usage'
import type { Channel, Source } from '@/lib/types'

const DEFAULT_PROFILE_ID = '00000000-0000-0000-0000-000000000001'

const DENSITY_INSTRUCTIONS: Record<string, string> = {
  dense: 'Write in dense, information-rich style: include all significant data points, statistics, percentages, names, dates, and technical detail.',
  balanced: 'Write in a balanced style: cover key developments with enough context to understand their significance.',
  narrative: 'Write in flowing narrative prose. Focus on the most impactful stories per channel. Summarise supporting details into clear, readable paragraphs.',
}

export async function POST(req: NextRequest) {
  const { channels }: { channels: Channel[] } = await req.json()

  if (!channels?.length) {
    return Response.json({ error: 'No channels provided' }, { status: 400 })
  }

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
          .select('*')
          .eq('id', profileId)
          .single()

        const model = settings?.model ?? DEFAULT_MODEL
        const density = settings?.briefing_density ?? 'balanced'

        const channelList = channels
          .map((c) => `- **${c.name}**: ${c.search_queries?.join(', ') || c.name}`)
          .join('\n')

        let systemPrompt =
          `You are a research assistant generating a morning digest across multiple interest channels.\n` +
          `Search the web for the latest information on all topics and produce a single, unified briefing.\n\n` +
          `Structure:\n` +
          `1. ## Key Takeaways — 4-6 cross-cutting insights across all channels\n` +
          `2. One ## [Channel Name] section per channel with its key updates\n\n` +
          `Channels covered:\n${channelList}`

        const densityInstruction = DENSITY_INSTRUCTIONS[density]
        if (densityInstruction) systemPrompt += `\n\n${densityInstruction}`

        if (settings?.watchlist_enabled && settings?.watchlist_terms?.length > 0) {
          systemPrompt += `\n\nAlways surface relevant information about these watchlist items: ${settings.watchlist_terms.join(', ')}`
        }

        const allQueries = channels
          .flatMap((c) => c.search_queries ?? [c.name])
          .slice(0, 12)
          .join(', ')

        const userMessage =
          `Generate a morning digest covering all channels.\n` +
          `Suggested search queries: ${allQueries}\n` +
          `Today's date: ${new Date().toDateString()}`

        const sources: Source[] = []
        let accumulatedContent = ''
        let currentBlockType = ''
        let currentInputJson = ''

        const messageStream = anthropic.messages.stream(
          {
            model,
            max_tokens: 6000,
            system: systemPrompt,
            messages: [{ role: 'user', content: userMessage }],
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            tools: [{ type: 'web_search_20250305', name: 'web_search' }] as any,
          },
          { headers: { 'anthropic-beta': 'web-search-2025-03-05' } },
        )

        for await (const event of messageStream) {
          switch (event.type) {
            case 'content_block_start': {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const block = event.content_block as any
              currentBlockType = block.type ?? ''
              currentInputJson = ''
              if (block.type === 'web_search_tool_result') {
                const results: unknown[] = Array.isArray(block.content) ? block.content : []
                for (const r of results) {
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  const result = r as any
                  if (result.type === 'web_search_result' && result.url) {
                    const source: Source = { title: result.title || result.url, url: result.url }
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
                accumulatedContent += delta.text
                send({ type: 'text_delta', text: delta.text })
              }
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              if (delta.type === 'input_json_delta' && currentBlockType === 'server_tool_use')
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                currentInputJson += (delta as any).partial_json ?? ''
              break
            }
            case 'content_block_stop': {
              if (currentBlockType === 'server_tool_use' && currentInputJson) {
                try {
                  const input = JSON.parse(currentInputJson) as { query?: string }
                  if (input.query) send({ type: 'searching', query: input.query })
                } catch { /* skip */ }
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

        // ── Persist digest to its own table ──────────────────────────────
        const { data: digestRow } = await supabase
          .from('digests')
          .insert({
            content:       accumulatedContent,
            sources,
            channel_ids:   channels.map((c) => c.id),
            channel_names: channels.map((c) => c.name),
            model,
            profile_id:    profileId,
          })
          .select('id')
          .single()

        logUsage({
          callType: 'digest',
          model,
          inputTokens,
          outputTokens,
          costUsd,
        }).catch(() => {})

        send({ type: 'done', briefingId: digestRow?.id, usage: { inputTokens, outputTokens, costUsd } })
      } catch (err) {
        send({ type: 'error', error: err instanceof Error ? err.message : 'Digest generation failed' })
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
