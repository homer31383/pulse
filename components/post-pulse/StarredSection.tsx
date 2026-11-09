'use client'

// "Your starred" on the Post-Pulse landing page (migration 038): the cookie
// profile's starred tools across every department, starred departments, and
// starred proposals still awaiting review. Collapsible (state saved per
// profile in settings.post_pulse_starred_collapsed) and capped in height
// with its own scroll, so it never pushes the catch-up panel or the
// pipeline map off the screen.
//
// A row unstarred here stays (outline star) until the page is left, so a
// mis-tap can be undone; a star set elsewhere on the page shows at once.

import Link from 'next/link'
import { useMemo } from 'react'
import { usePostPulse } from './Shell'
import { StarButton, useInterest } from './Interest'
import { toolHostApps, toolNameKey, type PpPendingStarInfo } from '@/lib/post-pulse-interest-types'
import type { PpDepartment, PpTool } from '@/lib/post-pulse-types'

interface ToolGroup {
  key: string
  tools: PpTool[]
  departments: PpDepartment[]
  hosts: string[]
  crossPlatform: boolean
}

export function StarredSection() {
  const { tools, departments } = usePostPulse()
  const it = useInterest()
  const { live, settled } = it

  const toolGroups = useMemo(() => {
    const ids = new Set([...live.tools, ...settled.tools])
    const groups = new Map<string, ToolGroup>()
    for (const t of tools) {
      if (!ids.has(t.id)) continue
      const key = toolNameKey(t.name)
      const g = groups.get(key) ?? { key, tools: [], departments: [], hosts: [], crossPlatform: false }
      g.tools.push(t)
      const d = departments.find((x) => x.id === t.department_id)
      if (d && !g.departments.some((x) => x.id === d.id)) g.departments.push(d)
      for (const h of toolHostApps(t)) if (!g.hosts.includes(h)) g.hosts.push(h)
      groups.set(key, g)
    }
    for (const g of groups.values()) g.crossPlatform = g.departments.length > 1 || g.hosts.length >= 2
    return [...groups.values()].sort((a, b) => a.tools[0].name.localeCompare(b.tools[0].name))
  }, [tools, departments, live.tools, settled.tools])

  const starredDepts = useMemo(() => {
    const ids = new Set([...live.departments, ...settled.departments])
    return departments.filter((d) => ids.has(d.id))
  }, [departments, live.departments, settled.departments])

  // One row per starred proposal group (duplicates collapse), newest member
  const proposals = useMemo(() => {
    const groups = new Map<string, PpPendingStarInfo[]>()
    for (const p of it.pending) {
      if (!it.proposalStar(p.id, live).direct && !it.proposalStar(p.id, settled).direct) continue
      const g = groups.get(p.groupKey) ?? []
      g.push(p)
      groups.set(p.groupKey, g)
    }
    return [...groups.values()]
      .map((g) => g.sort((a, b) => b.createdAt.localeCompare(a.createdAt)))
      .sort((a, b) => b[0].createdAt.localeCompare(a[0].createdAt))
  }, [it, live, settled])

  const liveTools = toolGroups.filter((g) => g.tools.some((t) => live.tools.has(t.id))).length
  const liveDepts = starredDepts.filter((d) => live.departments.has(d.id)).length
  const liveProps = proposals.filter((g) => it.proposalStar(g[0].id, live).direct).length
  const total = toolGroups.length + starredDepts.length + proposals.length

  const summary = [
    liveTools ? `${liveTools} ${liveTools === 1 ? 'tool' : 'tools'}` : null,
    liveDepts ? `${liveDepts} ${liveDepts === 1 ? 'department' : 'departments'}` : null,
    liveProps ? `${liveProps} ${liveProps === 1 ? 'proposal' : 'proposals'} awaiting review` : null,
  ]
    .filter(Boolean)
    .join(' · ')

  if (total === 0) {
    return (
      <p className="mb-6 font-chrome text-[11px] text-press-muted">
        <span className="press-label mr-2">Your starred</span>
        Nothing starred yet. Star the tools, departments and proposals you care most about to keep them here.
      </p>
    )
  }

  const collapsed = it.collapsed
  const rowLabel = 'font-georgia text-[15px] leading-snug text-press-ink hover:text-press-accent transition-colors'
  const meta = 'font-chrome text-[10px] text-press-muted'

  return (
    <section aria-label="Your starred" className="mb-6">
      <button
        type="button"
        onClick={() => it.setCollapsed(!collapsed)}
        aria-expanded={!collapsed}
        className="w-full min-h-[44px] flex items-center gap-3 text-left"
      >
        <span className="press-label whitespace-nowrap">Your starred</span>
        <span className="flex-1 press-rule-h" />
        <span className="font-chrome text-[11px] text-press-muted truncate max-w-[60%]">{summary || 'Nothing starred'}</span>
        <svg
          className={`w-3.5 h-3.5 flex-shrink-0 text-press-muted transition-transform ${collapsed ? '' : 'rotate-180'}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          aria-hidden
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {!collapsed && (
        <div className="review-scroll max-h-[34vh] md:max-h-[300px] overflow-y-auto pr-1">
          {toolGroups.length > 0 && (
            <ul>
              {toolGroups.map((g) => (
                <li key={g.key} className="flex items-start gap-2 py-1.5 border-b-[0.5px] border-press-hair">
                  <StarButton type="tool" id={g.tools[0].id} name={g.tools[0].name} className="-ml-2.5 -my-1" />
                  <div className="flex-1 min-w-0 pt-1.5">
                    <Link href={`/post-pulse/tools/${g.tools[0].id}`} className={rowLabel}>
                      {g.tools[0].name}
                    </Link>
                    <p className={`${meta} mt-0.5`}>
                      {g.departments.map((d, i) => (
                        <span key={d.id}>
                          {i > 0 && ' · '}
                          <Link href={`/post-pulse/tools?dept=${d.slug}`} className="hover:text-press-accent">
                            {d.name}
                          </Link>
                        </span>
                      ))}
                      {g.crossPlatform && (
                        <span
                          className="ml-2 inline-block font-chrome text-[9px] uppercase tracking-[1.2px] text-press-accent border-[0.5px] border-press-accent/40 px-1"
                          title={
                            g.departments.length > 1
                              ? `Tracked in ${g.departments.length} departments${g.hosts.length ? `; hosts: ${g.hosts.join(', ')}` : ''}`
                              : `Hosts: ${g.hosts.join(', ')}`
                          }
                        >
                          cross-platform
                        </span>
                      )}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}

          {starredDepts.length > 0 && (
            <>
              <h3 className={`${meta} uppercase tracking-[1.5px] mt-3 mb-0.5`}>Departments</h3>
              <ul>
                {starredDepts.map((d) => (
                  <li key={d.id} className="flex items-center gap-2 py-0.5 border-b-[0.5px] border-press-hair">
                    <StarButton type="department" id={d.id} name={d.name} className="-ml-2.5" />
                    <Link href={`/post-pulse/departments/${d.slug}`} className={`${rowLabel} flex-1 min-w-0`}>
                      {d.name}
                    </Link>
                  </li>
                ))}
              </ul>
            </>
          )}

          {proposals.length > 0 && (
            <>
              <h3 className={`${meta} uppercase tracking-[1.5px] mt-3 mb-0.5`}>Awaiting review</h3>
              <ul>
                {proposals.map((g) => {
                  const p = g[0]
                  return (
                    <li key={p.groupKey} className="flex items-start gap-2 py-1.5 border-b-[0.5px] border-press-hair">
                      <StarButton type="queue_item" id={p.id} name={p.title} className="-ml-2.5 -my-1" />
                      <div className="flex-1 min-w-0 pt-1.5">
                        <Link href={`/post-pulse/queue#q-${p.id}`} className={rowLabel}>
                          {p.title}
                        </Link>
                        <p className={`${meta} mt-0.5`}>
                          {[p.department, p.flagged ? 'needs resolving in chat' : null, g.length > 1 ? `${g.length} copies in the queue` : null]
                            .filter(Boolean)
                            .join(' · ')}
                        </p>
                      </div>
                    </li>
                  )
                })}
              </ul>
            </>
          )}
        </div>
      )}
    </section>
  )
}
