import Link from 'next/link'
import type { PpWorkflowDocWithStatus } from '@/lib/post-pulse-types'

interface Props {
  departmentSlug: string
  workflows: PpWorkflowDocWithStatus[]
}

// Workflow docs (spec §11) as a collapsed reference list on the main
// department page (the tool list), separate from the department doc's
// prose. Native <details>, collapsed by default; items click through to
// the doc page. The badge appears only when a referenced tool changed
// since the doc was saved or last verified.
export function WorkflowsDisclosure({ departmentSlug, workflows }: Props) {
  const stale = workflows.filter((w) => w.stale).length
  return (
    <details className="mt-6 group rounded-xl border border-cream-300 bg-cream-50/70 open:bg-cream-50">
      <summary className="flex items-center gap-2 px-4 py-2.5 text-sm text-ink-200 cursor-pointer select-none hover:text-press-accent [&::-webkit-details-marker]:hidden">
        <svg className="w-3.5 h-3.5 text-ink-50 transition-transform group-open:rotate-90" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.25} d="M9 5l7 7-7 7" />
        </svg>
        <span className="font-medium">Workflows</span>
        <span className="text-[11px] text-ink-50 tabular-nums">{workflows.length}</span>
        {stale > 0 && <span className="text-[11px] text-press-down">{stale} possibly stale</span>}
        <span className="ml-auto text-[11px] text-ink-50">saved from chat answers</span>
      </summary>
      <div className="border-t border-cream-300/70">
        {workflows.length === 0 ? (
          <p className="px-4 py-2.5 text-xs text-ink-50">
            None yet. Ask a workflow question in chat and use &ldquo;Save as workflow doc&rdquo; on the answer.
          </p>
        ) : (
          <ul className="divide-y divide-cream-300/70">
            {workflows.map((w) => (
              <li key={w.id}>
                <Link
                  href={`/post-pulse/departments/${departmentSlug}/workflows/${w.id}`}
                  className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-4 py-2.5 text-sm hover:bg-cream-100/70 transition-colors"
                >
                  <span className="font-medium text-ink-300">{w.title}</span>
                  {w.stale && (
                    <span
                      className="inline-flex items-center px-2 py-px rounded-full border border-press-down/30 bg-press-down/10 text-press-down text-[11px] font-medium"
                      title={w.staleChanges.map((c) => `${c.toolName}: ${c.field}`).join(', ')}
                    >
                      Possibly stale
                    </span>
                  )}
                  <span className="ml-auto text-[11px] text-ink-50">
                    saved {new Date(w.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </details>
  )
}
