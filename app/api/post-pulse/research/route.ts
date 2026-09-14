import { NextRequest } from 'next/server'
import { runResearch } from '@/lib/post-pulse-research'
import { PP_PIPELINE_STAGES, type PpPipelineStage } from '@/lib/post-pulse-types'

// A run does RSS + several web-search calls; give it the full window.
export const maxDuration = 300
export const dynamic = 'force-dynamic'

// POST { departmentId? } — manual triggers (spec §5).
// With departmentId: research that one department now ("research this
// department now" on its doc page). Without: a full sweep of every
// department regardless of cadence ("run the full sweep now"). Both run
// the same mechanism as the scheduled cron and write a briefing.
export async function POST(req: NextRequest) {
  let body: { departmentId?: unknown; stage?: unknown; timeBudgetMs?: unknown } = {}
  try {
    body = await req.json()
  } catch {
    /* empty body = full sweep */
  }
  const departmentId = typeof body.departmentId === 'string' ? body.departmentId : null
  // Frontier scan of one pipeline stage (spec §5a): "Frontier scan this stage" on the map.
  const stage = PP_PIPELINE_STAGES.some((s) => s.value === body.stage) ? (body.stage as PpPipelineStage) : null
  // Optional smaller budget (tests / partial sweeps); departments not
  // reached stay due for the daily cron.
  const timeBudgetMs =
    typeof body.timeBudgetMs === 'number' && body.timeBudgetMs > 0 ? Math.min(body.timeBudgetMs, 240_000) : 240_000
  try {
    const summary = await runResearch({
      trigger: stage ? 'manual_frontier' : departmentId ? 'manual_department' : 'manual_global',
      departmentIds: stage ? [] : departmentId ? [departmentId] : undefined,
      frontierStages: stage ? [stage] : undefined,
      timeBudgetMs,
    })
    if (departmentId && summary.departments.length === 0) {
      return Response.json({ error: 'Department not found' }, { status: 404 })
    }
    return Response.json(summary)
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : 'Research run failed' }, { status: 500 })
  }
}
