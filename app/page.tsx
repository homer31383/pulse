import { supabase } from '@/lib/supabase'
import { HomeClient } from '@/components/HomeClient'
import { SETTINGS_DEFAULTS } from '@/app/api/settings/route'
import type { Channel, ChannelGroup, AppSettings } from '@/lib/types'

// Always fetch fresh channel list and settings
export const dynamic = 'force-dynamic'

export default async function HomePage() {
  const [channelsResult, settingsResult, groupsResult] = await Promise.all([
    supabase.from('channels').select('*').order('position', { ascending: true }),
    supabase.from('settings').select('*').eq('id', 'default').single(),
    supabase.from('channel_groups').select('*').order('position', { ascending: true }),
  ])

  // Fall back to created_at order if position column not yet added (migration 002)
  let channelData = channelsResult.data
  if (channelsResult.error) {
    const fallback = await supabase.from('channels').select('*').order('created_at', { ascending: true })
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
    supabase.from('briefings').delete().lt('created_at', cutoffIso).then(() => {})
    supabase.from('digests').delete().lt('created_at', cutoffIso).then(() => {})
  }

  return <HomeClient channels={channels} settings={settings} groups={groups} />
}
