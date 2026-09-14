import Link from 'next/link'
import { fetchRecentChanges, fetchPostPulseDataset } from '@/lib/post-pulse'

export const dynamic = 'force-dynamic'

// "What changed since I last looked": the pp_changelog, newest first.
export default async function ChangesPage() {
  const [changes, dataset] = await Promise.all([fetchRecentChanges(150), fetchPostPulseDataset()])
  const deptById = new Map(dataset.departments.map((d) => [d.id, d]))

  // Group by calendar day (server-local; fine for a reference log).
  const groups = new Map<string, typeof changes>()
  for (const c of changes) {
    const day = new Date(c.created_at).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
    groups.set(day, [...(groups.get(day) ?? []), c])
  }

  return (
    <div className="max-w-3xl">
      <header className="mb-5">
        <h1 className="font-display text-2xl text-ink-300">What changed</h1>
        <p className="text-sm text-ink-100 mt-1">Every tier shift, status flip, and attribute edit, newest first.</p>
      </header>

      {changes.length === 0 ? (
        <p className="text-sm text-ink-50 py-10 text-center">
          No changes logged yet. Accepting a queue item writes the first entry.
        </p>
      ) : (
        <div className="space-y-6">
          {Array.from(groups.entries()).map(([day, items]) => (
            <section key={day}>
              <h2 className="text-[10px] uppercase tracking-[1.5px] text-ink-50 font-medium mb-2">{day}</h2>
              <ul className="rounded-xl border border-cream-300 bg-cream-50 divide-y divide-cream-300/70">
                {items.map((c) => (
                  <li key={c.id} className="px-4 py-2.5 text-sm">
                    <div className="flex flex-wrap items-baseline gap-x-2">
                      {c.target_type === 'department' ? (
                        c.department ? (
                          <Link href={`/post-pulse/departments/${c.department.slug}`} className="font-medium text-ink-300 hover:text-press-accent">
                            {c.department.name}
                          </Link>
                        ) : (
                          <span className="font-medium text-ink-50">Deleted department</span>
                        )
                      ) : c.tool ? (
                        <Link href={`/post-pulse/tools/${c.tool.id}`} className="font-medium text-ink-300 hover:text-press-accent">
                          {c.tool.name}
                        </Link>
                      ) : (
                        <span className="font-medium text-ink-50">Deleted tool</span>
                      )}
                      {c.target_type === 'department' ? (
                        <span className="text-[11px] text-ink-50">department doc</span>
                      ) : (
                        c.tool && <span className="text-[11px] text-ink-50">{deptById.get(c.tool.department_id)?.name}</span>
                      )}
                      <span className="text-[11px] text-ink-50 ml-auto">
                        {new Date(c.created_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
                        {c.source && ` · ${c.source}`}
                      </span>
                    </div>
                    <p className="text-ink-200 mt-0.5">
                      <span className="text-ink-100">{c.field_changed.replace(/_/g, ' ')}</span>
                      {c.field_changed === 'created' ? (
                        <span className="text-ink-50"> added</span>
                      ) : c.field_changed === 'overview_doc' ? (
                        // Whole-doc replacement: the full before/after text is in the
                        // row, but the feed only needs to say that it happened.
                        <span className="text-ink-50">
                          {' '}
                          replaced ({(c.old_value ?? '').length.toLocaleString()} → {(c.new_value ?? '').length.toLocaleString()} chars)
                        </span>
                      ) : (
                        <>
                          : <span className="text-ink-50 line-through decoration-ink-50/50">{c.old_value ?? '—'}</span>
                          <span className="text-ink-50 mx-1.5">→</span>
                          <span className="text-ink-300">{c.new_value ?? '—'}</span>
                        </>
                      )}
                    </p>
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
