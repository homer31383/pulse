'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import {
  PP_HOST_APPS,
  PP_SORTS,
  PP_STATUSES,
  PP_TIERS,
  PP_TIER_BY_VALUE,
  hostAppLabel,
  type PpSort,
  type PpTool,
} from '@/lib/post-pulse-types'
import { useQueue } from '@/contexts/QueueContext'
import { usePostPulse } from './Shell'
import { listHref } from './Sidebar'
import { HostChip, StatusBadge, TierBadge } from './Badges'
import { CompareOverlay } from './CompareOverlay'

const TIER_RANK: Record<PpTool['tier'], number> = { automated: 0, assisted: 1, artist_led: 2 }
const MAX_COMPARE = 3

export function ToolList() {
  const { departments, tools } = usePostPulse()
  const router = useRouter()
  const params = useSearchParams()

  const deptSlug = params.get('dept')
  const tier = params.get('tier')
  const host = params.get('host')
  const status = params.get('status')
  const q = (params.get('q') ?? '').trim().toLowerCase()
  const sort = (params.get('sort') ?? 'name') as PpSort

  const deptById = useMemo(() => new Map(departments.map((d) => [d.id, d])), [departments])
  const toolById = useMemo(() => new Map(tools.map((t) => [t.id, t])), [tools])
  const dept = deptSlug ? departments.find((d) => d.slug === deptSlug) ?? null : null

  const filtered = useMemo(() => {
    let list = tools
    if (dept) list = list.filter((t) => t.department_id === dept.id)
    if (tier) list = list.filter((t) => t.tier === tier)
    if (host) list = list.filter((t) => (t.host_app ?? 'unknown') === host)
    if (status) list = list.filter((t) => t.status === status)
    if (q) {
      list = list.filter((t) =>
        [t.name, t.vendor ?? '', t.blurb ?? '', deptById.get(t.department_id)?.name ?? '']
          .join(' ')
          .toLowerCase()
          .includes(q)
      )
    }
    const sorted = [...list]
    switch (sort) {
      case 'tier':
        sorted.sort((a, b) => TIER_RANK[a.tier] - TIER_RANK[b.tier] || a.name.localeCompare(b.name))
        break
      case 'host':
        sorted.sort((a, b) => hostAppLabel(a.host_app).localeCompare(hostAppLabel(b.host_app)) || a.name.localeCompare(b.name))
        break
      case 'vendor':
        sorted.sort((a, b) => (a.vendor ?? '~').localeCompare(b.vendor ?? '~') || a.name.localeCompare(b.name))
        break
      case 'updated':
        sorted.sort((a, b) => b.updated_at.localeCompare(a.updated_at))
        break
      default:
        sorted.sort((a, b) => a.name.localeCompare(b.name))
    }
    return sorted
  }, [tools, dept, tier, host, status, q, sort, deptById])

  // The Listen Queue's mini player is `fixed bottom-0 z-40` (MiniPlayer.tsx)
  // and shows whenever there's a current item or a "queue finished" notice.
  // The compare bar has to sit above it in both senses: higher z-index and
  // offset by the player's height, or it's unreachable behind the player.
  const queue = useQueue()
  const playerVisible = !queue.expanded && (queue.current !== null || queue.finished !== null)

  // Compare selection lives here (not in the URL): it's a transient overlay.
  const [selected, setSelected] = useState<string[]>([])
  const [comparing, setComparing] = useState(false)
  useEffect(() => {
    // Drop selections that scrolled out of the current filter set.
    setSelected((prev) => prev.filter((id) => filtered.some((t) => t.id === id)))
  }, [filtered])

  const selectedTools = selected.map((id) => toolById.get(id)).filter(Boolean) as PpTool[]
  const sameDepartment = selectedTools.every((t) => t.department_id === selectedTools[0]?.department_id)
  const canCompare = selectedTools.length >= 2 && selectedTools.length <= MAX_COMPARE && sameDepartment

  function toggleSelect(id: string) {
    setSelected((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id)
      if (prev.length >= MAX_COMPARE) return prev
      return [...prev, id]
    })
  }

  function setParam(key: string, value: string | null) {
    router.push(listHref(params, { [key]: value }))
  }

  const hostOptions = useMemo(() => {
    const seen = new Set<string>(PP_HOST_APPS)
    for (const t of tools) if (t.host_app) seen.add(t.host_app)
    return Array.from(seen)
  }, [tools])

  const title = dept
    ? dept.name
    : tier
      ? PP_TIER_BY_VALUE[tier as PpTool['tier']]?.label ?? 'Tools'
      : host
        ? hostAppLabel(host === 'unknown' ? null : host)
        : 'All tools'

  const activeFilters = [tier && 'tier', host && 'host', status && 'status', q && 'q'].filter(Boolean).length

  return (
    <div className={playerVisible || selected.length > 0 ? 'pb-32' : ''}>
      {/* Heading */}
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 mb-1">
        <h1 className="font-display text-2xl text-ink-300">{title}</h1>
        <span className="text-sm text-ink-50 tabular-nums">
          {filtered.length} {filtered.length === 1 ? 'tool' : 'tools'}
          {filtered.length !== tools.length && ` of ${tools.length}`}
        </span>
        {dept && (
          <Link
            href={`/post-pulse/departments/${dept.slug}`}
            className="text-sm text-press-accent hover:underline ml-auto"
          >
            Read the department doc →
          </Link>
        )}
      </div>
      {dept && (
        <p className="text-sm text-ink-100 leading-relaxed mb-4 max-w-2xl line-clamp-2">
          {firstParagraph(dept.overview_doc)}
        </p>
      )}

      {/* Filters — independent of whichever sidebar lens picked the base set */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <FilterSelect
          label="Tier"
          value={tier ?? ''}
          onChange={(v) => setParam('tier', v || null)}
          options={PP_TIERS.map((t) => ({ value: t.value, label: t.short }))}
        />
        <FilterSelect
          label="Host"
          value={host ?? ''}
          onChange={(v) => setParam('host', v || null)}
          options={hostOptions.map((h) => ({ value: h, label: hostAppLabel(h) }))}
        />
        <FilterSelect
          label="Status"
          value={status ?? ''}
          onChange={(v) => setParam('status', v || null)}
          options={PP_STATUSES.map((s) => ({ value: s.value, label: s.label }))}
        />
        <span className="flex-1" />
        <FilterSelect
          label="Sort"
          value={sort}
          onChange={(v) => setParam('sort', v === 'name' ? null : v)}
          options={PP_SORTS.map((s) => ({ value: s.value, label: s.label }))}
          noAny
        />
        {activeFilters > 0 && (
          <button
            type="button"
            onClick={() => router.push(listHref(params, { tier: null, host: null, status: null, q: null }))}
            className="text-xs text-ink-100 hover:text-press-accent underline-offset-2 hover:underline"
          >
            Clear filters
          </button>
        )}
      </div>

      {/* Rows */}
      {filtered.length === 0 ? (
        <div className="text-center py-16 text-sm text-ink-50">
          {tools.length === 0
            ? 'No tools yet. Run the Post Pulse migration and seed, then reload.'
            : 'Nothing matches these filters.'}
        </div>
      ) : (
        <ul className="rounded-xl border border-cream-300 bg-cream-50 divide-y divide-cream-300/70 overflow-hidden">
          {filtered.map((tool) => {
            const isSelected = selected.includes(tool.id)
            const replacement = tool.replacement_tool_id ? toolById.get(tool.replacement_tool_id) : null
            return (
              <li
                key={tool.id}
                className={['flex gap-3 px-3 sm:px-4 py-3 transition-colors', isSelected ? 'bg-press-accent/5' : 'hover:bg-cream-100/70'].join(' ')}
              >
                <label className="pt-0.5 flex-shrink-0 cursor-pointer" title="Select to compare">
                  <input
                    type="checkbox"
                    checked={isSelected}
                    disabled={!isSelected && selected.length >= MAX_COMPARE}
                    onChange={() => toggleSelect(tool.id)}
                    className="w-4 h-4 rounded border-cream-400 text-press-accent focus:ring-press-accent/30 accent-[#6B5CA5] disabled:opacity-40"
                    aria-label={`Select ${tool.name} to compare`}
                  />
                </label>
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <Link
                      href={`/post-pulse/tools/${tool.id}`}
                      className="font-medium text-ink-300 hover:text-press-accent transition-colors"
                    >
                      {tool.name}
                    </Link>
                    <TierBadge tier={tool.tier} />
                    <HostChip host={tool.host_app} />
                    <StatusBadge status={tool.status} />
                    {!dept && (
                      <Link
                        href={listHref(params, { dept: deptById.get(tool.department_id)?.slug ?? null, tier: null, host: null })}
                        className="text-[11px] text-ink-50 hover:text-press-accent"
                      >
                        {deptById.get(tool.department_id)?.name}
                      </Link>
                    )}
                  </div>
                  {tool.blurb && (
                    <p className="text-sm text-ink-100 mt-1 leading-snug line-clamp-2 sm:line-clamp-1">{tool.blurb}</p>
                  )}
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 mt-1 text-[11px] text-ink-50">
                    {tool.vendor && <span>{tool.vendor}</span>}
                    {replacement && (
                      <span>
                        Replaced by{' '}
                        <Link href={`/post-pulse/tools/${replacement.id}`} className="text-press-accent hover:underline">
                          {replacement.name}
                        </Link>
                      </span>
                    )}
                    {tool.confidence === 'queued' && <span className="text-press-down">Unverified</span>}
                  </div>
                </div>
              </li>
            )
          })}
        </ul>
      )}

      {/* Compare bar */}
      {selected.length > 0 && !comparing && (
        <div
          className={[
            'fixed left-0 right-0 z-50 flex justify-center pointer-events-none px-4',
            playerVisible ? 'bottom-[calc(72px+env(safe-area-inset-bottom,0px))]' : 'bottom-[calc(1rem+env(safe-area-inset-bottom,0px))]',
          ].join(' ')}
        >
          <div className="pointer-events-auto flex items-center gap-3 px-4 py-2.5 rounded-full bg-ink-300 text-cream-50 shadow-xl text-sm">
            <span className="tabular-nums">
              {selected.length} of {MAX_COMPARE} selected
            </span>
            {!sameDepartment && <span className="text-cream-500 text-xs">Compare works within one department</span>}
            {sameDepartment && selected.length < 2 && <span className="text-cream-500 text-xs">Pick one more</span>}
            <button
              type="button"
              disabled={!canCompare}
              onClick={() => setComparing(true)}
              className="px-3 py-1 rounded-full bg-press-accent text-white font-medium disabled:opacity-40 disabled:cursor-not-allowed hover:bg-brand-600 transition-colors"
            >
              Compare
            </button>
            <button
              type="button"
              onClick={() => setSelected([])}
              className="text-cream-500 hover:text-cream-50 transition-colors"
              aria-label="Clear selection"
            >
              ×
            </button>
          </div>
        </div>
      )}

      {comparing && canCompare && (
        <CompareOverlay
          tools={selectedTools}
          department={deptById.get(selectedTools[0].department_id) ?? null}
          allTools={tools}
          onClose={() => setComparing(false)}
        />
      )}
    </div>
  )
}

function FilterSelect({
  label,
  value,
  onChange,
  options,
  noAny,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  options: { value: string; label: string }[]
  noAny?: boolean
}) {
  return (
    <label className="inline-flex items-center gap-1.5 text-xs text-ink-100">
      <span>{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={[
          'rounded-md border bg-cream-50 px-2 py-1 text-xs text-ink-300 focus:outline-none focus:border-press-accent/60',
          value && !noAny ? 'border-press-accent/50' : 'border-cream-300',
        ].join(' ')}
      >
        {!noAny && <option value="">Any</option>}
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  )
}

// First non-heading paragraph of a department doc, for the list header.
export function firstParagraph(md: string): string {
  const blocks = md.split(/\n\s*\n/)
  for (const b of blocks) {
    const t = b.trim()
    if (!t || t.startsWith('#')) continue
    return t.replace(/\s+/g, ' ')
  }
  return ''
}
