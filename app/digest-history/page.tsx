import { supabase } from '@/lib/supabase'
import Link from 'next/link'
import { DigestHistoryClient } from '@/components/DigestHistoryClient'
import type { DigestWithCost, Source } from '@/lib/types'

export const dynamic = 'force-dynamic'

export default async function DigestHistoryPage() {
  const [digestsResult, usageResult] = await Promise.all([
    supabase
      .from('digests')
      .select('id, content, sources, channel_ids, channel_names, model, created_at')
      .order('created_at', { ascending: false })
      .limit(100),
    supabase
      .from('usage_logs')
      .select('cost_usd, input_tokens, output_tokens, created_at')
      .eq('call_type', 'digest')
      .order('created_at', { ascending: false })
      .limit(100),
  ])

  // Match each digest to a usage log by timestamp proximity (within 120s after)
  type UsageRow = { cost_usd: number; input_tokens: number; output_tokens: number; created_at: string }
  const usageLogs: UsageRow[] = (usageResult.data ?? []) as UsageRow[]
  const unmatchedLogs = [...usageLogs]

  const digests: DigestWithCost[] = (digestsResult.data ?? []).map((d) => {
    const digestTime = new Date(d.created_at).getTime()
    const matchIdx = unmatchedLogs.findIndex((u) => {
      const logTime = new Date(u.created_at).getTime()
      return logTime >= digestTime && logTime <= digestTime + 120_000
    })
    const base = {
      ...d,
      sources: (d.sources as unknown as Source[]) ?? [],
      channel_ids: d.channel_ids ?? [],
      channel_names: d.channel_names ?? [],
    }
    if (matchIdx !== -1) {
      const match = unmatchedLogs.splice(matchIdx, 1)[0]
      return { ...base, cost_usd: match.cost_usd, input_tokens: match.input_tokens, output_tokens: match.output_tokens }
    }
    return { ...base, cost_usd: null, input_tokens: null, output_tokens: null }
  })

  return (
    <div className="min-h-screen bg-cream-200">
      <header className="sticky top-0 z-20 bg-cream-200/95 backdrop-blur-sm border-b border-cream-300/60 px-4 py-3">
        <div className="max-w-2xl mx-auto flex items-center gap-3">
          <Link
            href="/"
            className="p-1.5 rounded-lg text-ink-100 hover:text-ink-300 hover:bg-cream-300 transition-colors flex-shrink-0"
            aria-label="Back"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </Link>
          <div className="flex-1 min-w-0">
            <h1 className="font-display text-lg font-normal text-ink-300">Digest History</h1>
            <p className="text-xs text-ink-50">
              {digests.length === 0
                ? 'No digests yet'
                : `${digests.length} digest${digests.length !== 1 ? 's' : ''}`}
            </p>
          </div>
        </div>
      </header>

      <DigestHistoryClient digests={digests} />
    </div>
  )
}
