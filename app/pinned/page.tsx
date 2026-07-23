'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { PRESS_MD_COMPONENTS } from '@/components/press/PressArticle'
import { PressNav } from '@/components/press/PressNav'
import type { PinnedInsight } from '@/lib/types'

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
  })
}

export default function PinnedPage() {
  const [pins, setPins] = useState<PinnedInsight[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/pins')
      .then((r) => r.json())
      .then((data) => setPins(Array.isArray(data) ? data : []))
      .finally(() => setLoading(false))
  }, [])

  async function deletePin(id: string) {
    await fetch(`/api/pins/${id}`, { method: 'DELETE' })
    setPins((prev) => prev.filter((p) => p.id !== id))
  }

  return (
    <div className="min-h-screen paper-page">
      <header className="sticky top-0 z-20 bg-[#F0ECF4]/95 backdrop-blur-sm border-b-[0.5px] border-press-hair px-4 py-3">
        <div className="max-w-2xl mx-auto flex items-center gap-3">
          <Link
            href="/"
            className="p-1.5 rounded-lg text-press-muted hover:text-press-ink hover:bg-press-accent/10 transition-colors"
            aria-label="Back"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </Link>
          <div className="flex-1 min-w-0">
            <h1 className="font-georgia text-[20px] font-normal tracking-[-0.3px] text-press-ink">Pinned Insights</h1>
            <p className="font-chrome text-[9px] uppercase tracking-[2px] text-press-muted">
              {pins.length === 0 ? 'The reference shelf' : `${pins.length} clipping${pins.length !== 1 ? 's' : ''} on file`}
            </p>
          </div>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 pt-5 pb-10">
        {loading ? (
          <div className="space-y-3 py-4">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-20 bg-white/30 animate-pulse" />
            ))}
          </div>
        ) : pins.length === 0 ? (
          <div className="text-center py-20">
            <svg className="w-7 h-7 text-press-pin mx-auto mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                d="M17.657 16.657L13.414 20.9a2 2 0 01-2.828 0l-4.243-4.243a8 8 0 1111.314 0z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            <p className="font-georgia text-[15px] text-press-ink mb-1">Nothing pinned yet</p>
            <p className="font-georgia italic text-press-muted text-sm">
              Tap the bookmark on any section of a briefing or digest to save it here.
            </p>
          </div>
        ) : (
          <>
            <div className="press-rule-h" />
            {pins.map((pin) => (
              <div key={pin.id} className="group border-b-[0.5px] border-press-hair py-4 px-1">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2.5 flex-wrap mb-1">
                      {pin.channel_name && (
                        <span className="press-label">{pin.channel_name}</span>
                      )}
                      <span className="font-chrome text-[10px] uppercase tracking-[1px] text-press-muted">
                        {formatDate(pin.source_date)}
                        {formatDate(pin.source_date) !== formatDate(pin.created_at) &&
                          ` · pinned ${formatDate(pin.created_at)}`}
                      </span>
                    </div>
                    <ReactMarkdown remarkPlugins={[remarkGfm]} components={PRESS_MD_COMPONENTS}>
                      {pin.content}
                    </ReactMarkdown>
                  </div>
                  <button
                    onClick={() => deletePin(pin.id)}
                    className="flex-shrink-0 p-1.5 text-press-pin hover:text-press-down transition-colors opacity-40 md:opacity-0 md:group-hover:opacity-100"
                    aria-label="Delete pinned insight"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                        d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                  </button>
                </div>
              </div>
            ))}
          </>
        )}
      </main>
      <PressNav />
    </div>
  )
}
