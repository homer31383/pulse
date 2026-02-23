import { NextRequest } from 'next/server'
import { anthropic, DEFAULT_MODEL } from '@/lib/anthropic'
import { supabase } from '@/lib/supabase'
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

  const conversationText = messages
    .map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
    .join('\n\n')

  const model = DEFAULT_MODEL

  try {
    const response = await anthropic.messages.create({
      model,
      max_tokens: 1024,
      system: `You extract channel configuration from a conversation.

Given a conversation where a user and an assistant discussed how to configure an AI briefing channel called "${channel.name}", produce a JSON object with exactly these two keys:

1. "instructions" — A system prompt (starting with "You are…") that will guide an AI when generating news briefings. Capture the user's preferences for focus, format, tone, and any specific inclusions or exclusions.

2. "search_queries" — An array of 2–8 concise search query strings that will be used to find relevant web content. Make them specific and varied.

Return ONLY the raw JSON object — no markdown, no code fences, no explanation.`,
      messages: [
        {
          role: 'user',
          content: `Here is the configuration conversation:\n\n${conversationText}\n\nReturn the JSON configuration now.`,
        },
      ],
    })

    // ── Capture usage ───────────────────────────────────────────────────────
    const inputTokens  = response.usage.input_tokens
    const outputTokens = response.usage.output_tokens
    const costUsd      = calculateCost(model, inputTokens, outputTokens)

    logUsage({
      callType:    'synthesize',
      channelId,
      channelName: channel.name,
      model,
      inputTokens,
      outputTokens,
      costUsd,
    }).catch(() => {})

    const raw = response.content.find((b) => b.type === 'text')?.text?.trim() ?? ''

    // Strip any accidental markdown code fences
    const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim()

    const { instructions, search_queries } = JSON.parse(cleaned) as {
      instructions: string
      search_queries: string[]
    }

    if (typeof instructions !== 'string' || !Array.isArray(search_queries)) {
      throw new Error('Unexpected response shape from model')
    }

    // Persist synthesised values to the channel and mark saved_instructions_at
    await Promise.all([
      supabase
        .from('channels')
        .update({
          instructions,
          search_queries,
          updated_at: new Date().toISOString(),
        })
        .eq('id', channelId),
      supabase
        .from('config_conversations')
        .upsert(
          {
            channel_id: channelId,
            messages,
            saved_instructions_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'channel_id' }
        ),
    ])

    return Response.json({ instructions, search_queries })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Synthesis failed'
    return Response.json({ error: message }, { status: 500 })
  }
}
