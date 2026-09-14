'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { PP_TIERS, hostAppLabel, type PpTool } from '@/lib/post-pulse-types'
import { usePostPulse } from './Shell'
import { TierDot } from './Badges'
import { HowToUse } from './HowToUse'

type Lens = 'department' | 'tier' | 'host'

const LENSES: { value: Lens; label: string; param: 'dept' | 'tier' | 'host' }[] = [
  { value: 'department', label: 'Department', param: 'dept' },
  { value: 'tier', label: 'Tier', param: 'tier' },
  { value: 'host', label: 'Host App', param: 'host' },
]

interface TreeNode {
  key: string
  label: string
  tools: PpTool[]
}

// Build the list-view href from the current query, patching some params.
// null removes a param. The three lens params are mutually exclusive: the
// sidebar always replaces them together so a tree click never stacks a
// department on top of a tier selection.
export function listHref(current: URLSearchParams, patch: Record<string, string | null>): string {
  const next = new URLSearchParams(current.toString())
  for (const [k, v] of Object.entries(patch)) {
    if (v === null || v === '') next.delete(k)
    else next.set(k, v)
  }
  const qs = next.toString()
  return qs ? `/post-pulse/tools?${qs}` : '/post-pulse/tools'
}

interface Props {
  onNavigate?: () => void
}

export function Sidebar({ onNavigate }: Props) {
  const { departments, tools, pendingQueueCount, lastRunAt, runsLast24h } = usePostPulse()
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()

  // Which lens is open. Follows the URL on first render so a shared link
  // to ?tier=assisted opens the Tier tree, then it's plain UI state.
  const [lens, setLens] = useState<Lens>(() => {
    if (params.get('tier') && !params.get('dept')) return 'tier'
    if (params.get('host') && !params.get('dept') && !params.get('tier')) return 'host'
    return 'department'
  })
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})

  // Search box: local state, pushed to ?q= after a short pause.
  const [query, setQuery] = useState(params.get('q') ?? '')
  useEffect(() => {
    setQuery(params.get('q') ?? '')
  }, [params])
  useEffect(() => {
    const currentQ = params.get('q') ?? ''
    if (query === currentQ) return
    const t = setTimeout(() => {
      router.push(listHref(params, { q: query.trim() || null }))
    }, 250)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query])

  const deptById = useMemo(() => new Map(departments.map((d) => [d.id, d])), [departments])

  const nodes: TreeNode[] = useMemo(() => {
    if (lens === 'department') {
      return departments.map((d) => ({
        key: d.slug,
        label: d.name,
        tools: tools.filter((t) => t.department_id === d.id),
      }))
    }
    if (lens === 'tier') {
      return PP_TIERS.map((tier) => ({
        key: tier.value,
        label: tier.label,
        tools: tools.filter((t) => t.tier === tier.value),
      }))
    }
    const hosts = Array.from(new Set(tools.map((t) => t.host_app ?? ''))).sort((a, b) =>
      hostAppLabel(a || null).localeCompare(hostAppLabel(b || null))
    )
    return hosts.map((h) => ({
      key: h || 'unknown',
      label: hostAppLabel(h || null),
      tools: tools.filter((t) => (t.host_app ?? '') === h),
    }))
  }, [lens, departments, tools])

  const activeParam = LENSES.find((l) => l.value === lens)!.param
  const activeKey = pathname === '/post-pulse/tools' ? params.get(activeParam) : null
  const onList = pathname === '/post-pulse/tools'
  const nothingSelected = onList && !params.get('dept') && !params.get('tier') && !params.get('host')

  function nodeHref(key: string): string {
    return listHref(params, { dept: null, tier: null, host: null, [activeParam]: key })
  }

  const linkClass = (active: boolean) =>
    [
      'flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-sm transition-colors',
      active ? 'bg-press-accent/10 text-press-accent font-medium' : 'text-ink-200 hover:bg-cream-200',
    ].join(' ')

  return (
    // Bottom padding clears the Listen Queue's fixed mini player (z-40,
    // ~60px) so the last nav items can scroll above it instead of under it.
    <div className="px-3 pt-4 pb-28 flex flex-col gap-4 min-h-full">
      {/* Title */}
      <div className="px-2 hidden md:block">
        <div className="flex items-center gap-2">
          <Link
            href="/"
            className="p-1 -ml-1 rounded-md text-ink-50 hover:text-ink-300 hover:bg-cream-300 transition-colors"
            aria-label="Back to Pulse"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </Link>
          <Link href="/post-pulse" onClick={onNavigate} className="font-display text-xl text-ink-300">
            Post Pulse
          </Link>
        </div>
        <p className="text-[11px] text-ink-50 mt-1">AI tools across the VFX pipeline</p>
      </div>

      {/* Search */}
      <label className="relative block">
        <svg
          className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-50 pointer-events-none"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-4.35-4.35M11 18a7 7 0 100-14 7 7 0 000 14z" />
        </svg>
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search tools, vendors…"
          className="w-full pl-8 pr-3 py-2 rounded-lg bg-cream-50 border border-cream-300 text-sm text-ink-300 placeholder:text-ink-50 focus:outline-none focus:border-press-accent/60 focus:ring-2 focus:ring-press-accent/15"
        />
      </label>

      {/* Lens toggles */}
      <div className="grid grid-cols-3 gap-1 p-1 rounded-lg bg-cream-300/60">
        {LENSES.map((l) => (
          <button
            key={l.value}
            type="button"
            onClick={() => setLens(l.value)}
            className={[
              'py-1.5 rounded-md text-[11px] font-medium transition-colors',
              lens === l.value ? 'bg-cream-50 text-ink-300 shadow-sm' : 'text-ink-100 hover:text-ink-300',
            ].join(' ')}
          >
            {l.label}
          </button>
        ))}
      </div>

      {/* Tree */}
      <nav className="flex flex-col gap-0.5">
        <Link
          href={listHref(params, { dept: null, tier: null, host: null })}
          onClick={onNavigate}
          className={linkClass(nothingSelected)}
        >
          <span className="flex-1">All tools</span>
          <Count n={tools.length} />
        </Link>

        {nodes.map((node) => {
          const isOpen = expanded[`${lens}:${node.key}`] ?? false
          const isActive = activeKey === node.key
          return (
            <div key={node.key}>
              <div className={['flex items-center rounded-lg', isActive ? 'bg-press-accent/10' : ''].join(' ')}>
                <button
                  type="button"
                  aria-label={isOpen ? 'Collapse' : 'Expand'}
                  aria-expanded={isOpen}
                  onClick={() => setExpanded((prev) => ({ ...prev, [`${lens}:${node.key}`]: !isOpen }))}
                  className="p-1.5 ml-0.5 rounded-md text-ink-50 hover:text-ink-300 hover:bg-cream-300/70 transition-colors"
                >
                  <svg
                    className={['w-3.5 h-3.5 transition-transform', isOpen ? 'rotate-90' : ''].join(' ')}
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.25} d="M9 5l7 7-7 7" />
                  </svg>
                </button>
                <Link
                  href={nodeHref(node.key)}
                  onClick={onNavigate}
                  className={[
                    'flex-1 flex items-center gap-2 pr-2.5 py-1.5 text-sm rounded-r-lg transition-colors min-w-0',
                    isActive ? 'text-press-accent font-medium' : 'text-ink-200 hover:text-ink-300',
                  ].join(' ')}
                >
                  {lens === 'tier' && <TierDot tier={node.key as PpTool['tier']} />}
                  <span className="truncate flex-1">{node.label}</span>
                  <Count n={node.tools.length} muted={node.tools.length === 0} />
                </Link>
              </div>

              {isOpen && (
                <ul className="ml-[22px] pl-2 border-l border-cream-300 my-0.5">
                  {node.tools.length === 0 && (
                    <li className="px-2 py-1 text-[11px] text-ink-50 italic">Nothing tracked yet</li>
                  )}
                  {node.tools.map((tool) => (
                    <li key={tool.id}>
                      <Link
                        href={`/post-pulse/tools/${tool.id}`}
                        onClick={onNavigate}
                        className={[
                          'flex items-center gap-1.5 px-2 py-1 rounded-md text-[13px] transition-colors min-w-0',
                          pathname === `/post-pulse/tools/${tool.id}`
                            ? 'text-press-accent font-medium'
                            : 'text-ink-100 hover:text-ink-300 hover:bg-cream-200',
                          tool.status === 'discontinued' ? 'line-through decoration-ink-50/60' : '',
                        ].join(' ')}
                      >
                        {lens !== 'tier' && <TierDot tier={tool.tier} />}
                        <span className="truncate">{tool.name}</span>
                        {lens === 'tier' && (
                          <span className="ml-auto text-[10px] text-ink-50 truncate max-w-[40%]">
                            {deptById.get(tool.department_id)?.name}
                          </span>
                        )}
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )
        })}
      </nav>

      <div className="h-px bg-cream-300/80 mx-1" />

      {/* Queue / changes / chat */}
      <nav className="flex flex-col gap-0.5">
        <Link href="/post-pulse/queue" onClick={onNavigate} className={linkClass(pathname === '/post-pulse/queue')}>
          <svg className="w-4 h-4 text-ink-50" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
          </svg>
          <span className="flex-1">Review queue</span>
          {pendingQueueCount > 0 ? (
            <span className="min-w-[20px] h-5 px-1.5 rounded-full bg-press-accent text-white text-[11px] font-medium flex items-center justify-center">
              {pendingQueueCount}
            </span>
          ) : (
            <Count n={0} muted />
          )}
        </Link>
        {/* Research activity lives only here (no Pulse briefing/banner any more),
            so the nav item carries a passive indicator: runs today, last run. */}
        <Link href="/post-pulse/activity" onClick={onNavigate} className={linkClass(pathname === '/post-pulse/activity')}>
          <svg className="w-4 h-4 text-ink-50" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M13 10V3L4 14h7v7l9-11h-7z" />
          </svg>
          <span className="flex-1">Activity</span>
          {runsLast24h > 0 ? (
            <span
              className="min-w-[20px] h-5 px-1.5 rounded-full bg-press-up/15 text-press-up text-[11px] font-medium flex items-center justify-center"
              title={`${runsLast24h} research ${runsLast24h === 1 ? 'run' : 'runs'} in the last 24 hours`}
            >
              {runsLast24h}
            </span>
          ) : lastRunAt ? (
            <span className="text-[10px] text-ink-50" title={lastRunAt}>
              {relativeShort(lastRunAt)}
            </span>
          ) : null}
        </Link>
        <Link href="/post-pulse/changes" onClick={onNavigate} className={linkClass(pathname === '/post-pulse/changes')}>
          <svg className="w-4 h-4 text-ink-50" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <span className="flex-1">What changed</span>
        </Link>
        <Link href="/post-pulse/chat" onClick={onNavigate} className={linkClass(pathname.startsWith('/post-pulse/chat'))}>
          <svg className="w-4 h-4 text-ink-50" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M8 10h8m-8 4h5m-9 6l3.5-3.5H18a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v14z" />
          </svg>
          <span className="flex-1">Research chat</span>
        </Link>
        {/* Non-primary content opens in an overlay (same pattern as compare mode) */}
        <HowToUse
          onNavigate={onNavigate}
          className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-sm transition-colors text-ink-200 hover:bg-cream-200"
        />
      </nav>
    </div>
  )
}

function relativeShort(iso: string): string {
  const m = Math.round((Date.now() - Date.parse(iso)) / 60_000)
  if (m < 60) return `${Math.max(m, 1)}m ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.round(h / 24)}d ago`
}

function Count({ n, muted }: { n: number; muted?: boolean }) {
  return (
    <span
      className={[
        'text-[11px] tabular-nums px-1.5 py-px rounded-full',
        muted ? 'text-ink-50/70' : 'text-ink-100 bg-cream-300/70',
      ].join(' ')}
    >
      {n}
    </span>
  )
}
