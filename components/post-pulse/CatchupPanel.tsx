'use client'

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { useQueue } from '@/contexts/QueueContext'
import { PRESS_MD_COMPONENTS } from '@/components/press/PressArticle'
import { formatCost } from '@/lib/cost'
import {
  CATCHUP_FROM_PARAM,
  type Catchup,
  type CatchupEntry,
  type CatchupReviewItem,
  type CatchupSummary,
} from '@/lib/post-pulse-catchup-types'

// How long a dismiss can be undone from the toast. The server allows a
// reopen for 60 s (REOPEN_WINDOW_MS), so a late click still works.
const UNDO_MS = 6000

// "While you were away": Post-Pulse briefings/digests created since the last
// visit, compiled on the server (no generation), then the review queue's
// pending proposals. Broadsheet aside treatment inside the utility-palette
// Post-Pulse page.
//
// Two different lifetimes: briefings/digests are a feed, cleared only by
// "Mark all as seen" (leaving, reloading, closing the tab and collapsing
// never advance post_pulse_last_seen). Review items are a to-do list: every
// actionable pending one shows until it is accepted or dismissed (rejected);
// "Mark all as seen" only drops their "new" tag. Flagged notes are a count
// line, not rows. Renders nothing only when the feed and the actionable
// review items are both empty.
//
// Row buttons call the existing PATCH /api/post-pulse/queue/[id] (the same
// acceptQueueItem / rejectQueueItem as the queue page). Accept is irreversible
// and goes through an inline confirm; dismiss is one tap with optimistic
// removal and rollback, plus a 6-second undo toast ({action: 'reopen'}).
// Neither touches post_pulse_last_seen.
//
// Each briefing/digest row has its own "Seen" button: POST
// /api/post-pulse/catchup/item-seen sets post_pulse_seen_at on that item
// (migration 037), optimistic, with the same undo toast (Undo clears it). A
// digest has one flag, so every row it was split into leaves together and it
// counts once. It changes nothing else (read_at, queue, last_seen, audio).
//
// All actionable review rows render, in their own scroll area (ReviewScroll);
// the section header, counts and the flagged line stay outside it.
export function CatchupPanel({ data }: { data: Catchup }) {
  const queue = useQueue()
  const [collapsed, setCollapsed] = useState(data.collapsed)
  const [seenCleared, setSeenCleared] = useState(false)   // after "Mark all as seen"
  const [showOlder, setShowOlder] = useState(false)
  // A summary is only shown for the item set it was made from (itemKey): a
  // row marked seen changes the set, so the summary has to be run again.
  const [summary, setSummary] = useState<{ forKey: string; content: CatchupSummary } | null>(
    data.summary ? { forKey: data.itemKey, content: data.summary } : null,
  )
  const [summaryOpen, setSummaryOpen] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [summarizing, setSummarizing] = useState(false)
  const [summaryError, setSummaryError] = useState<string | null>(null)
  const [addingAll, setAddingAll] = useState(false)
  const router = useRouter()
  const [resolvedIds, setResolvedIds] = useState<Set<string>>(() => new Set())
  const [rowState, setRowState] = useState<Record<string, 'confirm' | 'accepting'>>({})
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({})
  const [toast, setToast] = useState<UndoToast | null>(null)
  // Item keys (`${kind}:${id}`) marked seen here, hidden at once; the next
  // server snapshot (router.refresh) leaves them out by itself.
  const [seenKeys, setSeenKeys] = useState<Set<string>>(() => new Set())
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(
    () => () => {
      if (toastTimer.current) clearTimeout(toastTimer.current)
    },
    [],
  )

  // A fresh snapshot brings its own cached summary (or none) for its item set.
  useEffect(() => {
    if (data.summary) setSummary({ forKey: data.itemKey, content: data.summary })
  }, [data.itemKey, data.summary])

  // Distinct items (a split digest appears under several channels), minus
  // the ones marked seen here, so the header counts move at once.
  const distinct = new Map<string, CatchupEntry>()
  for (const ch of data.channels) for (const e of ch.entries) if (!distinct.has(e.key)) distinct.set(e.key, e)
  const liveItems = [...distinct.values()].filter((e) => !seenKeys.has(e.key))
  // True between a tap and the snapshot that no longer has the item: the
  // estimate and cached summary still describe the old item set.
  const staleSet = [...distinct.keys()].some((k) => seenKeys.has(k))
  const newCount = liveItems.length
  const unreadCount = liveItems.filter((e) => e.unread).length
  const olderCount = liveItems.filter((e) => e.older).length
  const shownSummary = !staleSet && summary?.forKey === data.itemKey ? summary.content : null
  const estimate = staleSet ? null : data.estimate

  const hasFeed = newCount > 0 && !seenCleared
  const reviewItems = data.review.items.filter((i) => !resolvedIds.has(i.id))
  const reviewNew = seenCleared ? 0 : reviewItems.filter((i) => i.isNew).length

  // queue.items, not queue.find(): find reads a ref, so it wouldn't re-render
  // the panel when the queue finishes loading after a full page load.
  const inQueue = (e: CatchupEntry) =>
    queue.items.some((q) => q.kind === e.kind && q.item_id === e.id && !q.played_at)

  // Distinct items in display order (channel order, newest first), visible ones only.
  const displayItems: CatchupEntry[] = []
  const shownKeys = new Set<string>()
  for (const ch of data.channels) {
    for (const e of ch.entries) {
      if ((e.older && !showOlder) || shownKeys.has(e.key) || seenKeys.has(e.key)) continue
      shownKeys.add(e.key)
      displayItems.push(e)
    }
  }
  const toQueue = displayItems.filter((e) => !inQueue(e))

  function toggleCollapsed() {
    const next = !collapsed
    setCollapsed(next)
    void fetch('/api/post-pulse/catchup', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ collapsed: next }),
    }).catch(() => {})
  }

  // through = this render's snapshotAt, so anything that landed after the
  // page rendered stays in the panel next time.
  // Clears the briefings/digests and the review items' "new" tags; the review
  // items themselves stay until they are resolved.
  async function markAllSeen() {
    setSeenCleared(true)
    const res = await fetch('/api/post-pulse/catchup/seen', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ through: data.snapshotAt }),
    }).catch(() => null)
    if (!res?.ok) setSeenCleared(false)
  }

  async function addAll() {
    setAddingAll(true)
    try {
      for (const e of toQueue) {
        await fetch('/api/queue', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ kind: e.kind, itemId: e.id }),
        })
      }
      await queue.refresh()
    } finally {
      setAddingAll(false)
    }
  }

  const setRow = (id: string, v: 'confirm' | 'accepting' | null) =>
    setRowState((prev) => {
      const next = { ...prev }
      if (v) next[id] = v
      else delete next[id]
      return next
    })
  const setRowError = (id: string, msg: string | null) =>
    setRowErrors((prev) => {
      const next = { ...prev }
      if (msg) next[id] = msg
      else delete next[id]
      return next
    })
  const markResolved = (id: string, resolved: boolean) =>
    setResolvedIds((prev) => {
      const next = new Set(prev)
      if (resolved) next.add(id)
      else next.delete(id)
      return next
    })

  async function patchQueue(id: string, action: 'accept' | 'reject' | 'reopen'): Promise<string | null> {
    try {
      const res = await fetch(`/api/post-pulse/queue/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      })
      if (res.ok) return null
      const body = await res.json().catch(() => ({}))
      return body.error ?? `Request failed (${res.status})`
    } catch {
      return 'Network error: nothing was changed'
    }
  }

  // Not optimistic: the row stays (showing "Accepting…") until the server
  // has applied it, then leaves; a 409/422 shows the server's message inline.
  async function acceptItem(id: string) {
    setRow(id, 'accepting')
    setRowError(id, null)
    const err = await patchQueue(id, 'accept')
    if (err) {
      setRow(id, 'confirm')
      setRowError(id, err)
      return
    }
    setRow(id, null)
    markResolved(id, true)
    router.refresh() // sidebar badge + layout dataset
  }

  const showToast = (t: UndoToast | null, ms = UNDO_MS) => {
    if (toastTimer.current) clearTimeout(toastTimer.current)
    setToast(t)
    toastTimer.current = t ? setTimeout(() => setToast(null), ms) : null
  }

  // Optimistic: the row leaves at once (with the undo toast) and comes back
  // with the error if the request fails.
  async function dismissItem(item: CatchupReviewItem) {
    const id = item.id
    setRowError(id, null)
    markResolved(id, true)
    const request = patchQueue(id, 'reject')
    showToast({ kind: 'review', id, title: item.title, label: 'Dismissed', request, status: 'idle', error: null })
    const err = await request
    if (err) {
      markResolved(id, false)
      setRowError(id, `Couldn't dismiss: ${err}`)
      setToast((t) => (t?.id === id ? null : t))
      return
    }
    router.refresh()
  }

  // Undo = reopen (rejected -> pending), or clear post_pulse_seen_at for a
  // briefing/digest. Waits for the original request first, so a fast Undo
  // can't race it.
  async function undoDismiss(t: UndoToast) {
    if (toastTimer.current) clearTimeout(toastTimer.current)
    setToast({ ...t, status: 'undoing' })
    if (await t.request) return // the original request failed: the row is already back
    const err = t.entry ? await postItemSeen(t.entry, false) : await patchQueue(t.id, 'reopen')
    if (err) {
      showToast({ ...t, status: 'error', error: err })
      return
    }
    if (t.entry) markSeen(t.id, false)
    else markResolved(t.id, false)
    showToast(null)
    router.refresh()
  }

  const markSeen = (key: string, seen: boolean) =>
    setSeenKeys((prev) => {
      const next = new Set(prev)
      if (seen) next.add(key)
      else next.delete(key)
      return next
    })

  async function postItemSeen(entry: Pick<CatchupEntry, 'kind' | 'id'>, seen: boolean): Promise<string | null> {
    try {
      const res = await fetch('/api/post-pulse/catchup/item-seen', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: [{ kind: entry.kind, id: entry.id }], seen }),
      })
      if (res.ok) return null
      const body = await res.json().catch(() => ({}))
      return body.error ?? `Request failed (${res.status})`
    } catch {
      return 'Network error: nothing was changed'
    }
  }

  // Optimistic, like the review dismiss: every row of the item leaves at once
  // (a digest's split rows share its key) and they come back with the error
  // if the request fails.
  async function markItemSeen(e: CatchupEntry) {
    setRowError(e.key, null)
    markSeen(e.key, true)
    const request = postItemSeen(e, true)
    showToast({
      kind: 'feed',
      id: e.key,
      entry: { kind: e.kind, id: e.id },
      title: e.headline,
      label: e.kind === 'digest' ? 'Marked whole digest as seen' : 'Marked as seen',
      request,
      status: 'idle',
      error: null,
    })
    const err = await request
    if (err) {
      markSeen(e.key, false)
      setRowError(e.key, `Couldn't mark as seen: ${err}`)
      setToast((t) => (t?.id === e.key ? null : t))
      return
    }
    router.refresh()
  }

  async function runSummary() {
    setSummarizing(true)
    setSummaryError(null)
    try {
      const res = await fetch('/api/post-pulse/catchup/summary', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ until: data.snapshotAt }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error ?? `Summary failed (${res.status})`)
      setSummary({ forKey: json.itemKey as string, content: json.summary as CatchupSummary })
      setSummaryOpen(true)
      setConfirming(false)
    } catch (err) {
      setSummaryError(err instanceof Error ? err.message : String(err))
    } finally {
      setSummarizing(false)
    }
  }

  // New review items are a subset of "awaiting review", so they're shown in
  // parentheses there and never added to the briefing count.
  const headerParts: string[] = []
  if (hasFeed) headerParts.push(`${newCount} new ${data.sinceLabel}${unreadCount ? `, ${unreadCount} unread` : ''}`)
  if (reviewItems.length > 0) {
    headerParts.push(
      `${reviewItems.length} awaiting review` +
        (reviewNew ? ` (${reviewNew} new${hasFeed ? '' : ` ${data.sinceLabel}`})` : ''),
    )
  }
  // Flagged notes are pending too, but not actionable here: stated
  // separately so "awaiting review" means "you can act on these".
  if (data.review.needsResolving > 0 && headerParts.length > 0) headerParts.push(`${data.review.needsResolving} need resolving`)
  const headerLine = headerParts.join(' · ')
  // The count-only lines belong to the briefings: under them when there are
  // any, at the bottom when the panel is only the review queue.
  const footerLines = data.footer.map((l) => (
    <p key={l.key} className="mt-3 font-chrome text-[11px] text-press-muted">
      {l.text} ·{' '}
      <Link href={l.href} className="text-press-accent hover:text-press-ink">
        {l.linkLabel}
      </Link>
    </p>
  ))
  const actionBtn =
    'font-chrome text-[11px] text-press-accent hover:text-press-ink disabled:text-press-faint disabled:cursor-default transition-colors'
  const toastBar = toast && <UndoToastBar toast={toast} onUndo={() => void undoDismiss(toast)} onClose={() => showToast(null)} />

  // Nothing left: the panel goes, but an undo toast stays for its 6 seconds.
  if (!hasFeed && reviewItems.length === 0) return toastBar || null

  return (
    <aside aria-label="While you were away" className="mb-6 p-[14px] sm:p-4 bg-press-accent/[0.06] border-l-2 border-press-accent">
      <button
        type="button"
        onClick={toggleCollapsed}
        aria-expanded={!collapsed}
        className="w-full flex items-center gap-3 text-left"
      >
        <span className="press-label whitespace-nowrap">While you were away</span>
        <span className="flex-1 press-rule-h" />
        <svg
          className={`w-3.5 h-3.5 text-press-muted transition-transform ${collapsed ? '' : 'rotate-180'}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          aria-hidden
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      <p className="mt-2 font-georgia text-[17px] leading-snug text-press-ink">{headerLine}</p>

      {!collapsed && (
        <>
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1">
            {hasFeed && (
              <>
                <button type="button" className={actionBtn} onClick={addAll} disabled={addingAll || toQueue.length === 0}>
                  {addingAll ? 'Adding…' : toQueue.length === 0 ? 'All in queue' : `Add all to queue (${toQueue.length})`}
                </button>
                {shownSummary ? (
                  <button type="button" className={actionBtn} onClick={() => setSummaryOpen((v) => !v)}>
                    {summaryOpen ? 'Hide summary' : 'Show summary'}
                  </button>
                ) : (
                  estimate && (
                    <button type="button" className={actionBtn} onClick={() => setConfirming((v) => !v)} disabled={summarizing}>
                      Summarize
                    </button>
                  )
                )}
              </>
            )}
            {(hasFeed || reviewNew > 0) && (
              <button type="button" className={`${actionBtn} ml-auto`} onClick={markAllSeen}>
                Mark all as seen
              </button>
            )}
          </div>

          {hasFeed && confirming && !shownSummary && estimate && (
            <div className="mt-3 pt-2 border-t-[0.5px] border-press-hair font-chrome text-[11px] text-press-body leading-relaxed">
              One call to {estimate.modelLabel}, low effort, no web search, reading the{' '}
              {estimate.items === newCount ? `${estimate.items}` : `newest ${estimate.items}`} item
              {estimate.items === 1 ? '' : 's'} ({Math.round(estimate.inputChars / 1000)}k characters).
              About {formatCost(estimate.typicalUsd)}, at most {formatCost(estimate.maxUsd)}.
              <span className="ml-3 inline-flex gap-3">
                <button type="button" className={actionBtn} onClick={runSummary} disabled={summarizing}>
                  {summarizing ? 'Summarizing…' : 'Run'}
                </button>
                {!summarizing && (
                  <button type="button" className="font-chrome text-[11px] text-press-muted hover:text-press-ink" onClick={() => setConfirming(false)}>
                    Cancel
                  </button>
                )}
              </span>
              {summaryError && <p className="mt-1 text-press-down">{summaryError}</p>}
            </div>
          )}

          {hasFeed && shownSummary && summaryOpen && (
            <div className="mt-3 pt-2 border-t-[0.5px] border-press-hair">
              <ReactMarkdown remarkPlugins={[remarkGfm]} components={PRESS_MD_COMPONENTS}>
                {shownSummary.content}
              </ReactMarkdown>
              <p className="font-chrome text-[9px] uppercase tracking-[1.5px] text-press-faint">
                Summary · {formatCost(shownSummary.costUsd)}
              </p>
            </div>
          )}

          {hasFeed && (
          <div className="mt-3">
            {data.channels.map((ch) => {
              const entries = ch.entries.filter((e) => (showOlder || !e.older) && !seenKeys.has(e.key))
              if (entries.length === 0) return null
              return (
                <section key={ch.id} className="mt-3 first:mt-0">
                  <div className="flex items-center gap-2">
                    <h3 className="font-chrome text-[10px] uppercase tracking-[1.5px] text-press-muted whitespace-nowrap">{ch.name}</h3>
                    <span className="flex-1 press-rule-h" />
                  </div>
                  <ul>
                    {entries.map((e) => (
                      <CatchupRow
                        key={`${ch.id}:${e.key}`}
                        entry={e}
                        queued={inQueue(e)}
                        onQueue={() => void queue.add(e.kind, e.id)}
                        onSeen={() => void markItemSeen(e)}
                        error={rowErrors[e.key] ?? null}
                      />
                    ))}
                  </ul>
                </section>
              )
            })}
          </div>
          )}

          {hasFeed && olderCount > 0 && (
            <button type="button" className={`${actionBtn} mt-3`} onClick={() => setShowOlder((v) => !v)}>
              {showOlder ? 'Show fewer' : `Show ${olderCount} older`}
            </button>
          )}

          {hasFeed && footerLines}

          {reviewItems.length > 0 && (
            <section className={hasFeed ? 'mt-5' : 'mt-3'} aria-label="Awaiting review">
              <div className="flex items-center gap-2">
                <h3 className="press-label whitespace-nowrap">Awaiting review</h3>
                <span className="flex-1 press-rule-h" />
                <Link href="/post-pulse/queue" className="font-chrome text-[10px] text-press-accent hover:text-press-ink whitespace-nowrap">
                  Review queue →
                </Link>
              </div>
              <ReviewScroll>
                {reviewItems.map((item) => (
                  <ReviewRow
                    key={item.id}
                    item={item}
                    isNew={item.isNew && !seenCleared}
                    state={rowState[item.id] ?? 'idle'}
                    error={rowErrors[item.id] ?? null}
                    onAsk={() => {
                      setRowError(item.id, null)
                      setRow(item.id, 'confirm')
                    }}
                    onCancel={() => {
                      setRowError(item.id, null)
                      setRow(item.id, null)
                    }}
                    onAccept={() => void acceptItem(item.id)}
                    onDismiss={() => void dismissItem(item)}
                  />
                ))}
              </ReviewScroll>
              {data.review.needsResolving > 0 && (
                <p className="mt-2 font-chrome text-[11px] text-press-muted">
                  {data.review.needsResolving} need resolving in chat ·{' '}
                  <Link href="/post-pulse/queue" className="text-press-accent hover:text-press-ink">
                    Review queue
                  </Link>
                </p>
              )}
            </section>
          )}

          {!hasFeed && footerLines}
        </>
      )}
      {toastBar}
    </aside>
  )
}

interface UndoToast {
  kind: 'review' | 'feed'
  id: string                      // review item id, or a feed item's key
  entry?: Pick<CatchupEntry, 'kind' | 'id'> // feed items: what Undo clears
  title: string
  label: string                   // "Dismissed" / "Marked as seen" / "Marked whole digest as seen"
  request: Promise<string | null> // the original request; resolves to an error or null
  status: 'idle' | 'undoing' | 'error'
  error: string | null
}

// Fixed above the mini player (bottom-0, z-40), outside the review scroll
// area so it is never clipped by it.
function UndoToastBar({ toast, onUndo, onClose }: { toast: UndoToast; onUndo: () => void; onClose: () => void }) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed left-1/2 -translate-x-1/2 bottom-24 z-50 w-[calc(100%-32px)] max-w-md flex items-center gap-2 pl-4 pr-1 bg-press-ink text-white shadow-lg"
    >
      <p className="flex-1 min-w-0 py-2.5 font-chrome text-[12px] leading-snug">
        {toast.status === 'error' ? (
          <>Couldn&apos;t undo: {toast.error}</>
        ) : (
          <>
            {toast.label} <span className="block truncate opacity-75">{toast.title}</span>
          </>
        )}
      </p>
      {toast.status !== 'error' && (
        <button
          type="button"
          onClick={onUndo}
          disabled={toast.status === 'undoing'}
          className="h-11 px-3 font-chrome text-[12px] font-semibold uppercase tracking-[1px] text-[#CFC6F0] hover:text-white disabled:opacity-60"
        >
          {toast.status === 'undoing' ? 'Undoing…' : 'Undo'}
        </button>
      )}
      <button
        type="button"
        onClick={onClose}
        aria-label="Close"
        className="h-11 w-11 flex items-center justify-center text-white/60 hover:text-white"
      >
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden>
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.25} d="M6 6l12 12M18 6L6 18" />
        </svg>
      </button>
    </div>
  )
}

// The review rows' own scroll area: ~55vh on phones, 480px on desktop, and
// just the rows' height when they fit. No overscroll-behavior, so scrolling
// past either end moves the page. The bottom fades (a mask, so no colour has
// to match the tinted panel) only while more rows remain below.
function ReviewScroll({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLUListElement>(null)
  const [moreBelow, setMoreBelow] = useState(false)
  const update = useCallback(() => {
    const el = ref.current
    if (el) setMoreBelow(el.scrollHeight - el.scrollTop - el.clientHeight > 2)
  }, [])
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    // Rows removed or a confirm opening change the content height without
    // resizing the box itself.
    const mo = new MutationObserver(update)
    mo.observe(el, { childList: true, subtree: true })
    return () => {
      ro.disconnect()
      mo.disconnect()
    }
  }, [update])
  return (
    <ul
      ref={ref}
      onScroll={update}
      className={`review-scroll max-h-[55vh] md:max-h-[480px] overflow-y-auto pr-1 md:pr-2 ${
        moreBelow ? '[mask-image:linear-gradient(to_bottom,#000_calc(100%-48px),transparent)]' : ''
      }`}
    >
      {children}
    </ul>
  )
}

function CatchupRow({
  entry,
  queued,
  onQueue,
  onSeen,
  error,
}: {
  entry: CatchupEntry
  queued: boolean
  onQueue: () => void
  onSeen: () => void
  error: string | null
}) {
  const isDigest = entry.kind === 'digest'
  const href = `/read/${entry.kind}/${entry.id}?${CATCHUP_FROM_PARAM}`
  return (
    <li className="py-2.5 border-b-[0.5px] border-press-hair last:border-b-0 flex gap-2.5">
      <span className="w-1.5 flex-shrink-0 pt-[7px]" aria-hidden>
        {entry.unread && <span className="block w-1.5 h-1.5 rounded-full bg-press-accent" />}
      </span>
      <div className="flex-1 min-w-0">
        <Link href={href} className="group block">
          <span className={`font-georgia text-[15px] leading-snug group-hover:text-press-accent transition-colors ${entry.unread ? 'text-press-ink' : 'text-press-body'}`}>
            {entry.headline}
          </span>
          {entry.unread && <span className="sr-only"> (unread)</span>}
        </Link>
        <p className="mt-0.5 font-chrome text-[10px] text-press-faint">
          {entry.dateLabel} · {entry.kind === 'digest' ? 'digest' : entry.scheduled ? 'scheduled' : 'on demand'}
        </p>
        {entry.excerpt && <p className="mt-1 font-georgia text-[13px] leading-[1.55] text-press-body">{entry.excerpt}</p>}
        {error && (
          <p role="alert" className="mt-1 font-chrome text-[11px] text-press-down">
            {error}
          </p>
        )}
      </div>
      <div className="flex-shrink-0 pt-0.5 flex flex-col items-end">
        {queued ? (
          <span className="font-chrome text-[10px] text-press-faint">In queue</span>
        ) : (
          <button
            type="button"
            onClick={onQueue}
            className="font-chrome text-[10px] text-press-accent hover:text-press-ink transition-colors"
            aria-label={`Add ${entry.headline} to the listen queue`}
          >
            + Queue
          </button>
        )}
        {/* Outside the row's link, so a tap never navigates. Muted ink, not
            the review queue's green accept. 44px tall; -mr-2 keeps the label
            in line with "+ Queue" above while the target extends past it. */}
        <button
          type="button"
          onClick={onSeen}
          aria-label={`Mark ${entry.headline} as seen${isDigest ? ' (whole digest)' : ''}`}
          title={isDigest ? 'Mark whole digest as seen' : 'Mark as seen'}
          className="mt-1 -mr-2 h-11 px-2 inline-flex items-center gap-1 font-chrome text-[10px] text-press-muted hover:text-press-ink transition-colors"
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden>
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
          {isDigest ? 'Digest seen' : 'Seen'}
        </button>
      </div>
    </li>
  )
}

type ReviewRowState = 'idle' | 'confirm' | 'accepting'

function ReviewRow({
  item,
  isNew,
  state,
  error,
  onAsk,
  onCancel,
  onAccept,
  onDismiss,
}: {
  item: CatchupReviewItem
  isNew: boolean
  state: ReviewRowState
  error: string | null
  onAsk: () => void
  onCancel: () => void
  onAccept: () => void
  onDismiss: () => void
}) {
  // Frontier findings in the accent, as in the queue view.
  const meta: { text: string; className?: string }[] = [
    ...(item.department ? [{ text: item.department }] : []),
    { text: item.sourceLabel, className: item.frontier ? 'text-press-accent' : undefined },
    { text: item.dateLabel },
  ]
  // 44px targets, 12px apart, outside the row's link so a tap never navigates.
  const iconBtn =
    'w-11 h-11 flex items-center justify-center rounded-full border transition-colors disabled:opacity-40 disabled:cursor-default'
  // The confirm opens below the row's text, pushing later rows down; the row
  // itself never moves. If that puts the confirm past the list's bottom edge,
  // scroll the LIST (never the page) just enough to show it.
  const confirmRef = useRef<HTMLDivElement>(null)
  const confirming = state === 'confirm'
  useEffect(() => {
    const box = confirmRef.current
    const list = box?.closest('.review-scroll')
    if (!box || !list) return
    const overflow = box.getBoundingClientRect().bottom - list.getBoundingClientRect().bottom + 8
    if (overflow > 0) list.scrollBy({ top: overflow, behavior: 'smooth' })
  }, [confirming])
  return (
    <li className="py-2.5 border-b-[0.5px] border-press-hair last:border-b-0">
      <div className="flex gap-3">
        <div className="flex-1 min-w-0">
          <Link href={item.href} className="group block">
            <span className="font-georgia text-[15px] leading-snug text-press-ink group-hover:text-press-accent transition-colors">
              {item.title}
            </span>
            {isNew && (
              <span className="ml-2 align-[2px] font-chrome text-[9px] uppercase tracking-[1.5px] text-press-accent">New</span>
            )}
            <span className="block mt-1 font-georgia text-[13px] leading-[1.5] text-press-body">{item.effect}</span>
          </Link>
          <p className="mt-0.5 font-chrome text-[10px] text-press-faint">
            {meta.map((m, i) => (
              <span key={i} className={m.className}>
                {i > 0 ? ' · ' : ''}
                {m.text}
              </span>
            ))}
          </p>
          {item.note && <p className="mt-1 font-georgia text-[12px] leading-[1.5] text-press-muted line-clamp-1">{item.note}</p>}
          {item.blocked && <p className="mt-1 font-chrome text-[11px] text-press-down">{item.blocked}</p>}
        </div>
        {state === 'idle' && (
          <div className="flex-shrink-0 flex items-start gap-3">
            <button
              type="button"
              onClick={onAsk}
              disabled={!!item.blocked}
              aria-label={`Accept ${item.title}`}
              title={item.blocked ?? 'Accept'}
              className={`${iconBtn} border-press-up/40 text-press-up hover:bg-press-up/10`}
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden>
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.25} d="M5 13l4 4L19 7" />
              </svg>
            </button>
            <button
              type="button"
              onClick={onDismiss}
              aria-label={`Dismiss ${item.title}`}
              title="Dismiss"
              className={`${iconBtn} border-press-hair text-press-muted hover:text-press-ink hover:bg-press-ink/5`}
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden>
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.25} d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
          </div>
        )}
      </div>

      {state !== 'idle' && (
        // Accept can't be undone (it writes pp_tools / pp_departments and the
        // permanent pp_changelog), so it is a two-step action.
        <div ref={confirmRef} role="group" aria-label={`Confirm accepting ${item.title}`} className="mt-2 p-2.5 bg-press-up/[0.06] border-l-2 border-press-up">
          <p className="font-chrome text-[11px] text-press-ink">
            Accept? <span className="text-press-body">{item.effect}.</span> This can&apos;t be undone.
          </p>
          {item.warning && <p className="mt-1 font-chrome text-[11px] font-semibold text-press-down">{item.warning}.</p>}
          <div className="mt-2 flex items-center gap-3">
            <button
              type="button"
              onClick={onAccept}
              disabled={state === 'accepting'}
              className="h-11 px-5 rounded-full bg-press-up text-white font-chrome text-[12px] disabled:opacity-60"
            >
              {state === 'accepting' ? 'Accepting…' : 'Accept'}
            </button>
            <button
              type="button"
              onClick={onCancel}
              disabled={state === 'accepting'}
              className="h-11 px-5 rounded-full border border-press-hair text-press-muted hover:text-press-ink font-chrome text-[12px] disabled:opacity-60"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
      {error && (
        <p role="alert" className="mt-1.5 font-chrome text-[11px] text-press-down">
          {error}
        </p>
      )}
    </li>
  )
}
