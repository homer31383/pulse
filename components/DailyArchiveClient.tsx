'use client'

import { useState, useMemo, useEffect } from 'react'
import { PressArticle } from './press/PressArticle'
import type { Briefing, Digest, Source } from '@/lib/types'

// Day boundaries follow Eastern Time (matches the scheduler) so SSR and the
// browser group identically — grouping by browser-local time would hydrate
// differently on a UTC server.
const TZ = 'America/New_York'

interface Props {
  briefings: (Briefing & { channel_name?: string })[]
  digests: Digest[]
  // Channel ids in home-screen position order — the edition's section order
  channelOrder?: string[]
}

interface ArchiveEntry {
  kind: 'briefing' | 'digest'
  id: string        // prefixed for React keys ('briefing-…' / 'digest-…')
  sourceId: string  // raw DB id, used for read-marking
  channelId: string | null
  title: string // channel name, or 'Morning Digest'
  subtitle: string | null // digest: covered channels
  content: string
  sources: Source[]
  model: string
  created_at: string
  readAt: string | null
}

interface DayGroup {
  key: string // YYYY-MM-DD in ET
  label: string // e.g. "Tuesday, July 28, 2026"
  briefingCount: number
  digestCount: number
  entries: ArchiveEntry[]
}

function dayKey(iso: string) {
  return new Date(iso).toLocaleDateString('en-CA', { timeZone: TZ })
}

function dayLabel(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    timeZone: TZ,
  })
}

function timeLabel(iso: string) {
  return new Date(iso).toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: TZ,
  })
}

function countsLabel(day: DayGroup) {
  const parts: string[] = []
  if (day.briefingCount > 0) parts.push(`${day.briefingCount} briefing${day.briefingCount !== 1 ? 's' : ''}`)
  if (day.digestCount > 0) parts.push(`${day.digestCount} digest${day.digestCount !== 1 ? 's' : ''}`)
  return parts.join(', ')
}

function SourcesFooter({ sources }: { sources: Source[] }) {
  if (sources.length === 0) return null
  return (
    <div className="pb-2 pt-3 border-t-[0.5px] border-press-hair font-chrome text-[10px] text-press-faint leading-relaxed">
      <span className="uppercase tracking-[1.5px] mr-1.5">Sources</span>
      {sources.slice(0, 8).map((src, i) => (
        <span key={i}>
          {i > 0 && ' · '}
          <a
            href={src.url}
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-press-accent transition-colors"
            onClick={(e) => e.stopPropagation()}
          >
            {src.title || src.url}
          </a>
        </span>
      ))}
      {sources.length > 8 && ` · +${sources.length - 8} more`}
    </div>
  )
}

// ── Full-screen daily edition: the day's complete newspaper ─────────────────
function DailyEditionView({ day, onClose }: { day: DayGroup; onClose: () => void }) {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})

  // Lock the page behind the overlay
  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [])

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto paper-page">
      <header className="sticky top-0 z-10 bg-[#F0ECF4]/95 backdrop-blur-sm border-b-[0.5px] border-press-hair px-4 py-3">
        <div className="max-w-2xl mx-auto flex items-center gap-3">
          <button
            onClick={onClose}
            aria-label="Close"
            className="p-1.5 rounded-lg text-press-muted hover:text-press-ink hover:bg-press-accent/10 transition-colors flex-shrink-0"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <div className="flex-1 min-w-0">
            <h1 className="font-georgia text-[20px] font-normal tracking-[-0.3px] text-press-ink">The Daily Edition</h1>
            <p className="font-chrome text-[9px] uppercase tracking-[2px] text-press-muted">
              {day.label} · {countsLabel(day)}
            </p>
          </div>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 pt-2 pb-16">
        {day.entries.map((entry) => {
          const isCollapsed = collapsed[entry.id]
          return (
            <section key={entry.id}>
              {/* Section divider between pieces — the newspaper section break */}
              <div className="flex items-center gap-3 mt-8 mb-1">
                <div className="flex-1 border-t-[3px] border-double border-press-hair" />
                <button
                  onClick={() => setCollapsed((prev) => ({ ...prev, [entry.id]: !prev[entry.id] }))}
                  className="flex items-center gap-1.5 press-label hover:text-press-accent transition-colors"
                  aria-expanded={!isCollapsed}
                >
                  {entry.title}
                  <svg
                    className={`w-3 h-3 transition-transform duration-200 ${isCollapsed ? '' : 'rotate-180'}`}
                    fill="none" viewBox="0 0 24 24" stroke="currentColor"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
                <div className="flex-1 border-t-[3px] border-double border-press-hair" />
              </div>
              <p className="font-chrome text-[9px] uppercase tracking-[1.5px] text-press-faint text-center mb-2 truncate">
                {entry.subtitle ? `${entry.subtitle} · ` : ''}{timeLabel(entry.created_at)}
              </p>

              {isCollapsed ? (
                <p className="font-georgia italic text-press-muted text-[12px] text-center mb-2">
                  Section collapsed
                </p>
              ) : (
                <>
                  <PressArticle
                    content={entry.content}
                    channelName={entry.title}
                    sourceDate={entry.created_at}
                  />
                  <SourcesFooter sources={entry.sources} />
                </>
              )}
            </section>
          )
        })}

        <p className="font-chrome text-[9px] uppercase tracking-[2px] text-press-faint text-center mt-10">
          End of edition
        </p>
      </main>
    </div>
  )
}

// ── Day list: one row per day, tap to open the edition ──────────────────────
export function DailyArchiveClient({ briefings, digests, channelOrder = [] }: Props) {
  const [search, setSearch] = useState('')
  const [readingDay, setReadingDay] = useState<string | null>(null)
  // Optimistic overlay of sourceIds marked read this session (DB write is async)
  const [localReadIds, setLocalReadIds] = useState<Set<string>>(new Set())

  const entryUnread = (e: ArchiveEntry) => !e.readAt && !localReadIds.has(e.sourceId)

  function markEntriesRead(entries: ArchiveEntry[]) {
    const unread = entries.filter(entryUnread)
    if (unread.length === 0) return
    setLocalReadIds((prev) => new Set([...prev, ...unread.map((e) => e.sourceId)]))
    fetch('/api/read', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        briefingIds: unread.filter((e) => e.kind === 'briefing').map((e) => e.sourceId),
        digestIds: unread.filter((e) => e.kind === 'digest').map((e) => e.sourceId),
      }),
    }).catch(() => {})
  }

  const days = useMemo<DayGroup[]>(() => {
    const entries: ArchiveEntry[] = [
      ...digests.map<ArchiveEntry>((d) => ({
        kind: 'digest',
        id: `digest-${d.id}`,
        sourceId: d.id,
        channelId: null,
        title: 'Morning Digest',
        subtitle: d.channel_names.length > 0 ? d.channel_names.join(' · ') : null,
        content: d.content,
        sources: d.sources ?? [],
        model: d.model,
        created_at: d.created_at,
        readAt: d.read_at ?? null,
      })),
      ...briefings.map<ArchiveEntry>((b) => ({
        kind: 'briefing',
        id: `briefing-${b.id}`,
        sourceId: b.id,
        channelId: b.channel_id,
        title: b.channel_name ?? 'Briefing',
        subtitle: null,
        content: b.content,
        sources: b.sources ?? [],
        model: b.model,
        created_at: b.created_at,
        readAt: b.read_at ?? null,
      })),
    ]

    const q = search.toLowerCase().trim()
    const filtered = q
      ? entries.filter((e) => e.content.toLowerCase().includes(q) || e.title.toLowerCase().includes(q))
      : entries

    const byDay = new Map<string, DayGroup>()
    for (const entry of filtered) {
      const key = dayKey(entry.created_at)
      let day = byDay.get(key)
      if (!day) {
        day = { key, label: dayLabel(entry.created_at), briefingCount: 0, digestCount: 0, entries: [] }
        byDay.set(key, day)
      }
      day.entries.push(entry)
      if (entry.kind === 'digest') day.digestCount++
      else day.briefingCount++
    }

    // Edition order: digest(s) lead (the front page), then briefings in
    // home-screen channel-position order — a fixed section sequence, since
    // parallel cron generation makes creation timestamps arbitrary. Multiple
    // same-channel items read chronologically within their section.
    const positionOf = new Map(channelOrder.map((id, i) => [id, i]))
    for (const day of byDay.values()) {
      day.entries.sort((a, b) => {
        if (a.kind !== b.kind) return a.kind === 'digest' ? -1 : 1
        if (a.kind === 'digest') return a.created_at.localeCompare(b.created_at)
        const pa = positionOf.get(a.channelId ?? '') ?? Number.MAX_SAFE_INTEGER
        const pb = positionOf.get(b.channelId ?? '') ?? Number.MAX_SAFE_INTEGER
        if (pa !== pb) return pa - pb
        return a.created_at.localeCompare(b.created_at)
      })
    }

    return [...byDay.values()].sort((a, b) => b.key.localeCompare(a.key))
  }, [briefings, digests, search, channelOrder])

  const readingDayGroup = days.find((d) => d.key === readingDay) ?? null

  if (briefings.length === 0 && digests.length === 0) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-20 text-center">
        <svg className="w-7 h-7 text-press-pin mx-auto mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
            d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
        </svg>
        <p className="font-georgia text-[15px] text-press-ink mb-1">Nothing on file yet</p>
        <p className="font-georgia italic text-press-muted text-sm">
          Generate a briefing from the home screen to see it here.
        </p>
      </div>
    )
  }

  return (
    <main className="max-w-2xl mx-auto px-4 pt-5 pb-10">
      {/* Search */}
      <div className="relative mb-5">
        <svg
          className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-press-faint pointer-events-none"
          fill="none" viewBox="0 0 24 24" stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
            d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search the archive…"
          className="w-full bg-white/40 border-[0.5px] border-press-hair rounded-none pl-10 pr-4 py-2.5 font-chrome text-press-ink placeholder-press-faint focus:outline-none focus:border-press-accent/50 text-sm transition-colors"
        />
      </div>

      {days.length === 0 && (
        <p className="text-center font-georgia italic text-press-muted text-sm py-8">
          Nothing matches &ldquo;{search}&rdquo;
        </p>
      )}
      {days.length > 0 && <div className="press-rule-h" />}

      {/* Day rows — tap to open that day's edition */}
      {days.map((day) => {
        const dayUnread = day.entries.filter(entryUnread).length
        return (
          <button
            key={day.key}
            onClick={() => { setReadingDay(day.key); markEntriesRead(day.entries) }}
            className="w-full text-left border-b-[0.5px] border-press-hair px-1 py-4 flex items-center gap-3 hover:bg-white/30 transition-colors"
          >
            {dayUnread > 0 && (
              <span className="w-1.5 h-1.5 rounded-full bg-press-accent flex-shrink-0" aria-label="Unread" />
            )}
            <span className="flex-1 min-w-0">
              <span className={`block font-georgia text-[16px] leading-snug ${dayUnread > 0 ? 'text-press-ink' : 'text-press-body'}`}>
                {day.label}
              </span>
              <span className="block font-chrome text-[10px] uppercase tracking-[1px] text-press-muted mt-0.5">
                {countsLabel(day)}
                {dayUnread > 0 && (
                  <span className="text-press-accent font-semibold"> · {dayUnread} unread</span>
                )}
              </span>
            </span>
            <svg className="flex-shrink-0 w-4 h-4 text-press-pin" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </button>
        )
      })}

      {/* The day's edition */}
      {readingDayGroup && (
        <DailyEditionView day={readingDayGroup} onClose={() => setReadingDay(null)} />
      )}
    </main>
  )
}
