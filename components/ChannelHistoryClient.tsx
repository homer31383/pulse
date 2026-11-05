'use client'

// Channel history list: briefings and digests of one channel, newest first,
// under month headings. Rows are plain links to the reading view; nothing on
// this page marks anything read, touches the queue, or affects playback.

import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import {
  channelFromParam,
  HISTORY_SNAPSHOT_KEY,
  HISTORY_SNAPSHOT_TTL_MS,
  type ChannelHistoryEntry,
} from '@/lib/channel-history-types'

export const HISTORY_PAGE_SIZE = 50

type Filter = 'all' | 'briefing' | 'digest' | 'unread'

const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'briefing', label: 'Briefings' },
  { key: 'digest', label: 'Digests' },
  { key: 'unread', label: 'Unread' },
]

interface Snapshot {
  channelId: string
  filter: Filter
  query: string
  visible: number
  scrollY: number
  at: number
}

// ET, like the archive, so server render and client group identically
const monthFmt = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', month: 'long', year: 'numeric' })
const dayFmt = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', year: 'numeric' })

interface Props {
  channelId: string
  entries: ChannelHistoryEntry[]
}

export function ChannelHistoryClient({ channelId, entries }: Props) {
  const [filter, setFilter] = useState<Filter>('all')
  const [query, setQuery] = useState('')
  const [visible, setVisible] = useState(HISTORY_PAGE_SIZE)
  const pendingScroll = useRef<number | null>(null)

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
    setVisible(Math.max(HISTORY_PAGE_SIZE, snap.visible))
    pendingScroll.current = snap.scrollY
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

  const counts = useMemo(() => ({
    all: entries.length,
    briefing: entries.filter((e) => e.kind === 'briefing').length,
    digest: entries.filter((e) => e.kind === 'digest').length,
    unread: entries.filter((e) => !e.read).length,
  }), [entries])

  const filtered = useMemo(() => {
    const q = query.toLowerCase().trim()
    return entries.filter((e) => {
      if (filter === 'briefing' && e.kind !== 'briefing') return false
      if (filter === 'digest' && e.kind !== 'digest') return false
      if (filter === 'unread' && e.read) return false
      // Title or excerpt (digest rows' excerpt is this channel's story). Date
      // order is kept: ranking title hits first would scramble the months.
      return !q || e.headline.toLowerCase().includes(q) || e.excerpt.toLowerCase().includes(q)
    })
  }, [entries, filter, query])

  const shown = filtered.slice(0, visible)
  const months = useMemo(() => {
    const out: { label: string; items: ChannelHistoryEntry[] }[] = []
    for (const e of shown) {
      const label = monthFmt.format(new Date(e.createdAt))
      const last = out[out.length - 1]
      if (last?.label === label) last.items.push(e)
      else out.push({ label, items: [e] })
    }
    return out
  }, [shown])

  function saveSnapshot() {
    const snap: Snapshot = { channelId, filter, query, visible, scrollY: window.scrollY, at: Date.now() }
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
      <div className="relative mb-4">
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

      {filtered.length === 0 && (
        <p className="text-center font-georgia italic text-press-muted text-sm py-8">
          {query.trim() ? <>Nothing matches &ldquo;{query.trim()}&rdquo;</> : 'Nothing here.'}
        </p>
      )}

      {months.map((m) => (
        <section key={m.label} className="mb-2">
          <h2 className="pt-5 pb-1.5 flex items-center gap-3">
            <span className="press-label">{m.label}</span>
            <span className="flex-1 press-rule-h" />
          </h2>
          <ul>
            {m.items.map((e) => (
              <li key={`${e.kind}:${e.id}`} className="border-b-[0.5px] border-press-hair">
                <Link
                  href={`/read/${e.kind}/${e.id}?${channelFromParam(channelId)}`}
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
                  </div>
                  <p className={`font-georgia text-[16px] leading-snug break-words ${e.read ? 'text-press-body' : 'text-press-ink'}`}>
                    {e.headline}
                  </p>
                  {e.excerpt && (
                    <p className="font-georgia text-[13px] leading-[1.6] text-press-muted mt-1 line-clamp-2 break-words">
                      {e.excerpt}
                    </p>
                  )}
                </Link>
              </li>
            ))}
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
