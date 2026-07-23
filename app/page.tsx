import { cookies } from 'next/headers'
import { supabase } from '@/lib/supabase'
import { HomeClient } from '@/components/HomeClient'
import { SETTINGS_DEFAULTS } from '@/app/api/settings/route'
import type { Channel, ChannelGroup, AppSettings, Profile, Briefing, Digest } from '@/lib/types'

// Always fetch fresh channel list and settings
export const dynamic = 'force-dynamic'

export default async function HomePage() {
  const cookieStore = await cookies()
  const cookieProfileId = cookieStore.get('profile_id')?.value

  // Fetch profiles first so we can resolve the current profile
  const { data: profilesData } = await supabase
    .from('profiles')
    .select('*')
    .order('created_at', { ascending: true })

  const profiles = (profilesData ?? []) as Profile[]
  const currentProfileId =
    profiles.find((p) => p.id === cookieProfileId)?.id ??
    profiles[0]?.id ??
    '00000000-0000-0000-0000-000000000001'

  const [channelsResult, settingsResult, groupsResult] = await Promise.all([
    supabase
      .from('channels')
      .select('*')
      .eq('profile_id', currentProfileId)
      .order('position', { ascending: true }),
    supabase.from('settings').select('*').eq('id', currentProfileId).single(),
    supabase
      .from('channel_groups')
      .select('*')
      .eq('profile_id', currentProfileId)
      .order('position', { ascending: true }),
  ])

  // Fall back to created_at order if position column not yet added (migration 002)
  let channelData = channelsResult.data
  if (channelsResult.error) {
    const fallback = await supabase
      .from('channels')
      .select('*')
      .eq('profile_id', currentProfileId)
      .order('created_at', { ascending: true })
    channelData = fallback.data
  }

  const channels = (channelData ?? []) as Channel[]
  const settings: AppSettings = { ...SETTINGS_DEFAULTS, ...(settingsResult.data ?? {}) }
  const groups = (groupsResult.data ?? []) as ChannelGroup[]

  // ── Pre-generated scheduled content from the last 18 hours ────────────────
  const scheduledBriefings: Briefing[] = []
  let scheduledDigest: Digest | null = null
  if (settings.schedule_enabled && channels.length > 0) {
    const since = new Date(Date.now() - 18 * 60 * 60 * 1000).toISOString()
    const [briefingsResult, digestResult] = await Promise.all([
      supabase
        .from('briefings')
        .select('*')
        .in('channel_id', channels.map((c) => c.id))
        .eq('scheduled', true)
        .gte('created_at', since)
        .order('created_at', { ascending: false }),
      supabase
        .from('digests')
        .select('*')
        .eq('profile_id', currentProfileId)
        .eq('scheduled', true)
        .gte('created_at', since)
        .order('created_at', { ascending: false })
        .limit(1),
    ])
    // Keep only the newest scheduled briefing per channel
    const seenChannels = new Set<string>()
    for (const b of (briefingsResult.data ?? []) as Briefing[]) {
      if (!seenChannels.has(b.channel_id)) {
        seenChannels.add(b.channel_id)
        scheduledBriefings.push(b)
      }
    }
    scheduledDigest = ((digestResult.data ?? [])[0] as Digest | undefined) ?? null
  }

  // Auto-delete old briefings and digests if retention is configured (fire-and-forget)
  if (settings.briefing_retention_days) {
    const cutoff = new Date()
    cutoff.setDate(cutoff.getDate() - settings.briefing_retention_days)
    const cutoffIso = cutoff.toISOString()
    // Only delete briefings from channels in this profile
    const channelIds = channels.map((c) => c.id)
    if (channelIds.length > 0) {
      supabase.from('briefings').delete().in('channel_id', channelIds).lt('created_at', cutoffIso).then(() => {})
    }
    supabase
      .from('digests')
      .delete()
      .eq('profile_id', currentProfileId)
      .lt('created_at', cutoffIso)
      .then(() => {})
  }

  return (
    <HomeClient
      channels={channels}
      settings={settings}
      groups={groups}
      profiles={profiles}
      currentProfileId={currentProfileId}
      scheduledBriefings={scheduledBriefings}
      scheduledDigest={scheduledDigest}
    />
  )
}
