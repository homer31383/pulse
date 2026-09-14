import Link from 'next/link'
import { notFound } from 'next/navigation'
import { fetchDepartmentBySlug, fetchPostPulseDataset, listWorkflowDocs } from '@/lib/post-pulse'
import { PP_TIERS } from '@/lib/post-pulse-types'
import { AnchoredMarkdown } from '@/components/post-pulse/AnchoredMarkdown'
import { TierDot } from '@/components/post-pulse/Badges'
import { ResearchButton } from '@/components/post-pulse/ResearchButton'

function relativeDays(iso: string): string {
  const days = Math.floor((Date.now() - Date.parse(iso)) / 86_400_000)
  if (days <= 0) return 'today'
  if (days === 1) return 'yesterday'
  return `${days} days ago`
}

export const dynamic = 'force-dynamic'

interface PageProps {
  params: Promise<{ slug: string }>
}

// Layer 2 of the content model: the department's long-form doc, rendered
// with anchored headings (tier-1 / tier-2 / tier-3 by convention) that tool
// detail pages deep-link into. The tool roster at the top is derived from
// pp_tools, not written into the doc, so it can't drift.
export default async function DepartmentDocPage({ params }: PageProps) {
  const { slug } = await params
  const [department, dataset] = await Promise.all([fetchDepartmentBySlug(slug), fetchPostPulseDataset()])
  if (!department) notFound()
  const workflows = await listWorkflowDocs(department.id)

  const tools = dataset.tools.filter((t) => t.department_id === department.id)
  // Related departments (migration 026): a read-only cross-reference with a
  // live preview of what is tracked there, so nobody concludes that Runway
  // or Veo are untracked because they live one department over.
  const related = department.related_department_ids
    .map((id) => dataset.departments.find((d) => d.id === id))
    .filter((d): d is NonNullable<typeof d> => !!d)
    .map((d) => ({ department: d, tools: dataset.tools.filter((t) => t.department_id === d.id) }))

  return (
    <article className="max-w-3xl">
      <nav className="text-xs text-ink-50 mb-3 flex items-center gap-1.5">
        <Link href="/post-pulse" className="hover:text-press-accent">
          Pipeline
        </Link>
        <span>/</span>
        <Link href={`/post-pulse/tools?dept=${department.slug}`} className="hover:text-press-accent">
          {department.name}
        </Link>
      </nav>

      <header className="mb-6">
        <p className="text-[10px] uppercase tracking-[1.5px] text-press-accent font-medium">Department doc</p>
        <h1 className="font-display text-2xl sm:text-3xl text-ink-300 leading-tight mt-1">{department.name}</h1>
        <p className="text-xs text-ink-50 mt-1">
          Updated{' '}
          {new Date(department.updated_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
          {' · '}
          <Link href={`/post-pulse/tools?dept=${department.slug}`} className="text-press-accent hover:underline">
            {tools.length} {tools.length === 1 ? 'tool' : 'tools'} tracked
          </Link>
          {' · '}
          {/* Stamped by every research run that touched this department (migration 024) */}
          <span title={department.last_researched_at ?? undefined}>
            last checked {department.last_researched_at ? relativeDays(department.last_researched_at) : 'never'}
          </span>
        </p>
        {department.follow_up_sources.length > 0 && (
          <p className="text-xs text-ink-50 mt-1">
            Next pass starts from:{' '}
            {department.follow_up_sources.slice(0, 5).map((f, i) => (
              <span key={f.source}>
                {i > 0 && ' · '}
                {/^https?:\/\//.test(f.source) ? (
                  <a href={f.source} target="_blank" rel="noopener noreferrer" className="text-press-accent hover:underline">
                    {f.source.replace(/^https?:\/\/(www\.)?/, '').slice(0, 48)}
                  </a>
                ) : (
                  <span className="text-ink-100">{f.source}</span>
                )}
              </span>
            ))}
          </p>
        )}
        <div className="mt-3 flex flex-wrap items-start gap-2">
          {/* In-context chat launch: resumes this department's latest session, or starts one */}
          <Link
            href={`/post-pulse/chat/start?dept=${department.slug}`}
            className="inline-flex items-center gap-2 rounded-lg border border-cream-400 bg-cream-50 px-3 py-1.5 text-sm text-ink-200 hover:border-press-accent hover:text-press-accent transition-colors"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M8 10h8m-8 4h5m-9 6l3.5-3.5H18a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v14z" />
            </svg>
            Discuss in chat
          </Link>
          {/* Per-department research trigger: the RSS + search mechanism, scoped to this department */}
          <ResearchButton department={{ id: department.id, name: department.name }} compact />
        </div>
      </header>

      {/* Roster by tier, each linking to its detail view and its anchor */}
      <div className="grid sm:grid-cols-3 gap-2 mb-8">
        {PP_TIERS.map((tier) => {
          const list = tools.filter((t) => t.tier === tier.value)
          return (
            <div key={tier.value} className="rounded-xl border border-cream-300 bg-cream-50 px-3 py-2.5">
              <a
                href={`#${tier.anchor}`}
                className="flex items-center gap-1.5 text-xs font-medium text-ink-200 hover:text-press-accent"
              >
                <TierDot tier={tier.value} />
                {tier.label}
                <span className="ml-auto text-ink-50 tabular-nums">{list.length}</span>
              </a>
              <ul className="mt-1.5 space-y-0.5">
                {list.length === 0 && <li className="text-[11px] text-ink-50 italic">None tracked</li>}
                {list.map((t) => (
                  <li key={t.id}>
                    <Link
                      href={`/post-pulse/tools/${t.id}`}
                      className={[
                        'text-[13px] hover:text-press-accent',
                        t.status === 'discontinued' ? 'text-ink-50 line-through decoration-ink-50/60' : 'text-ink-300',
                      ].join(' ')}
                    >
                      {t.name}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )
        })}
      </div>

      {related.length > 0 && (
        <section className="mb-8 rounded-xl border border-press-accent/30 bg-press-accent/5 px-4 py-3">
          <h2 className="text-[10px] uppercase tracking-[1.5px] text-press-accent font-medium">Related departments</h2>
          <p className="text-xs text-ink-100 mt-0.5">Tracked there, not duplicated here. Check before treating a tool as missing.</p>
          <ul className="mt-2 space-y-2">
            {related.map(({ department: r, tools: rt }) => (
              <li key={r.id} className="text-sm">
                <Link href={`/post-pulse/departments/${r.slug}`} className="font-medium text-ink-300 hover:text-press-accent">
                  {r.name}
                </Link>
                <span className="text-ink-50 text-xs"> · {rt.length} {rt.length === 1 ? 'tool' : 'tools'}</span>
                {rt.length > 0 && (
                  <span className="block text-xs text-ink-100 mt-0.5">
                    {rt.slice(0, 6).map((t, i) => (
                      <span key={t.id}>
                        {i > 0 && ', '}
                        <Link href={`/post-pulse/tools/${t.id}`} className="hover:text-press-accent">
                          {t.name}
                        </Link>
                      </span>
                    ))}
                    {rt.length > 6 && (
                      <>
                        {' '}
                        <Link href={`/post-pulse/tools?dept=${r.slug}`} className="text-press-accent hover:underline">
                          and {rt.length - 6} more →
                        </Link>
                      </>
                    )}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Workflow docs (spec §11): prompt-and-answer pairs saved from chat.
          The badge appears only when a referenced tool changed since the doc
          was saved or last verified — signal, not a neutral "last checked". */}
      <section className="mb-8">
        <div className="flex items-baseline gap-2 mb-2">
          <h2 className="text-[10px] uppercase tracking-[1.5px] text-ink-50 font-medium">Workflows</h2>
          <span className="text-[11px] text-ink-50">
            {workflows.length} saved · save one from any chat answer
          </span>
        </div>
        {workflows.length === 0 ? (
          <p className="text-sm text-ink-50">
            None yet. Ask a workflow question in chat and use &ldquo;Save as workflow doc&rdquo; on the answer.
          </p>
        ) : (
          <ul className="rounded-xl border border-cream-300 bg-cream-50 divide-y divide-cream-300/70">
            {workflows.map((w) => (
              <li key={w.id}>
                <Link
                  href={`/post-pulse/departments/${department.slug}/workflows/${w.id}`}
                  className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-4 py-2.5 hover:bg-cream-100/70 transition-colors"
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
      </section>

      {department.overview_doc.trim() ? (
        <AnchoredMarkdown content={department.overview_doc} />
      ) : (
        <p className="text-sm text-ink-50 italic">This department doc hasn&apos;t been written yet.</p>
      )}
    </article>
  )
}
