import { NextRequest } from 'next/server'
import { runResearch, PP_RESEARCH_CADENCE_DAYS } from '@/lib/post-pulse-research'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

// Scheduled Post Pulse research sweep (spec §5). vercel.json fires this
// daily; each run processes only the departments that are DUE under the
// uniform cadence (last_researched_at null or older than 14 days), oldest
// first, within a time budget. A department that isn't reached, or whose
// pass fails, keeps its old stamp and is picked up by the next daily run —
// so in practice every department is researched once per fortnight and a
// big sweep may complete over two consecutive days. Each run that processes
// anything writes one briefing through Pulse's channel mechanism.
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (secret && req.headers.get('authorization') !== `Bearer ${secret}`) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }
  try {
    const summary = await runResearch({ trigger: 'scheduled', dueOnly: true, timeBudgetMs: 230_000 })
    return Response.json({
      ok: true,
      cadenceDays: PP_RESEARCH_CADENCE_DAYS,
      processed: summary.departments.filter((d) => d.status === 'done').map((d) => d.slug),
      failed: summary.departments.filter((d) => d.status === 'failed').map((d) => ({ slug: d.slug, error: d.error })),
      remaining: summary.remainingDepartmentIds.length,
      briefingId: summary.briefingId,
      costUsd: Number(summary.costUsd.toFixed(4)),
    })
  } catch (err) {
    console.error('[post-pulse-sync] run failed:', err)
    return Response.json({ ok: false, error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}
