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
      .select('call_type, cost_usd, cache_creation_tokens, cache_read_tokens, web_search_count')
      .in('call_type', ['briefing', 'digest'])
      .gte('created_at', since),
    supabase
      .from('digests')
      .select('channel_ids')
      .eq('profile_id', profileId)
      .gte('created_at', since),
  ])

  const settings: AppSettings = { ...SETTINGS_DEFAULTS, ...((data as AppSettings | null) ?? {}) }
  const channels = (channelData ?? []) as Channel[]

  // ── Cost basis for the schedule estimator ─────────────────────────────────
  // Only fully-instrumented rows (cache/search columns populated) — rows
  // logged before migration 015 vastly underreported web-search costs.
  type UsageRow = {
    call_type: string
    cost_usd: number
    cache_creation_tokens: number | null
    cache_read_tokens: number | null
    web_search_count: number | null
  }
  const instrumented = ((usageResult.data ?? []) as UsageRow[]).filter(
    (r) => (r.web_search_count ?? 0) > 0 || (r.cache_creation_tokens ?? 0) > 0 || (r.cache_read_tokens ?? 0) > 0
  )
  const avg = (rows: UsageRow[]) => rows.reduce((s, r) => s + Number(r.cost_usd), 0) / rows.length
  const briefingRows = instrumented.filter((r) => r.call_type === 'briefing')
  const digestRows = instrumented.filter((r) => r.call_type === 'digest')
  // Fallbacks reflect recent real runs with caching + search caps in place
  const avgBriefingCost = briefingRows.length >= 3 ? avg(briefingRows) : 0.5
  const avgDigestCost = digestRows.length >= 2 ? avg(digestRows) : 0.8
  const digestSizes = (digestSizesResult.data ?? [])
    .map((d) => (d.channel_ids ?? []).length)
    .filter((n) => n > 0)
  const avgChannelsPerDigest = digestSizes.length > 0
    ? digestSizes.reduce((a, b) => a + b, 0) / digestSizes.length
    : 4
  const costBasis = {
    briefing: avgBriefingCost,
    digestPerChannel: avgDigestCost / Math.max(1, avgChannelsPerDigest),
    briefingSamples: briefingRows.length,
    digestSamples: digestRows.length,
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
