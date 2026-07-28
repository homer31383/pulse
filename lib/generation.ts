// Server-side briefing/digest generation shared by the SSE streaming routes
// and the scheduled-briefings cron route. Never import in 'use client' files.
import { anthropic, resolveModel } from '@/lib/anthropic'
import { supabase } from '@/lib/supabase'
import { calculateCost } from '@/lib/cost'
import { logUsage } from '@/lib/usage'
import type { Channel, Source } from '@/lib/types'

export const BRIEFING_DENSITY_INSTRUCTIONS: Record<string, string> = {
  dense:
    'Write in dense, information-rich style: include all significant data points, statistics, percentages, names, dates, and technical detail. Prioritise completeness over brevity.',
  balanced:
    'Write in a balanced style: cover key developments with enough context to understand their significance. Include the most important data points but avoid exhaustive detail.',
  narrative:
    'Write in flowing narrative prose. Focus on the 3–5 most impactful stories. Summarise supporting details into clear, readable paragraphs rather than bullet lists.',
}

export const DIGEST_DENSITY_INSTRUCTIONS: Record<string, string> = {
  dense: 'Write in dense, information-rich style: include all significant data points, statistics, percentages, names, dates, and technical detail.',
  balanced: 'Write in a balanced style: cover key developments with enough context to understand their significance.',
  narrative: 'Write in flowing narrative prose. Focus on the most impactful stories per channel. Summarise supporting details into clear, readable paragraphs.',
}

export type GenerationEvent =
  | { type: 'searching'; query: string }
  | { type: 'source'; source: Source }
  | { type: 'text_delta'; text: string }
  | { type: 'rate_limited'; retryIn: number }

export interface GenerationUsage {
  inputTokens: number
  outputTokens: number
  costUsd: number
  cacheCreationTokens?: number
  cacheReadTokens?: number
  webSearchCount?: number
}

export interface GenerationResult {
  id?: string
  content: string
  sources: Source[]
  usage: GenerationUsage
}

type OnEvent = (event: GenerationEvent) => void

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// Run fn, retrying once after 65s on a 429 (mirrors the original SSE routes)
async function withRateLimitRetry<T>(fn: () => Promise<T>, onEvent?: OnEvent): Promise<T> {
  try {
    return await fn()
  } catch (err) {
    const isRateLimit = err instanceof Error && 'status' in err && (err as { status?: number }).status === 429
    if (!isRateLimit) throw err
    const retryIn = 65
    onEvent?.({ type: 'rate_limited', retryIn })
    await sleep(retryIn * 1000)
    return await fn()
  }
}

// Stream a web-search message and collect content, sources, and usage
async function runWebSearchStream(params: {
  model: string
  maxTokens: number
  maxSearches: number
  system: string
  userMessage: string
  onEvent?: OnEvent
}): Promise<{
  content: string
  sources: Source[]
  inputTokens: number
  outputTokens: number
  cacheCreationTokens: number
  cacheReadTokens: number
  webSearchCount: number
}> {
  const { model, maxTokens, maxSearches, system, userMessage, onEvent } = params

  let content = ''
  const sources: Source[] = []
  let currentBlockType = ''
  let currentInputJson = ''

  // The model must know about the max_uses cap: without this, Sonnet 5 treats
  // the "server tool use limit exceeded" error on search N+1 as an outage and
  // retries in a loop with sandbox sleeps — minutes of silent wall-clock —
  // then writes an apology instead of the briefing.
  const searchBudgetNote =
    `\n\nYou have a hard limit of ${maxSearches} web searches for this task — plan your queries to fit it. ` +
    `If a search returns an error or the limit is reached, do NOT retry, wait, or mention the limit: ` +
    `immediately write the briefing from the results you already have. ` +
    `Never narrate your research process — write no text between searches or tool calls. ` +
    `Your only text output is the finished briefing itself.`

  // Hard bounds so a stalled or grinding request fails cleanly instead of
  // hanging until a platform timeout: an overall deadline, plus an idle
  // watchdog that aborts when the stream goes silent (e.g. the model
  // sleeping in the code-execution sandbox between retries).
  const OVERALL_TIMEOUT_MS = 300_000
  const IDLE_TIMEOUT_MS = 120_000
  const controller = new AbortController()
  let timedOutReason: string | null = null
  const deadline = setTimeout(() => {
    timedOutReason = `generation exceeded ${OVERALL_TIMEOUT_MS / 1000}s`
    controller.abort()
  }, OVERALL_TIMEOUT_MS)
  let idleTimer: ReturnType<typeof setTimeout> | undefined
  const resetIdle = () => {
    clearTimeout(idleTimer)
    idleTimer = setTimeout(() => {
      timedOutReason = `stream produced no events for ${IDLE_TIMEOUT_MS / 1000}s`
      controller.abort()
    }, IDLE_TIMEOUT_MS)
  }
  resetIdle()

  // Usage accumulates across pause_turn continuations (each is its own request)
  let totalInput = 0
  let totalOutput = 0
  let totalCacheW = 0
  let totalCacheR = 0
  let totalSearches = 0

  // Conversation grows if the server tool loop pauses and we resume
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const messages: any[] = [
    {
      role: 'user',
      content: [{ type: 'text', text: userMessage, cache_control: { type: 'ephemeral' } }],
    },
  ]
  const MAX_CONTINUATIONS = 3
  let continuations = 0

  try {
    while (true) {
    // web_search_20260209 (GA, no beta header): dynamic filtering trims search
    // results before they enter the context window. max_uses caps the search
    // loop — each search iteration re-processes all prior results, so cost
    // grows superlinearly with search count.
    //
    // cache_control breakpoints let the server-side search loop reuse the
    // shared prefix (tools + system + user message + accumulated search
    // results) at the 0.1x cache-read rate on iterations 2+ instead of
    // re-billing full input price each iteration.
    const messageStream = anthropic.messages.stream(
      {
        model,
        max_tokens: maxTokens,
        system: [{ type: 'text', text: system + searchBudgetNote, cache_control: { type: 'ephemeral' } }],
        messages,
        // max_uses is per request — shrink it on continuations so the total
        // search budget holds across pause_turn resumes
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        tools: [{ type: 'web_search_20260209', name: 'web_search', max_uses: Math.max(1, maxSearches - totalSearches) }] as any,
      },
      { signal: controller.signal },
    )

    for await (const event of messageStream) {
      resetIdle()
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
              const source: Source = {
                title: result.title || result.url,
                url: result.url,
                snippet: result.encrypted_content ? undefined : result.snippet,
              }
              sources.push(source)
              onEvent?.({ type: 'source', source })
            }
          }
        }
        break
      }

      case 'content_block_delta': {
        const delta = event.delta
        if (delta.type === 'text_delta') {
          content += delta.text
          onEvent?.({ type: 'text_delta', text: delta.text })
        }
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
            if (input.query) onEvent?.({ type: 'searching', query: input.query })
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

    const finalMsg = await messageStream.finalMessage()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const usage = finalMsg.usage as any
    totalInput += usage.input_tokens ?? 0
    totalOutput += usage.output_tokens ?? 0
    totalCacheW += usage.cache_creation_input_tokens ?? 0
    totalCacheR += usage.cache_read_input_tokens ?? 0
    totalSearches += usage.server_tool_use?.web_search_requests ?? 0

    // The server-side tool loop caps its iterations per request; heavy
    // search+filtering turns can hit the cap mid-answer (stop_reason
    // "pause_turn"). Resume by appending the assistant turn and re-sending —
    // otherwise the briefing persists as a truncated stub.
    if ((finalMsg.stop_reason as string) === 'pause_turn' && continuations < MAX_CONTINUATIONS) {
      continuations++
      messages.push({ role: 'assistant', content: finalMsg.content })
      continue
    }

    // Empty/stub guard: a "successful" stream that never produced article
    // text (budget exhausted on thinking/search, e.g. stop max_tokens) must
    // fail loudly, not persist sources-with-no-text. Live routes surface the
    // error; the cron's hourly catch-up regenerates the channel.
    if (content.trim().length < 300) {
      console.warn(
        `[generation] no article text: stop_reason=${finalMsg.stop_reason}, content=${content.length} chars, ` +
        `sources=${sources.length}, output_tokens=${totalOutput}, continuations=${continuations}`
      )
      throw new Error(
        `Generation produced no article text (stop_reason: ${finalMsg.stop_reason}, ` +
        `${sources.length} sources collected, ${totalOutput} output tokens spent)`
      )
    }
    if (finalMsg.stop_reason !== 'end_turn') {
      console.warn(`[generation] non-end_turn completion: stop_reason=${finalMsg.stop_reason}, content=${content.length} chars`)
    }

    return {
      content,
      sources,
      inputTokens: totalInput,
      outputTokens: totalOutput,
      cacheCreationTokens: totalCacheW,
      cacheReadTokens: totalCacheR,
      webSearchCount: totalSearches,
    }
    }
  } catch (err) {
    if (timedOutReason) {
      throw new Error(`Generation timed out: ${timedOutReason}`)
    }
    throw err
  } finally {
    clearTimeout(deadline)
    clearTimeout(idleTimer)
  }
}

// ── Single-channel briefing ───────────────────────────────────────────────────
export async function generateChannelBriefing(opts: {
  channel: Channel
  profileId: string
  scheduled?: boolean
  onEvent?: OnEvent
}): Promise<GenerationResult> {
  const { channel, profileId, scheduled = false, onEvent } = opts
  const channelId = channel.id

  return withRateLimitRetry(async () => {
    // ── Fetch previous briefing, app settings, and (if serendipity) other channels ──
    const [prevResult, settingsResult, otherChannelsResult] = await Promise.all([
      supabase
        .from('briefings')
        .select('content, created_at')
        .eq('channel_id', channelId)
        .order('created_at', { ascending: false })
        .limit(1)
        .single(),
      supabase.from('settings').select('*').eq('id', profileId).single(),
      channel.serendipity_mode
        ? supabase
            .from('channels')
            .select('name, description')
            .neq('id', channelId)
            .order('position', { ascending: true })
        : Promise.resolve({ data: null }),
    ])

    const previousBriefing = prevResult.data
    const settings = settingsResult.data
    const model = resolveModel(settings?.model)
    const density = settings?.briefing_density ?? 'balanced'

    const queries = channel.search_queries?.join(', ') || channel.name
    let systemPrompt = channel.instructions?.trim()
      ? channel.instructions
      : `You are a research assistant. Search the web and provide a concise, well-structured briefing about: ${channel.name}`

    const densityInstruction = BRIEFING_DENSITY_INSTRUCTIONS[density]
    if (densityInstruction) {
      systemPrompt += `\n\n${densityInstruction}`
    }

    // Inject serendipity mode exclusions
    if (channel.serendipity_mode) {
      const otherChannels = otherChannelsResult.data
      if (otherChannels && otherChannels.length > 0) {
        const exclusionList = otherChannels
          .map((c: { name: string; description: string | null }) =>
            `- ${c.name}${c.description ? `: ${c.description}` : ''}`)
          .join('\n')
        systemPrompt +=
          `\n\nSERENDIPITY MODE — This briefing must NOT overlap with the topics covered by the user's other channels listed below. ` +
          `Do not cover these subjects — they are already handled elsewhere. ` +
          `Instead, actively seek out surprising, unexpected, or serendipitous content that the user would not encounter through their regular channels.\n\n` +
          `EXCLUDED TOPICS (covered by other channels):\n${exclusionList}`
      }
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

    const { content, sources, inputTokens, outputTokens, cacheCreationTokens, cacheReadTokens, webSearchCount } =
      await runWebSearchStream({
        model,
        // 8000: max_tokens covers adaptive thinking + text. Thinking-heavy
        // channels exhausted 6000 before writing any article text.
        maxTokens: 8000,
        maxSearches: 6,
        system: systemPrompt,
        userMessage,
        onEvent,
      })

    const usageExtras = { cacheCreationTokens, cacheReadTokens, webSearchCount }
    const costUsd = calculateCost(model, inputTokens, outputTokens, usageExtras)

    // ── Persist to Supabase ─────────────────────────────────────────────────
    const [briefingResult] = await Promise.all([
      supabase
        .from('briefings')
        .insert({
          channel_id: channelId,
          content,
          sources,
          model,
          // Live generations are watched as they stream — born read.
          // Scheduled ones stay unread until opened (drives the banner).
          ...(scheduled ? { scheduled: true } : { read_at: new Date().toISOString() }),
        })
        .select('id')
        .single(),
      supabase
        .from('channels')
        .update({ last_briefed_at: new Date().toISOString() })
        .eq('id', channelId),
    ])

    logUsage({
      callType: 'briefing',
      channelId,
      channelName: channel.name,
      model,
      inputTokens,
      outputTokens,
      costUsd,
      ...usageExtras,
    }).catch(() => {})

    return {
      id: briefingResult.data?.id,
      content,
      sources,
      usage: { inputTokens, outputTokens, costUsd, ...usageExtras },
    }
  }, onEvent)
}

// ── Cross-channel digest ──────────────────────────────────────────────────────
export async function generateProfileDigest(opts: {
  channels: Channel[]
  profileId: string
  scheduled?: boolean
  onEvent?: OnEvent
}): Promise<GenerationResult> {
  const { channels, profileId, scheduled = false, onEvent } = opts

  return withRateLimitRetry(async () => {
    const { data: settings } = await supabase
      .from('settings')
      .select('*')
      .eq('id', profileId)
      .single()

    const model = resolveModel(settings?.model)
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

    const densityInstruction = DIGEST_DENSITY_INSTRUCTIONS[density]
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

    const { content, sources, inputTokens, outputTokens, cacheCreationTokens, cacheReadTokens, webSearchCount } =
      await runWebSearchStream({
        model,
        maxTokens: 10000,
        maxSearches: 10,
        system: systemPrompt,
        userMessage,
        onEvent,
      })

    const usageExtras = { cacheCreationTokens, cacheReadTokens, webSearchCount }
    const costUsd = calculateCost(model, inputTokens, outputTokens, usageExtras)

    const { data: digestRow } = await supabase
      .from('digests')
      .insert({
        content,
        sources,
        channel_ids: channels.map((c) => c.id),
        channel_names: channels.map((c) => c.name),
        model,
        profile_id: profileId,
        ...(scheduled ? { scheduled: true } : { read_at: new Date().toISOString() }),
      })
      .select('id')
      .single()

    logUsage({
      callType: 'digest',
      model,
      inputTokens,
      outputTokens,
      costUsd,
      ...usageExtras,
    }).catch(() => {})

    return {
      id: digestRow?.id,
      content,
      sources,
      usage: { inputTokens, outputTokens, costUsd, ...usageExtras },
    }
  }, onEvent)
}
