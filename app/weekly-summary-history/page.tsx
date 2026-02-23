import { supabase } from '@/lib/supabase'
import Link from 'next/link'
import { WeeklySummaryHistoryClient } from '@/components/WeeklySummaryHistoryClient'
import type { WeeklySummaryWithCost } from '@/lib/types'

export const dynamic = 'force-dynamic'

export default async function WeeklySummaryHistoryPage() {
  const [summariesResult, usageResult] = await Promise.all([
    supabase
      .from('weekly_summaries')
      .select('id, content, channel_names, model, week_start, created_at')
      .order('created_at', { ascending: false })
      .limit(52),
    supabase
      .from('usage_logs')
      .select('cost_usd, input_tokens, output_tokens, created_at')
      .eq('call_type', 'weekly_summary')
      .order('created_at', { ascending: false })
      .limit(52),
  ])

  type UsageRow = { cost_usd: number; input_tokens: number; output_tokens: number; created_at: string }
  const usageLogs: UsageRow[] = (usageResult.data ?? []) as UsageRow[]
  const unmatchedLogs = [...usageLogs]

  const summaries: WeeklySummaryWithCost[] = (summariesResult.data ?? []).map((s) => {
    const summaryTime = new Date(s.created_at).getTime()
    const matchIdx = unmatchedLogs.findIndex((u) => {
      const logTime = new Date(u.created_at).getTime()
      return logTime >= summaryTime && logTime <= summaryTime + 120_000
    })
    const base = {
      ...s,
      channel_names: s.channel_names ?? [],
    }
    if (matchIdx !== -1) {
      const match = unmatchedLogs.splice(matchIdx, 1)[0]
      return { ...base, cost_usd: match.cost_usd, input_tokens: match.input_tokens, output_tokens: match.output_tokens }
    }
    return { ...base, cost_usd: null, input_tokens: null, output_tokens: null }
  })

  return (
    <div className="min-h-screen bg-slate-900">
      <header className="sticky top-0 z-20 bg-slate-900/95 backdrop-blur-sm border-b border-slate-800 px-4 py-3">
        <div className="max-w-2xl mx-auto flex items-center gap-3">
          <Link
            href="/"
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors flex-shrink-0"
            aria-label="Back"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </Link>
          <div className="flex-1 min-w-0">
            <h1 className="text-lg font-semibold text-white">Weekly Summary History</h1>
            <p className="text-xs text-slate-500">
              {summaries.length === 0
                ? 'No summaries yet'
                : `${summaries.length} summar${summaries.length !== 1 ? 'ies' : 'y'}`}
            </p>
          </div>
        </div>
      </header>

      <WeeklySummaryHistoryClient summaries={summaries} />
    </div>
  )
}
