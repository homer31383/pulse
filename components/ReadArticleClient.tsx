'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { PressArticle } from './press/PressArticle'
import { AudioPlayer, SpokenArticle } from './press/AudioPlayer'
import { PressNav } from './press/PressNav'
import type { Source } from '@/lib/types'

interface Props {
  kind: 'briefing' | 'digest'
  id: string
  title: string
  subtitle: string | null
  content: string
  sources: Source[]
  createdAt: string
  alreadyRead: boolean
}

function dateLabel(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
}

export function ReadArticleClient({ kind, id, title, subtitle, content, sources, createdAt, alreadyRead }: Props) {
  const speechId = `${kind}:${id}`
  const endRef = useRef<HTMLDivElement>(null)
  const [read, setRead] = useState(alreadyRead)

  // "Fully reading" = reaching the end of the article. Marks it read (the
  // same read_at the archive uses); the item stays in the listen queue —
  // the queue's Remove control is the "skimmed it" override.
  useEffect(() => {
    if (read || !endRef.current) return
    const el = endRef.current
    const io = new IntersectionObserver((entries) => {
      if (!entries.some((e) => e.isIntersecting)) return
      setRead(true)
      io.disconnect()
      void fetch('/api/read', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(kind === 'briefing' ? { briefingIds: [id] } : { digestIds: [id] }),
      }).catch(() => {})
    }, { threshold: 0.1 })
    io.observe(el)
    return () => io.disconnect()
  }, [read, kind, id])

  return (
    <div className="min-h-screen paper-page">
      <header className="sticky top-0 z-20 bg-[#F0ECF4]/95 backdrop-blur-sm border-b-[0.5px] border-press-hair px-4 py-3">
        <div className="max-w-2xl mx-auto flex items-center gap-3">
          <Link
            href="/listen"
            className="p-1.5 rounded-lg text-press-muted hover:text-press-ink hover:bg-press-accent/10 transition-colors"
            aria-label="Back to the listen queue"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </Link>
          <div className="flex-1 min-w-0">
            <h1 className="font-georgia text-[20px] font-normal tracking-[-0.3px] text-press-ink truncate">{title}</h1>
            <p className="font-chrome text-[9px] uppercase tracking-[2px] text-press-muted truncate">
              {subtitle ? `${subtitle} · ` : ''}{dateLabel(createdAt)}{read ? ' · read' : ''}
            </p>
          </div>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 pt-3 pb-28">
        <AudioPlayer id={speechId} kind={kind} itemId={id} content={content} className="mb-4" />
        <SpokenArticle id={speechId}>
          <PressArticle content={content} channelName={title} sourceDate={createdAt} />
        </SpokenArticle>

        {sources.length > 0 && (
          <div className="mt-6 pt-3 border-t-[0.5px] border-press-hair font-chrome text-[10px] text-press-faint leading-relaxed">
            <span className="uppercase tracking-[1.5px] mr-1.5">Sources</span>
            {sources.slice(0, 10).map((src, i) => (
              <span key={i}>
                {i > 0 && ' · '}
                <a href={src.url} target="_blank" rel="noopener noreferrer" className="hover:text-press-accent transition-colors">
                  {src.title || src.url}
                </a>
              </span>
            ))}
            {sources.length > 10 && ` · +${sources.length - 10} more`}
          </div>
        )}

        {/* End-of-article sentinel */}
        <div ref={endRef} className="h-px" aria-hidden />
        <p className="font-chrome text-[9px] uppercase tracking-[2px] text-press-faint text-center mt-8">End</p>
      </main>

      <PressNav />
    </div>
  )
}
