import { cookies } from 'next/headers'
import { supabase } from '@/lib/supabase'
import { HomeClient } from '@/components/HomeClient'
import { SETTINGS_DEFAULTS } from '@/app/api/settings/route'
import type { Channel, ChannelGroup, AppSettings, Profile } from '@/lib/types'

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
    />
  )
}
