import Link from 'next/link'
import { notFound } from 'next/navigation'
import { fetchTool, fetchToolChangelog, fetchPostPulseDataset } from '@/lib/post-pulse'
import { PP_TIER_BY_VALUE, formatAttributeValue, hostAppLabel } from '@/lib/post-pulse-types'
import { HostChip, StatusBadge, TierBadge } from '@/components/post-pulse/Badges'

export const dynamic = 'force-dynamic'

interface PageProps {
  params: Promise<{ id: string }>
}

function formatDate(iso: string | null): string {
  if (!iso) return 'never'
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export default async function ToolDetailPage({ params }: PageProps) {
  const { id } = await params
  const [tool, changelog, dataset] = await Promise.all([fetchTool(id), fetchToolChangelog(id), fetchPostPulseDataset()])
  if (!tool) notFound()

  const { departments, tools } = dataset
  const department = departments.find((d) => d.id === tool.department_id) ?? null
  const toolById = new Map(tools.map((t) => [t.id, t]))
  const replacement = tool.replacement_tool_id ? toolById.get(tool.replacement_tool_id) ?? null : null
  const replaces = tools.filter((t) => t.replacement_tool_id === tool.id)
  const alternatives = tools
    .filter((t) => t.department_id === tool.department_id && t.id !== tool.id)
    .sort((a, b) => (a.status === b.status ? a.name.localeCompare(b.name) : a.status === 'active' ? -1 : 1))
  const tierMeta = PP_TIER_BY_VALUE[tool.tier]
  const anchor = tool.doc_anchor ?? tierMeta.anchor
  const schema = department?.comparison_attributes ?? []
  const extraKeys = Object.keys(tool.attributes).filter((k) => !schema.some((s) => s.key === k))
  const hasAttributes = schema.some((s) => tool.attributes[s.key] !== undefined) || extraKeys.length > 0

  return (
    <article className="max-w-3xl">
      {/* Breadcrumb */}
      <nav className="text-xs text-ink-50 mb-3 flex flex-wrap items-center gap-1.5">
        <Link href="/post-pulse" className="hover:text-press-accent">
          All tools
        </Link>
        {department && (
          <>
            <span>/</span>
            <Link href={`/post-pulse?dept=${department.slug}`} className="hover:text-press-accent">
              {department.name}
            </Link>
          </>
        )}
      </nav>

      <header className="mb-5">
        <h1 className="font-display text-2xl sm:text-3xl text-ink-300 leading-tight">{tool.name}</h1>
        <div className="flex flex-wrap items-center gap-2 mt-2">
          <TierBadge tier={tool.tier} long />
          <HostChip host={tool.host_app} />
          <StatusBadge status={tool.status} />
          {tool.vendor && <span className="text-sm text-ink-100">· {tool.vendor}</span>}
        </div>
      </header>

      {tool.status === 'discontinued' && (
        <div className="rounded-xl border border-press-down/30 bg-press-down/10 px-4 py-3 mb-5 text-sm">
          <p className="font-medium text-press-down">Discontinued</p>
          <p className="text-ink-200 mt-0.5">
            {replacement ? (
              <>
                Replaced by{' '}
                <Link href={`/post-pulse/tools/${replacement.id}`} className="text-press-accent font-medium hover:underline">
                  {replacement.name}
                </Link>
                {replacement.host_app && <span className="text-ink-100"> ({hostAppLabel(replacement.host_app)})</span>}.
              </>
            ) : (
              'No replacement recorded yet.'
            )}{' '}
            Kept in the list so the changelog keeps its history.
          </p>
        </div>
      )}

      {replaces.length > 0 && (
        <p className="text-sm text-ink-100 mb-5">
          Replaces{' '}
          {replaces.map((t, i) => (
            <span key={t.id}>
              {i > 0 && ', '}
              <Link href={`/post-pulse/tools/${t.id}`} className="text-press-accent hover:underline">
                {t.name}
              </Link>
            </span>
          ))}
          .
        </p>
      )}

      {tool.blurb && <p className="font-serif text-base text-ink-200 leading-relaxed mb-6">{tool.blurb}</p>}

      {/* Why this tier — deep link into the department doc */}
      {department && (
        <Link
          href={`/post-pulse/departments/${department.slug}#${anchor}`}
          className="group flex items-center gap-3 rounded-xl border border-cream-300 bg-cream-50 px-4 py-3 mb-6 hover:border-press-accent/50 transition-colors"
        >
          <div className="min-w-0 flex-1">
            <p className="text-[10px] uppercase tracking-[1.5px] text-press-accent font-medium">Why it sits here</p>
            <p className="text-sm text-ink-200 mt-0.5">
              {tierMeta.label} in <span className="font-medium text-ink-300">{department.name}</span>. The reasoning lives in the
              department doc.
            </p>
          </div>
          <span className="text-press-accent group-hover:translate-x-0.5 transition-transform">→</span>
        </Link>
      )}

      {/* Attributes */}
      <section className="mb-6">
        <h2 className="text-[10px] uppercase tracking-[1.5px] text-ink-50 font-medium mb-2">Attributes</h2>
        {hasAttributes ? (
          <dl className="rounded-xl border border-cream-300 bg-cream-50 divide-y divide-cream-300/70 text-sm">
            {schema.map((attr) => (
              <div key={attr.key} className="grid grid-cols-[minmax(110px,1fr)_2fr] gap-3 px-4 py-2">
                <dt className="text-ink-100">{attr.label}</dt>
                <dd className="text-ink-300">{formatAttributeValue(tool.attributes[attr.key], attr.type)}</dd>
              </div>
            ))}
            {extraKeys.map((key) => (
              <div key={key} className="grid grid-cols-[minmax(110px,1fr)_2fr] gap-3 px-4 py-2">
                <dt className="text-ink-50 italic">{key.replace(/[_-]+/g, ' ')}</dt>
                <dd className="text-ink-300">{formatAttributeValue(tool.attributes[key])}</dd>
              </div>
            ))}
          </dl>
        ) : (
          <p className="text-sm text-ink-50">
            No attributes captured yet
            {schema.length ? ` (this department compares on ${schema.map((s) => s.label.toLowerCase()).join(', ')})` : ''}.
          </p>
        )}
      </section>

      {/* Alternatives */}
      {alternatives.length > 0 && (
        <section className="mb-6">
          <h2 className="text-[10px] uppercase tracking-[1.5px] text-ink-50 font-medium mb-2">
            Alternatives in {department?.name ?? 'this department'}
          </h2>
          <div className="flex flex-wrap gap-1.5">
            {alternatives.map((t) => (
              <Link
                key={t.id}
                href={`/post-pulse/tools/${t.id}`}
                className={[
                  'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-xs transition-colors',
                  t.status === 'discontinued'
                    ? 'border-cream-300 text-ink-50 line-through decoration-ink-50/60 hover:text-ink-100'
                    : 'border-cream-400 bg-cream-50 text-ink-200 hover:border-press-accent/50 hover:text-press-accent',
                ].join(' ')}
              >
                {t.name}
                <span className="text-[10px] text-ink-50">{PP_TIER_BY_VALUE[t.tier].short}</span>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* Sources + verification */}
      <section className="mb-6">
        <h2 className="text-[10px] uppercase tracking-[1.5px] text-ink-50 font-medium mb-2">Sources</h2>
        {tool.source_urls.length === 0 ? (
          <p className="text-sm text-ink-50">No sources recorded.</p>
        ) : (
          <ul className="space-y-1">
            {tool.source_urls.map((u) => (
              <li key={u} className="text-sm truncate">
                <a href={u} target="_blank" rel="noopener noreferrer" className="text-press-accent hover:underline">
                  {u}
                </a>
              </li>
            ))}
          </ul>
        )}
        <p className="text-xs text-ink-50 mt-2">
          Last verified {formatDate(tool.last_verified_at)}
          {tool.confidence === 'queued' && <span className="text-press-down"> · unverified (from queue)</span>}
        </p>
      </section>

      {/* Changelog */}
      <section>
        <h2 className="text-[10px] uppercase tracking-[1.5px] text-ink-50 font-medium mb-2">Changes</h2>
        {changelog.length === 0 ? (
          <p className="text-sm text-ink-50">No changes recorded since this entry was seeded.</p>
        ) : (
          <ol className="border-l border-cream-400 ml-1.5 pl-4 space-y-3">
            {changelog.map((c) => (
              <li key={c.id} className="text-sm relative">
                <span className="absolute -left-[21px] top-1.5 w-2 h-2 rounded-full bg-press-accent" />
                <p className="text-ink-300">
                  <span className="font-medium">{c.field_changed.replace(/_/g, ' ')}</span>
                  {c.field_changed !== 'created' && (
                    <>
                      : <span className="text-ink-50 line-through decoration-ink-50/50">{c.old_value ?? '—'}</span>
                      <span className="text-ink-50 mx-1.5">→</span>
                      <span>{c.new_value ?? '—'}</span>
                    </>
                  )}
                </p>
                <p className="text-[11px] text-ink-50 mt-0.5">
                  {formatDate(c.created_at)}
                  {c.source && ` · ${c.source}`}
                </p>
              </li>
            ))}
          </ol>
        )}
      </section>
    </article>
  )
}
