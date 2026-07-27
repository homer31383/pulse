import { cookies } from 'next/headers'
import { supabase } from '@/lib/supabase'
import Link from 'next/link'
import { SettingsClient } from '@/components/SettingsClient'
import { SETTINGS_DEFAULTS } from '@/app/api/settings/route'
import type { AppSettings, Channel } from '@/lib/types'

export const dynamic = 'force-dynamic'

const DEFAULT_PROFILE_ID = '00000000-0000-0000-0000-000000000001'

export default async function SettingsPage() {
  const cookieStore = await cookies()
  const profileId = cookieStore.get('profile_id')?.value ?? DEFAULT_PROFILE_ID

  const since = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString()
  const [{ data }, { data: channelData }, usageResult, digestSizesResult] = await Promise.all([
    supabase.from('settings').select('*').eq('id', profileId).single(),
    supabase
      .from('channels')
      .select('*')
      .eq('profile_id', profileId)
      .order('position', { ascending: true }),
    supabase
      .from('usage_logs')
      .select('call_type, channel_id, cost_usd, cache_creation_tokens, cache_read_tokens, created_at')
      .in('call_type', ['briefing', 'digest'])
      .gte('created_at', since),
    supabase
      .from('digests')
      .select('channel_ids, created_at')
      .eq('profile_id', profileId)
      .gte('created_at', since),
  ])

  const settings: AppSettings = { ...SETTINGS_DEFAULTS, ...((data as AppSettings | null) ?? {}) }
  const channels = (channelData ?? []) as Channel[]

  // ── Cost basis for the schedule estimator ─────────────────────────────────
  // Basis rows = post-caching runs only (cache activity > 0). This excludes
  // both pre-migration-015 rows (which underreported web-search costs) and
  // pre-caching rows (a different cost regime, ~3-5x today's).
  type UsageRow = {
    call_type: string
    channel_id: string | null
    cost_usd: number
    cache_creation_tokens: number | null
    cache_read_tokens: number | null
    created_at: string
  }
  const basisRows = ((usageResult.data ?? []) as UsageRow[]).filter(
    (r) => (r.cache_creation_tokens ?? 0) + (r.cache_read_tokens ?? 0) > 0
  )
  const briefingRows = basisRows.filter((r) => r.call_type === 'briefing')
  const digestUsageRows = basisRows.filter((r) => r.call_type === 'digest')

  // Per-digest share: match each digest usage row to its digests-table row by
  // timestamp proximity (the codebase's established pattern) and divide the
  // cost by THAT digest's own channel count — no global channels-per-digest
  // divisor, which broke when recent digests were single-channel tests.
  const unmatchedDigests = [...(digestSizesResult.data ?? [])]
  const digestShares: { share: number; channelIds: string[] }[] = []
  for (const u of digestUsageRows) {
    const t = new Date(u.created_at).getTime()
    const idx = unmatchedDigests.findIndex(
      (d) => Math.abs(new Date(d.created_at).getTime() - t) <= 120_000
    )
    if (idx === -1) continue
    const digest = unmatchedDigests.splice(idx, 1)[0]
    const ids = (digest.channel_ids ?? []) as string[]
    digestShares.push({ share: Number(u.cost_usd) / Math.max(1, ids.length), channelIds: ids })
  }

  const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length
  const median = (a: number[]) => {
    const s = [...a].sort((x, y) => x - y)
    const m = Math.floor(s.length / 2)
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
  }

  // Globals (fallback for channels with no history): median for outlier
  // robustness. Fallback constants reflect recent capped+cached runs.
  const briefingCosts = briefingRows.map((r) => Number(r.cost_usd))
  const shareValues = digestShares.map((s) => s.share)
  const globalBriefing = briefingCosts.length >= 3 ? median(briefingCosts) : 0.5
  const globalDigestShare = shareValues.length >= 2 ? median(shareValues) : 0.2

  // Per-channel history: a channel's own average wins over the global blend.
  const perChannel: Record<string, { briefing?: number; digestShare?: number }> = {}
  const briefingsByChannel = new Map<string, number[]>()
  for (const r of briefingRows) {
    if (!r.channel_id) continue
    briefingsByChannel.set(r.channel_id, [...(briefingsByChannel.get(r.channel_id) ?? []), Number(r.cost_usd)])
  }
  for (const [id, costs] of briefingsByChannel) {
    perChannel[id] = { ...perChannel[id], briefing: mean(costs) }
  }
  const sharesByChannel = new Map<string, number[]>()
  for (const s of digestShares) {
    for (const cid of s.channelIds) {
      sharesByChannel.set(cid, [...(sharesByChannel.get(cid) ?? []), s.share])
    }
  }
  for (const [id, shares] of sharesByChannel) {
    perChannel[id] = { ...perChannel[id], digestShare: mean(shares) }
  }

  const costBasis = {
    briefing: globalBriefing,
    digestPerChannel: globalDigestShare,
    briefingSamples: briefingRows.length,
    digestSamples: digestShares.length,
    perChannel,
  }

  return (
    <div className="min-h-screen bg-cream-200">
      <header className="sticky top-0 z-20 bg-cream-200/95 backdrop-blur-sm border-b border-cream-300/60 px-4 py-3">
        <div className="max-w-2xl mx-auto flex items-center gap-3">
          <Link
            href="/"
            className="p-1.5 rounded-lg text-ink-100 hover:text-ink-300 hover:bg-cream-300 transition-colors"
            aria-label="Back"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </Link>
          <h1 className="font-display text-lg font-normal text-ink-300">Settings</h1>
        </div>
      </header>

      <SettingsClient initialSettings={settings} channels={channels} costBasis={costBasis} />
    </div>
  )
}
