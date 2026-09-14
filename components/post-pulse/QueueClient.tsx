'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  PP_DEPARTMENT_EDITABLE_FIELDS,
  PP_QUEUE_SOURCES,
  PP_TOOL_EDITABLE_FIELDS,
  formatAttributeValue,
  type PpQueueItem,
} from '@/lib/post-pulse-types'
import { usePostPulse } from './Shell'

interface Props {
  items: PpQueueItem[]
}

// Pending proposals with accept / reject. Accept applies the change to
// pp_tools or pp_departments (server-side, lib/post-pulse.ts) and, for
// tools, logs it; reject only resolves the row. Either way the layout is
// refreshed so the sidebar badge and the dataset snapshot stay current.
// Department overview_doc edits are shown whole, not diffed (spec §6a).
export function QueueClient({ items: initial }: Props) {
  const { tools, departments } = usePostPulse()
  const router = useRouter()
  const [items, setItems] = useState(initial)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const toolById = new Map(tools.map((t) => [t.id, t]))
  const deptById = new Map(departments.map((d) => [d.id, d]))
  const deptBySlug = new Map(departments.map((d) => [d.slug, d]))

  async function resolve(id: string, action: 'accept' | 'reject') {
    setBusy(id)
    setError(null)
    try {
      const res = await fetch(`/api/post-pulse/queue/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error ?? `Request failed (${res.status})`)
      setItems((prev) => prev.filter((i) => i.id !== id))
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      setBusy(null)
    }
  }

  if (items.length === 0) {
    return (
      <div className="text-center py-16">
        <p className="text-sm text-ink-100">Nothing waiting for review.</p>
        <p className="text-xs text-ink-50 mt-1">
          Proposals from the research chat and the scheduled pull land here.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {error && (
        <div className="rounded-lg border border-press-down/30 bg-press-down/10 px-3 py-2 text-sm text-press-down">{error}</div>
      )}
      {items.map((item) => {
        const isDept = item.target_type === 'department'
        const changes = item.proposed_changes
        const targetTool = !isDept && item.proposed_tool_id ? toolById.get(item.proposed_tool_id) : null
        const targetDept = isDept && item.proposed_department_id ? deptById.get(item.proposed_department_id) : null
        const current: Record<string, unknown> | null = (targetTool ?? targetDept) as Record<string, unknown> | null
        const proposedDept =
          (typeof changes.department_id === 'string' && deptById.get(changes.department_id)) ||
          (typeof changes.department_slug === 'string' && deptBySlug.get(changes.department_slug)) ||
          null
        const editable: readonly string[] = isDept ? PP_DEPARTMENT_EDITABLE_FIELDS : PP_TOOL_EDITABLE_FIELDS
        const fields = Object.keys(changes).filter(
          (k) => editable.includes(k) || (!isDept && k === 'department_slug')
        ).filter((k) => !(k === 'department_id' && 'department_slug' in changes))
        const ignored = Object.keys(changes).filter((k) => !fields.includes(k) && k !== 'note' && k !== 'department_id')
        const isBusy = busy === item.id
        const missingTarget = (item.proposed_tool_id && !targetTool) || (item.proposed_department_id && !targetDept)

        const title = isDept ? (
          targetDept ? (
            <>
              Update department{' '}
              <Link href={`/post-pulse/departments/${targetDept.slug}`} className="text-press-accent hover:underline">
                {targetDept.name}
              </Link>
            </>
          ) : missingTarget ? (
            <span className="text-press-down">Update to a department that no longer exists</span>
          ) : (
            <>New department{typeof changes.name === 'string' ? `: ${changes.name}` : ''}</>
          )
        ) : targetTool ? (
          <>
            Update{' '}
            <Link href={`/post-pulse/tools/${targetTool.id}`} className="text-press-accent hover:underline">
              {targetTool.name}
            </Link>
          </>
        ) : missingTarget ? (
          <span className="text-press-down">Update to a tool that no longer exists</span>
        ) : (
          <>New tool{typeof changes.name === 'string' ? `: ${changes.name}` : ''}</>
        )

        return (
          <article key={item.id} className="rounded-xl border border-cream-300 bg-cream-50 overflow-hidden">
            <header className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 border-b border-cream-300/70">
              <span className="text-[10px] uppercase tracking-[1.5px] font-medium text-press-accent">
                {PP_QUEUE_SOURCES[item.source] ?? item.source}
                {isDept && <span className="text-ink-50"> · department</span>}
              </span>
              <h2 className="font-medium text-ink-300">{title}</h2>
              {!isDept && (proposedDept || targetTool) && (
                <span className="text-xs text-ink-50">{proposedDept?.name ?? deptById.get(targetTool!.department_id)?.name}</span>
              )}
              <time className="ml-auto text-[11px] text-ink-50" dateTime={item.created_at}>
                {new Date(item.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
              </time>
            </header>

            <div className="px-4 py-3">
              {typeof changes.note === 'string' && (
                <p className="text-sm text-ink-200 mb-3 leading-relaxed">{changes.note}</p>
              )}
              {fields.length === 0 ? (
                <p className="text-sm text-ink-50 italic">No recognised fields in this proposal.</p>
              ) : (
                <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
                  {fields.map((field) => {
                    const before = current ? current[field] : undefined
                    const after = changes[field]
                    const unchanged = current && JSON.stringify(before ?? null) === JSON.stringify(after ?? null)

                    // Long-form prose: shown whole, replaces the doc on accept.
                    if (field === 'overview_doc') {
                      return (
                        <div key={field} className="contents">
                          <dt className="text-xs text-ink-100 pt-0.5 font-medium">overview doc</dt>
                          <dd className="min-w-0">
                            {unchanged ? (
                              <span className="text-[11px] text-ink-50">(no change)</span>
                            ) : (
                              <details className="rounded-lg border border-cream-300 bg-cream-100/60">
                                <summary className="px-3 py-1.5 text-xs text-ink-100 cursor-pointer hover:text-ink-300">
                                  {current ? 'Replaces the whole doc on accept' : 'New doc'} · {String(after ?? '').length.toLocaleString()} chars
                                </summary>
                                <pre className="px-3 py-2 text-xs text-ink-200 whitespace-pre-wrap font-serif leading-relaxed max-h-96 overflow-auto">
                                  {String(after ?? '')}
                                </pre>
                              </details>
                            )}
                          </dd>
                        </div>
                      )
                    }

                    const afterLabel =
                      field === 'department_slug'
                        ? proposedDept?.name ?? formatAttributeValue(after)
                        : field === 'replacement_tool_id' && typeof after === 'string'
                          ? toolById.get(after)?.name ?? after
                          : formatAttributeValue(after)
                    const beforeLabel =
                      field === 'replacement_tool_id' && typeof before === 'string'
                        ? toolById.get(before)?.name ?? before
                        : formatAttributeValue(before)
                    return (
                      <div key={field} className="contents">
                        <dt className="text-xs text-ink-100 pt-0.5 font-medium">{field.replace(/_/g, ' ')}</dt>
                        <dd className="min-w-0">
                          {current && (
                            <span className={['text-ink-50', unchanged ? '' : 'line-through decoration-ink-50/50'].join(' ')}>
                              {beforeLabel}
                            </span>
                          )}
                          {current && !unchanged && <span className="text-ink-50 mx-1.5">→</span>}
                          {!unchanged && <span className="text-ink-300 break-words">{afterLabel}</span>}
                          {unchanged && <span className="text-[11px] text-ink-50 ml-1.5">(no change)</span>}
                        </dd>
                      </div>
                    )
                  })}
                </dl>
              )}
              {ignored.length > 0 && (
                <p className="text-[11px] text-ink-50 mt-2">Ignored on accept: {ignored.join(', ')}</p>
              )}
              {item.source_urls.length > 0 && (
                <ul className="mt-3 space-y-0.5">
                  {item.source_urls.map((u) => (
                    <li key={u} className="text-xs truncate">
                      <a href={u} target="_blank" rel="noopener noreferrer" className="text-press-accent hover:underline">
                        {u}
                      </a>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <footer className="flex items-center gap-2 px-4 py-2.5 bg-cream-100/70 border-t border-cream-300/70">
              <button
                type="button"
                disabled={isBusy}
                onClick={() => resolve(item.id, 'accept')}
                className="px-3 py-1.5 rounded-lg bg-press-accent text-white text-sm font-medium hover:bg-brand-600 disabled:opacity-50 transition-colors"
              >
                {isBusy ? 'Working…' : 'Accept'}
              </button>
              <button
                type="button"
                disabled={isBusy}
                onClick={() => resolve(item.id, 'reject')}
                className="px-3 py-1.5 rounded-lg border border-cream-400 text-sm text-ink-200 hover:bg-cream-200 disabled:opacity-50 transition-colors"
              >
                Reject
              </button>
              <span className="ml-auto text-[11px] text-ink-50">
                {targetTool ? 'Accept also stamps last verified' : isDept ? 'Department changes are not changelog-logged' : ''}
              </span>
            </footer>
          </article>
        )
      })}
    </div>
  )
}
