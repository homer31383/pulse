'use client'

import { useState, useMemo } from 'react'
import { PressArticle } from './press/PressArticle'
import type { Briefing } from '@/lib/types'

interface Props {
  briefings: (Briefing & { channel_name?: string })[]
  channelName?: string
}

function formatDate(iso: string) {
  const d = new Date(iso)
  return d.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function stripMarkdown(text: string): string {
  return text
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\*\*[\s\S]+?\*\*/g, (m) => m.slice(2, -2))
    .replace(/\*[\s\S]+?\*/g, (m) => m.slice(1, -1))
    .replace(/\[(.+?)\]\(.+?\)/g, '$1')
    .replace(/`+/g, '')
    .replace(/^[-*+]\s+/gm, '')
    .replace(/^\d+\.\s+/gm, '')
    .replace(/\n+/g, ' ')
    .trim()
}

export function BriefingHistoryClient({ briefings, channelName }: Props) {
  const [search, setSearch] = useState('')
  const [expandedId, setExpandedId] = useState<string | null>(null)
  // Optimistic overlay of ids marked read this session
  const [localReadIds, setLocalReadIds] = useState<Set<string>>(new Set())

  const isUnread = (b: Briefing) => !b.read_at && !localReadIds.has(b.id)

  function markRead(briefing: Briefing) {
    if (!isUnread(briefing)) return
    setLocalReadIds((prev) => new Set([...prev, briefing.id]))
    fetch('/api/read', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ briefingIds: [briefing.id] }),
    }).catch(() => {})
  }

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim()
    if (!q) return briefings
    return briefings.filter((b) => b.content.toLowerCase().includes(q))
  }, [briefings, search])

  if (briefings.length === 0) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-20 text-center">
        <svg className="w-7 h-7 text-press-pin mx-auto mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
            d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
        </svg>
        <p className="font-georgia text-[15px] text-press-ink mb-1">No briefings yet</p>
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

      {/* No results */}
      {filtered.length === 0 && (
        <p className="text-center font-georgia italic text-press-muted text-sm py-8">
          No briefings match &ldquo;{search}&rdquo;
        </p>
      )}
      {filtered.length > 0 && <div className="press-rule-h" />}

      {/* Briefing cards */}
      {filtered.map((briefing) => {
        const isExpanded = expandedId === briefing.id
        const unread = isUnread(briefing)
        const preview = stripMarkdown(briefing.content).slice(0, 220)

        return (
          <div
            key={briefing.id}
            className="border-b-[0.5px] border-press-hair"
          >
            {/* Entry header — always visible, click to expand */}
            <button
              onClick={() => {
                setExpandedId(isExpanded ? null : briefing.id)
                if (!isExpanded) markRead(briefing)
              }}
              className="w-full text-left px-1 py-4 flex items-start gap-3 hover:bg-white/30 transition-colors"
            >
              {/* Expand icon */}
              <span className="flex-shrink-0 mt-0.5">
                <svg
                  className={`w-4 h-4 text-press-pin transition-transform duration-200 ${isExpanded ? 'rotate-90' : ''}`}
                  fill="none" viewBox="0 0 24 24" stroke="currentColor"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </span>

              <div className="flex-1 min-w-0">
                {/* Meta row */}
                <div className="flex items-center gap-2.5 flex-wrap mb-1.5">
                  {unread && (
                    <span className="w-1.5 h-1.5 rounded-full bg-press-accent flex-shrink-0" aria-label="Unread" />
                  )}
                  {briefing.channel_name && (
                    <span className="press-label">
                      {briefing.channel_name}
                    </span>
                  )}
                  <span className="font-chrome text-[10px] uppercase tracking-[1px] text-press-muted">
                    {formatDate(briefing.created_at)}
                  </span>
                  {briefing.sources.length > 0 && (
                    <span className="font-chrome text-[10px] text-press-faint">
                      · {briefing.sources.length} source{briefing.sources.length !== 1 ? 's' : ''}
                    </span>
                  )}
                  <span className="font-chrome text-[9px] uppercase tracking-[1px] text-press-faint">
                    {briefing.model}
                  </span>
                </div>

                {/* Preview text — hidden when expanded */}
                {!isExpanded && (
                  <p className={`font-georgia text-[13px] leading-[1.65] line-clamp-3 ${unread ? 'text-press-ink' : 'text-press-body'}`}>
                    {preview}
                    {briefing.content.length > 220 ? '…' : ''}
                  </p>
                )}
              </div>
            </button>

            {/* Expanded content */}
            {isExpanded && (
              <div className="border-t-[0.5px] border-press-hair">
                {/* Article body */}
                <div className="px-1 py-5">
                  <PressArticle
                    content={briefing.content}
                    channelName={briefing.channel_name ?? channelName ?? null}
                    sourceDate={briefing.created_at}
                  />
                </div>

                {/* Sources */}
                {briefing.sources.length > 0 && (
                  <div className="px-1 pb-5 border-t-[0.5px] border-press-hair pt-3 font-chrome text-[10px] text-press-faint leading-relaxed">
                    <span className="uppercase tracking-[1.5px] mr-1.5">Sources</span>
                    {briefing.sources.slice(0, 8).map((src, i) => (
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
                    {briefing.sources.length > 8 && ` · +${briefing.sources.length - 8} more`}
                    {` — ${briefing.sources.length} source${briefing.sources.length !== 1 ? 's' : ''} accessed`}
                  </div>
                )}
              </div>
            )}
          </div>
        )
      })}
    </main>
  )
}
