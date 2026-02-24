'use client'

import { useState, useMemo } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { Briefing } from '@/lib/types'

interface Props {
  briefings: Briefing[]
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

export function BriefingHistoryClient({ briefings }: Props) {
  const [search, setSearch] = useState('')
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim()
    if (!q) return briefings
    return briefings.filter((b) => b.content.toLowerCase().includes(q))
  }, [briefings, search])

  if (briefings.length === 0) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-20 text-center">
        <div className="w-14 h-14 bg-cream-300 rounded-2xl flex items-center justify-center mx-auto mb-4">
          <svg className="w-7 h-7 text-ink-50" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
              d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
        </div>
        <p className="text-ink-300 font-medium mb-1">No briefings yet</p>
        <p className="text-ink-100 text-sm">
          Generate a briefing from the home screen to see it here.
        </p>
      </div>
    )
  }

  return (
    <main className="max-w-2xl mx-auto px-4 pt-5 pb-10 space-y-4">
      {/* Search */}
      <div className="relative">
        <svg
          className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-50 pointer-events-none"
          fill="none" viewBox="0 0 24 24" stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
            d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search briefings…"
          className="w-full bg-cream-100 border border-cream-300 rounded-xl pl-10 pr-4 py-2.5 text-ink-300 placeholder-ink-50 focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-500/50 text-sm transition-colors"
        />
      </div>

      {/* No results */}
      {filtered.length === 0 && (
        <p className="text-center text-ink-50 text-sm py-8">
          No briefings match &ldquo;{search}&rdquo;
        </p>
      )}

      {/* Briefing cards */}
      {filtered.map((briefing) => {
        const isExpanded = expandedId === briefing.id
        const preview = stripMarkdown(briefing.content).slice(0, 220)

        return (
          <div
            key={briefing.id}
            className="bg-cream-50 border border-cream-300/60 rounded-2xl overflow-hidden shadow-[0_1px_4px_rgba(0,0,0,0.06)]"
          >
            {/* Card header — always visible, click to expand */}
            <button
              onClick={() => setExpandedId(isExpanded ? null : briefing.id)}
              className="w-full text-left px-4 py-4 flex items-start gap-3 hover:bg-cream-100 transition-colors"
            >
              {/* Expand icon */}
              <span className="flex-shrink-0 mt-0.5">
                <svg
                  className={`w-4 h-4 text-ink-50 transition-transform duration-200 ${isExpanded ? 'rotate-90' : ''}`}
                  fill="none" viewBox="0 0 24 24" stroke="currentColor"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </span>

              <div className="flex-1 min-w-0">
                {/* Meta row */}
                <div className="flex items-center gap-2 flex-wrap mb-1.5">
                  <span className="text-xs font-medium text-ink-200">
                    {formatDate(briefing.created_at)}
                  </span>
                  {briefing.sources.length > 0 && (
                    <span className="text-xs text-ink-50">
                      · {briefing.sources.length} source{briefing.sources.length !== 1 ? 's' : ''}
                    </span>
                  )}
                  <span className="text-xs text-ink-50 font-mono bg-cream-200 px-1.5 py-0.5 rounded">
                    {briefing.model}
                  </span>
                </div>

                {/* Preview text — hidden when expanded */}
                {!isExpanded && (
                  <p className="text-sm text-ink-100 leading-relaxed line-clamp-3">
                    {preview}
                    {briefing.content.length > 220 ? '…' : ''}
                  </p>
                )}
              </div>
            </button>

            {/* Expanded content */}
            {isExpanded && (
              <div className="border-t border-cream-300/60">
                {/* Markdown body */}
                <div className="px-5 py-5 font-serif prose prose-sm max-w-none prose-headings:font-semibold prose-headings:font-sans prose-headings:text-ink-300 prose-p:text-ink-200 prose-p:leading-relaxed prose-li:text-ink-200 prose-strong:text-ink-300 prose-a:text-brand-600 prose-a:no-underline hover:prose-a:underline prose-hr:border-cream-300 prose-code:text-brand-700 prose-code:bg-cream-200 prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded prose-blockquote:border-brand-500/50 prose-blockquote:text-ink-100">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>
                    {briefing.content}
                  </ReactMarkdown>
                </div>

                {/* Sources */}
                {briefing.sources.length > 0 && (
                  <div className="px-5 pb-5 border-t border-cream-300/40 pt-4">
                    <p className="text-xs font-semibold text-ink-50 uppercase tracking-wider mb-2">
                      Sources
                    </p>
                    <div className="flex flex-col gap-1.5">
                      {briefing.sources.slice(0, 8).map((src, i) => (
                        <a
                          key={i}
                          href={src.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs text-brand-600 hover:text-brand-700 truncate transition-colors"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {src.title || src.url}
                        </a>
                      ))}
                    </div>
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
