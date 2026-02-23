import { supabase } from '@/lib/supabase'
import { notFound } from 'next/navigation'
import { ChannelConfigClient } from '@/components/ChannelConfigClient'
import { NewChannelClient } from '@/components/NewChannelClient'
import type { Channel, ChannelGroup, ConversationMessage, BriefingWithCost } from '@/lib/types'

interface PageProps {
  params: Promise<{ id: string }>
}

export default async function ChannelConfigPage({ params }: PageProps) {
  const { id } = await params

  // "new" is the reserved slug for channel creation
  if (id === 'new') {
    return <NewChannelClient />
  }

  // Fetch channel, config conversation, briefings, usage logs, and groups in parallel
  const [channelResult, conversationResult, briefingsResult, usageResult, groupsResult] = await Promise.all([
    supabase.from('channels').select('*').eq('id', id).single(),
    supabase.from('config_conversations').select('messages').eq('channel_id', id).single(),
    supabase
      .from('briefings')
      .select('id, channel_id, content, sources, model, created_at')
      .eq('channel_id', id)
      .order('created_at', { ascending: false })
      .limit(50),
    supabase
      .from('usage_logs')
      .select('cost_usd, input_tokens, output_tokens, created_at')
      .eq('channel_id', id)
      .eq('call_type', 'briefing')
      .order('created_at', { ascending: false })
      .limit(50),
    supabase.from('channel_groups').select('*').order('position', { ascending: true }),
  ])

  if (!channelResult.data) notFound()

  const channel = channelResult.data as Channel
  const initialMessages =
    (conversationResult.data?.messages as ConversationMessage[] | null) ?? []

  // Match each briefing to a usage log by timestamp proximity (within 120s after)
  type UsageRow = { cost_usd: number; input_tokens: number; output_tokens: number; created_at: string }
  const usageLogs: UsageRow[] = (usageResult.data ?? []) as UsageRow[]
  const unmatchedLogs = [...usageLogs]

  const initialBriefings: BriefingWithCost[] = (briefingsResult.data ?? []).map((b) => {
    const briefingTime = new Date(b.created_at).getTime()
    const matchIdx = unmatchedLogs.findIndex((u) => {
      const logTime = new Date(u.created_at).getTime()
      return logTime >= briefingTime && logTime <= briefingTime + 120_000
    })
    if (matchIdx !== -1) {
      const match = unmatchedLogs.splice(matchIdx, 1)[0]
      return {
        ...b,
        sources: (b.sources as unknown as import('@/lib/types').Source[]) ?? [],
        cost_usd: match.cost_usd,
        input_tokens: match.input_tokens,
        output_tokens: match.output_tokens,
      }
    }
    return { ...b, sources: (b.sources as unknown as import('@/lib/types').Source[]) ?? [], cost_usd: null, input_tokens: null, output_tokens: null }
  })

  const groups = (groupsResult.data ?? []) as ChannelGroup[]

  return (
    <ChannelConfigClient
      channel={channel}
      initialMessages={initialMessages}
      initialBriefings={initialBriefings}
      groups={groups}
    />
  )
}
