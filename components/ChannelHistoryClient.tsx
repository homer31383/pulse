'use client'

// Channel history list: briefings and digests of one channel, newest first,
// under month headings. Rows are plain links to the reading view; nothing on
// this page marks anything read, touches the queue, or affects playback.
//
// Two searches: the as-you-type box filters titles and excerpts on the
// client; "Search full text" asks the server (GET .../history-search) on
// Enter or the button, and its results replace the list until cleared. The
// chips and the title box apply to either.

import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import {
  channelFromParam,
  fullTextQueryError,
  HISTORY_SNAPSHOT_KEY,
  HISTORY_SNAPSHOT_TTL_MS,
  normalizeFullTextQuery,
  readerHighlightParams,
  type ChannelHistoryEntry,
  type FullTextHit,
  type FullTextResponse,
} from '@/lib/channel-history-types'

export const HISTORY_PAGE_SIZE = 50

type Filter = 'all' | 'briefing' | 'digest' | 'unread'

const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'briefing', label: 'Briefings' },
  { key: 'digest', label: 'Digests' },
  { key: 'unread', label: 'Unread' },
]

const FILTER_NOUN: Record<Filter, [string, string]> = {
  all: ['entry', 'entries'],
  briefing: ['briefing', 'briefings'],
  digest: ['digest', 'digests'],
  unread: ['unread entry', 'unread entries'],
}

interface Snapshot {
  channelId: string
  filter: Filter
  query: string
  visible: number
  scrollY: number
  at: number
  // Full-text state (absent in snapshots saved before the feature)
  ftInput?: string
  ftQuery?: string | null
  whole?: boolean
}

interface Row {
  entry: ChannelHistoryEntry
  hit?: FullTextHit
}

// ET, like the archive, so server render and client group identically
const monthFmt = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', month: 'long', year: 'numeric' })
const dayFmt = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', year: 'numeric' })

interface Props {
  channelId: string
  channelName: string
  entries: ChannelHistoryEntry[]
}

export function ChannelHistoryClient({ channelId, channelName, entries }: Props) {
  const [filter, setFilter] = useState<Filter>('all')
  const [query, setQuery] = useState('')
  const [visible, setVisible] = useState(HISTORY_PAGE_SIZE)
  const pendingScroll = useRef<number | null>(null)

  // Full-text search
  const [ftInput, setFtInput] = useState('')
  const [whole, setWhole] = useState(false)
  const [ft, setFt] = useState<FullTextResponse | null>(null)
  const [ftLoading, setFtLoading] = useState(false)
  const [ftError, setFtError] = useState<string | null>(null)
  const ftAbort = useRef<AbortController | null>(null)
  // Scroll to restore once the re-run search (after Back) has rendered
  const scrollAfterSearch = useRef<{ y: number; visible: number } | null>(null)

  async function runSearch(raw: string, wholeWord: boolean) {
    const refusal = fullTextQueryError(raw)
    if (refusal) {
      ftAbort.current?.abort()
      setFtLoading(false)
      setFt(null)
      setFtError(refusal)
      return
    }
    const q = normalizeFullTextQuery(raw)
    ftAbort.current?.abort()
    const ctrl = new AbortController()
    ftAbort.current = ctrl
    setFtLoading(true)
    setFtError(null)
    try {
      const res = await fetch(
        `/api/channels/${channelId}/history-search?q=${encodeURIComponent(q)}${wholeWord ? '&whole=1' : ''}`,
        { signal: ctrl.signal, cache: 'no-store' },
      )
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error ?? `Search failed (${res.status})`)
      const restore = scrollAfterSearch.current
      scrollAfterSearch.current = null
      setFt(body as FullTextResponse)
      if (restore) {
        setVisible(Math.max(HISTORY_PAGE_SIZE, restore.visible))
        pendingScroll.current = restore.y
      } else {
        setVisible(HISTORY_PAGE_SIZE)
      }
    } catch (err) {
      if (ctrl.signal.aborted) return
      scrollAfterSearch.current = null
      setFt(null)
      setFtError(err instanceof Error ? err.message : 'Search failed')
    } finally {
      if (ftAbort.current === ctrl) setFtLoading(false)
    }
  }

  function clearFullText() {
    ftAbort.current?.abort()
    setFt(null)
    setFtInput('')
    setFtError(null)
    setFtLoading(false)
    setVisible(HISTORY_PAGE_SIZE)
  }

  // Restore the state saved when a row was opened (consumed once).
  useEffect(() => {
    let snap: Snapshot | null = null
    try {
      const raw = sessionStorage.getItem(HISTORY_SNAPSHOT_KEY)
      if (raw) snap = JSON.parse(raw) as Snapshot
      sessionStorage.removeItem(HISTORY_SNAPSHOT_KEY)
    } catch { /* storage unavailable */ }
    if (!snap || snap.channelId !== channelId || Date.now() - snap.at > HISTORY_SNAPSHOT_TTL_MS) return
    setFilter(snap.filter)
    setQuery(snap.query)
    setFtInput(snap.ftInput ?? '')
    setWhole(!!snap.whole)
    if (snap.ftQuery) {
      // Re-run the search, then put the scroll back once its rows render
      scrollAfterSearch.current = { y: snap.scrollY, visible: snap.visible }
      void runSearch(snap.ftQuery, !!snap.whole)
    } else {
      setVisible(Math.max(HISTORY_PAGE_SIZE, snap.visible))
      pendingScroll.current = snap.scrollY
    }
    // runSearch is stable enough here: it only reads channelId
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channelId])

  // After the restored rows render, put the scroll back. Next's own
  // post-navigation scroll can land after the first frame, so retry briefly.
  useEffect(() => {
    const y = pendingScroll.current
    if (y == null) return
    pendingScroll.current = null
    let tries = 0
    const apply = () => {
      window.scrollTo(0, y)
      if (Math.abs(window.scrollY - y) > 2 && ++tries < 10) setTimeout(apply, 50)
    }
    requestAnimationFrame(apply)
  })

  // The list's base rows: every entry, or the full-text hits joined to their
  // entries (headline, date, read state come from the page's own index).
  const baseRows: Row[] = useMemo(() => {
    if (!ft) return entries.map((entry) => ({ entry }))
    const byKey = new Map(entries.map((e) => [`${e.kind}:${e.id}`, e]))
    const out: Row[] = []
    for (const hit of ft.hits) {
      const entry = byKey.get(`${hit.kind}:${hit.id}`)
      if (entry) out.push({ entry, hit })
    }
    return out
  }, [entries, ft])

  const inChip = (e: ChannelHistoryEntry, f: Filter) =>
    f === 'all' || (f === 'unread' ? !e.read : e.kind === f)

  const counts = useMemo(() => {
    const c = { all: 0, briefing: 0, digest: 0, unread: 0 } as Record<Filter, number>
    for (const r of baseRows) for (const f of FILTERS) if (inChip(r.entry, f.key)) c[f.key]++
    return c
  }, [baseRows])

  const entryCounts = useMemo(() => {
    const c = { all: 0, briefing: 0, digest: 0, unread: 0 } as Record<Filter, number>
    for (const e of entries) for (const f of FILTERS) if (inChip(e, f.key)) c[f.key]++
    return c
  }, [entries])

  const filtered = useMemo(() => {
    const q = query.toLowerCase().trim()
    return baseRows.filter(({ entry: e }) => {
      if (!inChip(e, filter)) return false
      // Title or excerpt (digest rows' excerpt is this channel's story). Date
      // order is kept: ranking title hits first would scramble the months.
      return !q || e.headline.toLowerCase().includes(q) || e.excerpt.toLowerCase().includes(q)
    })
  }, [baseRows, filter, query])

  const shown = filtered.slice(0, visible)
  const months = useMemo(() => {
    const out: { label: string; items: Row[] }[] = []
    for (const r of shown) {
      const label = monthFmt.format(new Date(r.entry.createdAt))
      const last = out[out.length - 1]
      if (last?.label === label) last.items.push(r)
      else out.push({ label, items: [r] })
    }
    return out
  }, [shown])

  function saveSnapshot() {
    const snap: Snapshot = {
      channelId, filter, query, visible, scrollY: window.scrollY, at: Date.now(),
      ftInput, ftQuery: ft?.query ?? null, whole: ft ? ft.whole : whole,
    }
    try { sessionStorage.setItem(HISTORY_SNAPSHOT_KEY, JSON.stringify(snap)) } catch { /* storage unavailable */ }
  }

  if (entries.length === 0) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-20 text-center">
        <p className="font-georgia text-[15px] text-press-ink mb-1">Nothing on file yet</p>
        <p className="font-georgia italic text-press-muted text-sm">
          Briefings and digests for this channel will be listed here.
        </p>
      </div>
    )
  }

  const remaining = filtered.length - shown.length
  const ftSummary = (() => {
    if (!ft) return null
    const n = counts[filter]
    const of = entryCounts[filter]
    const [one, many] = FILTER_NOUN[filter]
    return `${n} of ${of} ${of === 1 ? one : many} ${n === 1 ? 'mentions' : 'mention'} “${ft.query}”${ft.whole ? ' as a whole word' : ''}`
  })()

  return (
    <main className="max-w-2xl mx-auto px-4 pt-4 pb-[calc(2.5rem+var(--mini-player-h,0px))]">
      {/* Filter chips */}
      <div className="flex flex-wrap gap-x-1 gap-y-1 mb-2" role="group" aria-label="Filter entries">
        {FILTERS.map((f) => {
          const active = filter === f.key
          return (
            <button
              key={f.key}
              type="button"
              aria-pressed={active}
              onClick={() => { setFilter(f.key); setVisible(HISTORY_PAGE_SIZE) }}
              className={[
                'h-11 min-w-[44px] px-2 font-chrome text-[10px] uppercase tracking-[1.2px] transition-colors border-b-2',
                active ? 'text-press-accent border-press-accent' : 'text-press-muted border-transparent hover:text-press-ink',
              ].join(' ')}
            >
              {f.label} <span className={active ? 'text-press-accent/70' : 'text-press-faint'}>{counts[f.key]}</span>
            </button>
          )
        })}
      </div>

      {/* Title search */}
      <div className="relative mb-2">
        <svg
          className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-press-faint pointer-events-none"
          fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
        <input
          type="search"
          value={query}
          onChange={(e) => { setQuery(e.target.value); setVisible(HISTORY_PAGE_SIZE) }}
          placeholder="Search titles and excerpts…"
          aria-label="Search titles and excerpts"
          className="w-full h-11 bg-white/40 border-[0.5px] border-press-hair rounded-none pl-10 pr-4 font-chrome text-press-ink placeholder-press-faint focus:outline-none focus:border-press-accent/50 text-sm transition-colors"
        />
      </div>

      {/* Full-text search: sent on Enter or the button, never per keystroke */}
      <form
        role="search"
        aria-label="Search full text"
        className="mb-1"
        onSubmit={(e) => { e.preventDefault(); void runSearch(ftInput, whole) }}
      >
        <div className="flex gap-2">
          <input
            type="search"
            value={ftInput}
            onChange={(e) => setFtInput(e.target.value)}
            maxLength={200}
            placeholder="Search full text…"
            aria-label="Search full text"
            className="flex-1 min-w-0 h-11 bg-white/40 border-[0.5px] border-press-hair rounded-none px-3 font-chrome text-press-ink placeholder-press-faint focus:outline-none focus:border-press-accent/50 text-sm transition-colors"
          />
          <button
            type="submit"
            disabled={ftLoading}
            className="h-11 px-4 flex-shrink-0 font-chrome text-[10px] uppercase tracking-[1.5px] text-white bg-press-accent hover:bg-press-ink disabled:opacity-60 transition-colors"
          >
            {ftLoading ? 'Searching' : 'Search'}
          </button>
        </div>
        <div className="flex items-center gap-1 mt-1">
          <button
            type="button"
            aria-pressed={whole}
            onClick={() => {
              const next = !whole
              setWhole(next)
              if (ft) void runSearch(ft.query, next)
            }}
            className="h-11 -ml-1 px-1 flex items-center gap-2 font-chrome text-[11px] text-press-muted hover:text-press-ink"
          >
            <span
              aria-hidden
              className={[
                'w-4 h-4 border flex items-center justify-center transition-colors',
                whole ? 'bg-press-accent border-press-accent' : 'border-press-faint bg-white/40',
              ].join(' ')}
            >
              {whole && (
                <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                </svg>
              )}
            </span>
            Whole word
          </button>
          {(ft || ftError) && (
            <button
              type="button"
              onClick={clearFullText}
              className="ml-auto h-11 px-2 font-chrome text-[10px] uppercase tracking-[1.5px] text-press-accent hover:text-press-ink"
            >
              Clear full-text search
            </button>
          )}
        </div>
      </form>

      <div aria-live="polite" className="mb-3 min-h-[1px]">
        {ftError && <p className="font-chrome text-[12px] text-press-down">{ftError}</p>}
        {ft && ftSummary && (
          <p className="font-chrome text-[12px] text-press-body">
            {ftSummary}
            {ft.capped && (
              <span className="block text-press-muted">
                Showing the newest {ft.hits.length} of {ft.total} matching entries. Narrow the search to reach older ones.
              </span>
            )}
          </p>
        )}
      </div>

      {filtered.length === 0 && (
        <p className="text-center font-georgia italic text-press-muted text-sm py-8">
          {ft && baseRows.length === 0 ? (
            <>
              No entry in this channel mentions &ldquo;{ft.query}&rdquo;{ft.whole ? ' as a whole word. Try again with Whole word off.' : '.'}
            </>
          ) : query.trim() ? (
            <>Nothing matches &ldquo;{query.trim()}&rdquo;</>
          ) : (
            'Nothing here.'
          )}
        </p>
      )}

      {months.map((m) => (
        <section key={m.label} className="mb-2">
          <h2 className="pt-5 pb-1.5 flex items-center gap-3">
            <span className="press-label">{m.label}</span>
            <span className="flex-1 press-rule-h" />
          </h2>
          <ul>
            {m.items.map(({ entry: e, hit }) => {
              const href = hit && ft
                ? `/read/${e.kind}/${e.id}?${channelFromParam(channelId)}&${readerHighlightParams(
                    ft.query,
                    ft.whole,
                    e.kind === 'digest' && hit.scope === 'story' && e.coversChannels > 1 ? channelName : null,
                  )}`
                : `/read/${e.kind}/${e.id}?${channelFromParam(channelId)}`
              return (
                <li key={`${e.kind}:${e.id}`} className="border-b-[0.5px] border-press-hair">
                  <Link
                    href={href}
                    onClick={saveSnapshot}
                    className="block px-1 py-3.5 min-h-[44px] hover:bg-white/30 transition-colors"
                  >
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      {!e.read
                        ? <span className="w-1.5 h-1.5 rounded-full bg-press-accent flex-shrink-0" aria-label="Unread" />
                        : <span className="sr-only">Read</span>}
                      <span className="font-chrome text-[10px] uppercase tracking-[1px] text-press-muted">
                        {dayFmt.format(new Date(e.createdAt))}
                      </span>
                      <span className="font-chrome text-[9px] uppercase tracking-[1.5px] text-press-accent">
                        {e.kind === 'briefing' ? 'Briefing' : 'Digest'}
                      </span>
                      {e.kind === 'digest' && e.coversChannels > 1 && (
                        <span className="font-chrome text-[10px] text-press-faint">· covers {e.coversChannels} channels</span>
                      )}
                      {hit?.scope === 'whole' && (
                        <span
                          className="font-chrome text-[9px] uppercase tracking-[1.2px] text-press-muted border-[0.5px] border-press-hair px-1"
                          title="This channel's story could not be found in the digest, so the whole digest was searched"
                        >
                          whole digest
                        </span>
                      )}
                      {hit && hit.matches > 1 && (
                        <span className="font-chrome text-[10px] text-press-muted">· {hit.matches} matches</span>
                      )}
                    </div>
                    <p className={`font-georgia text-[16px] leading-snug break-words ${e.read ? 'text-press-body' : 'text-press-ink'}`}>
                      {e.headline}
                    </p>
                    {hit ? (
                      <p className="font-georgia text-[13px] leading-[1.6] text-press-muted mt-1 break-words">
                        {hit.snippet.lead && '…'}
                        {hit.snippet.before}
                        <mark className="bg-press-accent/20 text-press-ink rounded-[2px] px-[1px]">{hit.snippet.match}</mark>
                        {hit.snippet.after}
                        {hit.snippet.trail && '…'}
                      </p>
                    ) : (
                      e.excerpt && (
                        <p className="font-georgia text-[13px] leading-[1.6] text-press-muted mt-1 line-clamp-2 break-words">
                          {e.excerpt}
                        </p>
                      )
                    )}
                  </Link>
                </li>
              )
            })}
          </ul>
        </section>
      ))}

      {remaining > 0 && (
        <div className="pt-5 text-center">
          <button
            type="button"
            onClick={() => setVisible((v) => v + HISTORY_PAGE_SIZE)}
            className="h-11 px-5 font-chrome text-[10px] uppercase tracking-[1.5px] text-press-accent border-[0.5px] border-press-accent/50 hover:bg-press-accent/10 transition-colors"
          >
            Show {Math.min(HISTORY_PAGE_SIZE, remaining)} more · {remaining} left
          </button>
        </div>
      )}
    </main>
  )
}
