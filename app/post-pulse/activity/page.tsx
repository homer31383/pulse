import Link from 'next/link'
import { fetchActivity } from '@/lib/post-pulse'
import { PP_PIPELINE_STAGES } from '@/lib/post-pulse-types'

export const dynamic = 'force-dynamic'

// The only surface where Post Pulse's research activity is visible: every
// department maintenance pass (pp_department_research_runs) and frontier
// scan (pp_frontier_scans), newest first. There is no passive notification
// anywhere else — the earlier Pulse-briefing crossover was removed (spec §5).
export default async function ActivityPage() {
  const entries = await fetchActivity(150)
  const stageLabel = (v: string | null) => PP_PIPELINE_STAGES.find((s) => s.value === v)?.label ?? v ?? ''

  const groups = new Map<string, typeof entries>()
  for (const e of entries) {
    const day = new Date(e.ranAt).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
    groups.set(day, [...(groups.get(day) ?? []), e])
  }

  return (
    <div className="max-w-3xl">
      <header className="mb-5">
        <h1 className="font-display text-2xl text-ink-300">Research activity</h1>
        <p className="text-sm text-ink-100 mt-1">
          Every maintenance pass and frontier scan, newest first. Proposals land in the{' '}
          <Link href="/post-pulse/queue" className="text-press-accent hover:underline">
            review queue
          </Link>
          ; accepted changes appear in{' '}
          <Link href="/post-pulse/changes" className="text-press-accent hover:underline">
            what changed
          </Link>
          .
        </p>
      </header>

      {entries.length === 0 ? (
        <p className="text-sm text-ink-50 py-10 text-center">No research has run yet. Use the buttons on a department doc or the pipeline map.</p>
      ) : (
        <div className="space-y-6">
          {Array.from(groups.entries()).map(([day, items]) => (
            <section key={day}>
              <h2 className="text-[10px] uppercase tracking-[1.5px] text-ink-50 font-medium mb-2">{day}</h2>
              <ul className="rounded-xl border border-cream-300 bg-cream-50 divide-y divide-cream-300/70">
                {items.map((e) => (
                  <li key={`${e.kind}-${e.id}`} className="px-4 py-3">
                    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                      {e.kind === 'frontier' ? (
                        <span className="inline-flex items-center px-2 py-px rounded-full bg-press-accent text-white text-[9px] uppercase tracking-[1.5px] font-semibold">
                          Frontier
                        </span>
                      ) : (
                        <span className="text-[10px] uppercase tracking-[1.5px] font-medium text-press-accent">Maintenance</span>
                      )}
                      {e.department ? (
                        <Link href={`/post-pulse/departments/${e.department.slug}`} className="font-medium text-ink-300 hover:text-press-accent">
                          {e.department.name}
                        </Link>
                      ) : (
                        <Link href="/post-pulse" className="font-medium text-ink-300 hover:text-press-accent">
                          {stageLabel(e.stage)} <span className="text-ink-50 font-normal text-xs">(pipeline stage)</span>
                        </Link>
                      )}
                      <span className="ml-auto text-[11px] text-ink-50 tabular-nums" title={e.ranAt}>
                        {new Date(e.ranAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
                      </span>
                    </div>
                    <p className="mt-1 flex flex-wrap gap-x-3 text-[11px] text-ink-100 tabular-nums">
                      <span>{e.findingsCount} {e.findingsCount === 1 ? 'finding' : 'findings'}</span>
                      <span className={e.queuedCount ? 'text-press-accent' : ''}>{e.queuedCount} queued</span>
                      {e.kind === 'maintenance' && <span className={e.autoPublishedCount ? 'text-press-up' : ''}>{e.autoPublishedCount} auto-published</span>}
                      {e.queuedCount > 0 && (
                        <Link href="/post-pulse/queue" className="text-press-accent hover:underline">
                          review →
                        </Link>
                      )}
                    </p>
                    {e.summary && <p className="text-sm text-ink-200 mt-1.5 leading-relaxed">{e.summary}</p>}
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  )
}
