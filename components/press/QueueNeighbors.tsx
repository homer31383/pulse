'use client'

import { useEffect, useMemo, useRef } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useQueue, type QueueKind } from '@/contexts/QueueContext'
import type { ListenQueueItem } from '@/lib/types'

// Previous / Next for the reading view: steps the reader through the listen
// queue in queue order. Navigation only — it never touches playback, read
// state or the queue itself (same as the queue's own "Read" links).

export interface QueueNeighbors {
  prev: ListenQueueItem | null
  next: ListenQueueItem | null
  inQueue: boolean                  // false → render no bar at all
}

// Neighbors of (kind, itemId) among the unplayed items. Reads queue.items (via
// `unplayed`) so it re-renders when the queue loads. Once the item has been
// seen in the queue, its position is remembered: if it then leaves (finished
// playing, removed), the neighbors are the items either side of that spot.
export function useQueueNeighbors(kind: QueueKind, itemId: string, query = ''): QueueNeighbors {
  const { unplayed } = useQueue()
  const router = useRouter()
  const anchor = useRef<number | null>(null)

  const result = useMemo<QueueNeighbors>(() => {
    const idx = unplayed.findIndex((i) => i.kind === kind && i.item_id === itemId)
    if (idx >= 0) {
      anchor.current = unplayed[idx].position
      return { prev: unplayed[idx - 1] ?? null, next: unplayed[idx + 1] ?? null, inQueue: true }
    }
    const pos = anchor.current
    if (pos === null) return { prev: null, next: null, inQueue: false }
    const before = unplayed.filter((i) => i.position < pos)
    return { prev: before[before.length - 1] ?? null, next: unplayed.find((i) => i.position > pos) ?? null, inQueue: true }
  }, [unplayed, kind, itemId])

  const { prev, next } = result
  const prevHref = prev ? readHref(prev, query) : null
  const nextHref = next ? readHref(next, query) : null

  // Neighbor pages are cheap server renders; warm them so the step is instant
  useEffect(() => {
    if (prevHref) router.prefetch(prevHref)
    if (nextHref) router.prefetch(nextHref)
  }, [router, prevHref, nextHref])

  // Desktop: ← / → step through the queue, unless the keys belong to something else
  useEffect(() => {
    if (!prevHref && !nextHref) return
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return
      const t = e.target as HTMLElement | null
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.closest('[role="slider"], [role="dialog"]'))) return
      const href = e.key === 'ArrowLeft' ? prevHref : e.key === 'ArrowRight' ? nextHref : null
      if (!href) return
      e.preventDefault()
      router.push(href)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [router, prevHref, nextHref])

  return result
}

export function readHref(item: { kind: QueueKind; item_id: string }, query = '') {
  return `/read/${item.kind}/${item.item_id}${query}`
}

export function QueueNeighborBar({ neighbors, query = '', className = '' }: { neighbors: QueueNeighbors; query?: string; className?: string }) {
  if (!neighbors.inQueue) return null
  const { prev, next } = neighbors
  return (
    <nav aria-label="Listen queue" className={`grid grid-cols-2 gap-3 border-y-[0.5px] border-press-hair font-chrome ${className}`}>
      {prev ? <NeighborLink item={prev} dir="prev" query={query} /> : <span aria-hidden />}
      {next ? <NeighborLink item={next} dir="next" query={query} /> : <span aria-hidden />}
    </nav>
  )
}

function NeighborLink({ item, dir, query }: { item: ListenQueueItem; dir: 'prev' | 'next'; query: string }) {
  const label = dir === 'prev' ? 'Previous' : 'Next'
  return (
    <Link
      href={readHref(item, query)}
      aria-label={`${label}: ${item.title}`}
      className={`group flex items-center gap-1.5 min-h-[44px] min-w-0 text-[10px] uppercase tracking-[1.5px] ${dir === 'next' ? 'justify-end text-right' : ''}`}
    >
      {dir === 'prev' && <span aria-hidden className="text-press-accent">‹</span>}
      <span className="flex-shrink-0 text-press-accent">{label}:</span>
      <span className="truncate text-press-muted group-hover:text-press-accent transition-colors">{item.title}</span>
      {dir === 'next' && <span aria-hidden className="text-press-accent">›</span>}
    </Link>
  )
}
