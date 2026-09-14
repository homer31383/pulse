import Link from 'next/link'
import { notFound } from 'next/navigation'
import { fetchDepartmentBySlug, fetchPostPulseDataset, getWorkflowDoc } from '@/lib/post-pulse'
import { MarkdownRenderer } from '@/components/MarkdownRenderer'
import { WorkflowDocActions } from '@/components/post-pulse/WorkflowDocActions'

export const dynamic = 'force-dynamic'

interface PageProps {
  params: Promise<{ slug: string; id: string }>
}

// One saved workflow doc (spec §11): the exact prompt, the answer as-is,
// the tools it references (with any that changed since flagged), sources,
// and the re-run / verify actions. Staleness is computed on load.
export default async function WorkflowDocPage({ params }: PageProps) {
  const { slug, id } = await params
  const [department, doc, dataset] = await Promise.all([fetchDepartmentBySlug(slug), getWorkflowDoc(id), fetchPostPulseDataset()])
  if (!department || !doc) notFound()
  // Reachable under any department it is filed in (primary or additional).
  if (doc.department_id !== department.id && !doc.also_department_ids.includes(department.id)) notFound()
  const primary = dataset.departments.find((d) => d.id === doc.department_id) ?? department
  const alsoFiled = doc.also_department_ids.map((x) => dataset.departments.find((d) => d.id === x)).filter((d): d is NonNullable<typeof d> => !!d)

  const changedIds = new Set(doc.staleChanges.map((c) => c.toolId))
  const fmt = (iso: string) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })

  return (
    <article className="max-w-3xl">
      <nav className="text-xs text-ink-50 mb-3 flex flex-wrap items-center gap-1.5">
        <Link href="/post-pulse" className="hover:text-press-accent">
          Pipeline
        </Link>
        <span>/</span>
        <Link href={`/post-pulse/departments/${department.slug}`} className="hover:text-press-accent">
          {department.name}
        </Link>
        <span>/</span>
        <span>Workflow</span>
      </nav>

      <header className="mb-5">
        <p className="text-[10px] uppercase tracking-[1.5px] text-press-accent font-medium">Workflow doc</p>
        <h1 className="font-display text-2xl sm:text-3xl text-ink-300 leading-tight mt-1">{doc.title}</h1>
        <p className="text-xs text-ink-50 mt-1">
          Saved {fmt(doc.created_at)}
          {doc.source_chat_session_id && (
            <>
              {' · '}
              <Link href={`/post-pulse/chat/${doc.source_chat_session_id}`} className="text-press-accent hover:underline">
                from a chat session
              </Link>
            </>
          )}
        </p>
        <p className="text-xs text-ink-100 mt-2">
          Filed under{' '}
          <Link href={`/post-pulse/tools?dept=${primary.slug}`} className="text-press-accent hover:underline">
            {primary.name}
          </Link>
          {alsoFiled.length > 0 && (
            <>
              {' '}
              and also{' '}
              {alsoFiled.map((d, i) => (
                <span key={d.id}>
                  {i > 0 && ', '}
                  <Link href={`/post-pulse/tools?dept=${d.slug}`} className="text-press-accent hover:underline">
                    {d.name}
                  </Link>
                </span>
              ))}
            </>
          )}
          .
        </p>
        <div className="mt-3">
          <WorkflowDocActions
            docId={doc.id}
            departmentSlug={primary.slug}
            stale={doc.stale}
            lastVerifiedAt={doc.last_verified_at}
            filing={{ departmentId: doc.department_id, alsoDepartmentIds: doc.also_department_ids }}
          />
        </div>
      </header>

      {doc.stale && (
        <div className="rounded-xl border border-press-down/30 bg-press-down/10 px-4 py-3 mb-5 text-sm">
          <p className="font-medium text-press-down">Possibly stale</p>
          <p className="text-ink-200 mt-0.5">
            {doc.staleChanges.length === 1 ? 'A tool this doc references changed' : `${doc.staleChanges.length} changes to tools this doc references`}{' '}
            after it was {doc.last_verified_at ? 'last verified' : 'saved'}:{' '}
            {doc.staleChanges
              .slice(0, 6)
              .map((c) => `${c.toolName} (${c.field.replace(/_/g, ' ')}, ${fmt(c.changedAt)})`)
              .join('; ')}
            . Re-run it, or mark it still accurate if the changes don&apos;t affect it.
          </p>
        </div>
      )}

      <section className="mb-6">
        <h2 className="text-[10px] uppercase tracking-[1.5px] text-ink-50 font-medium mb-2">Prompt</h2>
        <blockquote className="rounded-xl bg-press-accent/5 border border-press-accent/20 px-4 py-3 text-sm text-ink-300 whitespace-pre-wrap">
          {doc.prompt}
        </blockquote>
      </section>

      <section className="mb-6">
        <h2 className="text-[10px] uppercase tracking-[1.5px] text-ink-50 font-medium mb-2">Answer</h2>
        <div className="rounded-xl border border-cream-300 bg-cream-50 px-4 py-3">
          <MarkdownRenderer content={doc.content} />
        </div>
      </section>

      <section className="mb-6">
        <h2 className="text-[10px] uppercase tracking-[1.5px] text-ink-50 font-medium mb-2">Referenced tools</h2>
        {doc.referencedTools.length === 0 ? (
          <p className="text-sm text-ink-50">No tracked tools were recognised in the answer, so staleness can&apos;t be inferred for this doc.</p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {doc.referencedTools.map((t) => (
              <Link
                key={t.id}
                href={`/post-pulse/tools/${t.id}`}
                className={[
                  'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-xs transition-colors',
                  changedIds.has(t.id)
                    ? 'border-press-down/40 bg-press-down/10 text-press-down hover:border-press-down'
                    : 'border-cream-400 bg-cream-50 text-ink-200 hover:border-press-accent/50 hover:text-press-accent',
                ].join(' ')}
              >
                {t.name}
                {changedIds.has(t.id) && <span className="text-[10px]">changed</span>}
              </Link>
            ))}
          </div>
        )}
      </section>

      <section>
        <h2 className="text-[10px] uppercase tracking-[1.5px] text-ink-50 font-medium mb-2">Sources</h2>
        {doc.source_urls.length === 0 ? (
          <p className="text-sm text-ink-50">The answer was written without web searches.</p>
        ) : (
          <ul className="space-y-1">
            {doc.source_urls.map((u) => (
              <li key={u} className="text-sm truncate">
                <a href={u} target="_blank" rel="noopener noreferrer" className="text-press-accent hover:underline">
                  {u}
                </a>
              </li>
            ))}
          </ul>
        )}
      </section>
    </article>
  )
}
