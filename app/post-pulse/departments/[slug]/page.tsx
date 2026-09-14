import Link from 'next/link'
import { notFound } from 'next/navigation'
import { fetchDepartmentBySlug, fetchPostPulseDataset } from '@/lib/post-pulse'
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

  const tools = dataset.tools.filter((t) => t.department_id === department.id)

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

      {department.overview_doc.trim() ? (
        <AnchoredMarkdown content={department.overview_doc} />
      ) : (
        <p className="text-sm text-ink-50 italic">This department doc hasn&apos;t been written yet.</p>
      )}
    </article>
  )
}
