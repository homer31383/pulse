'use client'

// Post-Pulse stars on the client: one context for every view under the
// Post-Pulse shell (tool list, tool page, department doc, review queue,
// catch-up panel, chat, "Your starred"), so a star set in one place shows
// everywhere at once. The layout loads the profile's state on the server
// (lib/post-pulse-interest.ts); toggles are optimistic and roll back with a
// message if the request fails.
//
// Ordering uses `settled`, not the live state: lists sort starred rows first
// by the stars as they were when the view was opened (or the server state
// last refreshed), so a row doesn't jump away from under the tap. A view
// calls resettle() when its own filters change.

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { usePathname } from 'next/navigation'
import type { PpInterestState, PpInterestTarget, PpPendingStarInfo } from '@/lib/post-pulse-interest-types'

export interface StarSets {
  tools: Set<string>
  departments: Set<string>
  queueItems: Set<string>
}

// How a pending proposal stands: directly starred (any pending member of its
// group has a star row) and/or about a starred tool or department.
export interface ProposalStar {
  direct: boolean
  viaTarget: 'tool' | 'department' | null
}

interface InterestCtx {
  live: StarSets
  settled: StarSets
  pending: PpPendingStarInfo[]
  pendingById: Map<string, PpPendingStarInfo>
  collapsed: boolean
  setCollapsed: (v: boolean) => void
  isStarred: (type: 'tool' | 'department', id: string) => boolean
  proposalStar: (id: string, sets?: StarSets) => ProposalStar
  // 0 = directly starred, 1 = about a starred tool/department, 2 = neither
  proposalRank: (id: string, sets?: StarSets) => number
  toggle: (type: PpInterestTarget, id: string, name: string) => void
  busy: (type: PpInterestTarget, id: string) => boolean
  resettle: () => void
}

const Ctx = createContext<InterestCtx | null>(null)

export function useInterest(): InterestCtx {
  const c = useContext(Ctx)
  if (!c) throw new Error('useInterest must be used inside InterestProvider')
  return c
}

function toSets(s: PpInterestState): StarSets {
  return { tools: new Set(s.tools), departments: new Set(s.departments), queueItems: new Set(s.queueItems) }
}

function clone(s: StarSets): StarSets {
  return { tools: new Set(s.tools), departments: new Set(s.departments), queueItems: new Set(s.queueItems) }
}

const setKey = (type: PpInterestTarget): keyof StarSets =>
  type === 'tool' ? 'tools' : type === 'department' ? 'departments' : 'queueItems'

export function InterestProvider({ state, children }: { state: PpInterestState; children: ReactNode }) {
  const [live, setLive] = useState<StarSets>(() => toSets(state))
  const [settled, setSettled] = useState<StarSets>(() => toSets(state))
  const [collapsed, setCollapsedState] = useState(state.collapsed)
  const [inflight, setInflight] = useState<Set<string>>(() => new Set())
  const [toast, setToast] = useState<string | null>(null)
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const liveRef = useRef(live)
  liveRef.current = live

  // A fresh server snapshot (router.refresh, e.g. after accepting a
  // proposal whose star carried over) replaces both views of the state.
  useEffect(() => {
    setLive(toSets(state))
    setSettled(toSets(state))
    setCollapsedState(state.collapsed)
  }, [state])

  // A new page re-sorts by the stars as they are now
  const pathname = usePathname()
  useEffect(() => {
    setSettled(clone(liveRef.current))
  }, [pathname])

  useEffect(() => () => { if (toastTimer.current) clearTimeout(toastTimer.current) }, [])

  const pendingById = useMemo(() => new Map(state.pending.map((p) => [p.id, p])), [state.pending])

  const proposalStar = useCallback(
    (id: string, sets: StarSets = live): ProposalStar => {
      const info = pendingById.get(id)
      if (!info) return { direct: sets.queueItems.has(id), viaTarget: null }
      let direct = false
      for (const p of state.pending) {
        if (p.groupKey === info.groupKey && sets.queueItems.has(p.id)) { direct = true; break }
      }
      let viaTarget: ProposalStar['viaTarget'] = null
      if (info.targetKey?.startsWith('tool:') && sets.tools.has(info.targetKey.slice(5))) viaTarget = 'tool'
      if (info.targetKey?.startsWith('department:') && sets.departments.has(info.targetKey.slice(11))) viaTarget = 'department'
      return { direct, viaTarget }
    },
    [live, pendingById, state.pending],
  )

  const proposalRank = useCallback(
    (id: string, sets: StarSets = settled) => {
      const s = proposalStar(id, sets)
      return s.direct ? 0 : s.viaTarget ? 1 : 2
    },
    [proposalStar, settled],
  )

  function showError(text: string) {
    setToast(text)
    if (toastTimer.current) clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(null), 6000)
  }

  const toggle = useCallback(
    (type: PpInterestTarget, id: string, name: string) => {
      const k = `${type}:${id}`
      if (inflight.has(k)) return
      const before = liveRef.current
      const wasStarred = type === 'queue_item' ? proposalStar(id, before).direct : before[setKey(type)].has(id)
      const starred = !wasStarred
      // Optimistic: a proposal unstar clears its whole group
      const next = clone(before)
      if (type === 'queue_item' && !starred) {
        const g = pendingById.get(id)?.groupKey
        next.queueItems.delete(id)
        if (g) for (const p of state.pending) if (p.groupKey === g) next.queueItems.delete(p.id)
      } else if (starred) next[setKey(type)].add(id)
      else next[setKey(type)].delete(id)
      setLive(next)
      setInflight((s) => new Set(s).add(k))
      void (async () => {
        try {
          const res = await fetch('/api/post-pulse/interest', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ targetType: type, targetId: id, starred }),
          })
          const body = await res.json().catch(() => ({}))
          if (!res.ok) throw new Error(body.error ?? `Request failed (${res.status})`)
        } catch (err) {
          // Roll back just this target (other toggles may have landed since)
          setLive((cur) => {
            const r = clone(cur)
            if (type === 'queue_item') {
              for (const qid of before.queueItems) {
                if (pendingById.get(qid)?.groupKey === pendingById.get(id)?.groupKey || qid === id) r.queueItems.add(qid)
              }
              if (starred) r.queueItems.delete(id)
            } else if (starred) r[setKey(type)].delete(id)
            else r[setKey(type)].add(id)
            return r
          })
          showError(`Couldn't ${starred ? 'star' : 'unstar'} ${name}: ${err instanceof Error ? err.message : String(err)}`)
        } finally {
          setInflight((s) => {
            const n = new Set(s)
            n.delete(k)
            return n
          })
        }
      })()
    },
    [inflight, pendingById, proposalStar, state.pending],
  )

  const setCollapsed = useCallback((v: boolean) => {
    setCollapsedState(v)
    void fetch('/api/post-pulse/interest', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ collapsed: v }),
    }).catch(() => {})
  }, [])

  const value: InterestCtx = {
    live,
    settled,
    pending: state.pending,
    pendingById,
    collapsed,
    setCollapsed,
    isStarred: (type, id) => live[setKey(type)].has(id),
    proposalStar,
    proposalRank,
    toggle,
    busy: (type, id) => inflight.has(`${type}:${id}`),
    resettle: () => setSettled(clone(liveRef.current)),
  }

  return (
    <Ctx.Provider value={value}>
      {children}
      {toast && (
        <div
          role="alert"
          className="fixed left-0 right-0 z-[60] flex justify-center px-4 pointer-events-none bottom-[calc(var(--mini-player-h,0px)+12px+env(safe-area-inset-bottom,0px))]"
        >
          <div className="pointer-events-auto max-w-md w-full flex items-start gap-3 px-4 py-2.5 bg-press-ink text-white shadow-xl font-chrome text-[12px]">
            <span className="flex-1 min-w-0 break-words">{toast}</span>
            <button type="button" onClick={() => setToast(null)} aria-label="Close message" className="-m-2 w-11 h-11 flex items-center justify-center text-white/70 hover:text-white">
              ×
            </button>
          </div>
        </div>
      )}
    </Ctx.Provider>
  )
}

// The star control: a 44px button with a 20px star, indigo filled when
// starred, indigo outline when not. aria-label "Star <name>" / "Unstar
// <name>" ("Star proposal <title>" for proposals).
export function StarButton({
  type,
  id,
  name,
  className = '',
}: {
  type: PpInterestTarget
  id: string
  name: string
  className?: string
}) {
  const it = useInterest()
  const on = type === 'queue_item' ? it.proposalStar(id).direct : it.isStarred(type, id)
  const noun = type === 'queue_item' ? 'proposal ' : ''
  return (
    <button
      type="button"
      onClick={(e) => {
        e.preventDefault()
        e.stopPropagation()
        it.toggle(type, id, name)
      }}
      aria-pressed={on}
      aria-label={`${on ? 'Unstar' : 'Star'} ${noun}${name}`}
      title={on ? 'Starred: tap to unstar' : 'Star: very interested'}
      className={`w-11 h-11 flex-shrink-0 flex items-center justify-center rounded-full text-press-accent hover:bg-press-accent/10 transition-colors ${className}`}
    >
      <svg className="w-5 h-5" viewBox="0 0 24 24" aria-hidden fill={on ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth={on ? 1.5 : 1.75} strokeLinejoin="round">
        <path d="M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.8z" />
      </svg>
    </button>
  )
}

// Small inline tag for a proposal that sorts with the starred ones because
// its tool or department is starred.
export function StarredTargetTag({ kind }: { kind: 'tool' | 'department' }) {
  return (
    <span className="inline-flex items-center gap-1 font-chrome text-[9px] uppercase tracking-[1.2px] text-press-accent border-[0.5px] border-press-accent/40 px-1 py-px align-[2px]">
      <svg className="w-2.5 h-2.5" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
        <path d="M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.8z" />
      </svg>
      starred {kind}
    </span>
  )
}
