'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { PressArticle } from './press/PressArticle'
import { AudioPlayer, SpokenArticle } from './press/AudioPlayer'
import { PressNav } from './press/PressNav'
import { HistoryNav } from '@/components/press/HistoryNav'
import { QueueNeighborBar, useQueueNeighbors } from './press/QueueNeighbors'
import { buildSearchRegex, strongNorm } from '@/lib/channel-history-types'
import type { Source } from '@/lib/types'

// A full-text search hit opened from channel history: highlight every match
// (CSS Custom Highlight API, so React's DOM is never touched) and scroll to
// the first one, inside `story` (this channel's digest story) when given.
export interface ReadHighlight {
  q: string
  whole: boolean
  story: string | null
}

const HIGHLIGHT_ALL = 'pulse-search'
const HIGHLIGHT_FIRST = 'pulse-search-first'
type HighlightRegistry = { set(name: string, h: unknown): void; delete(name: string): void }
type HighlightCtor = new (...ranges: Range[]) => unknown
// Turbopack's CSS parser rejects ::highlight() in globals.css, so the two
// rules are added once at runtime: every match tinted, the one scrolled to
// stronger (press accent).
const HIGHLIGHT_CSS =
  `::highlight(${HIGHLIGHT_ALL}){background-color:rgba(107,92,165,0.18)}` +
  `::highlight(${HIGHLIGHT_FIRST}){background-color:rgba(107,92,165,0.38);color:#2C2522}`
function ensureHighlightStyle() {
  if (document.getElementById('pulse-search-highlight-css')) return
  const el = document.createElement('style')
  el.id = 'pulse-search-highlight-css'
  el.textContent = HIGHLIGHT_CSS
  document.head.appendChild(el)
}

interface Props {
  kind: 'briefing' | 'digest'
  id: string
  title: string
  subtitle: string | null
  content: string
  sources: Source[]
  createdAt: string
  alreadyRead: boolean
  backHref?: string                // '/post-pulse' (catch-up panel) or '/channels/<id>/history'
  backQuery?: string               // the ?from= origin, kept on Previous/Next links
  backLabel?: string
  artworkLinks?: boolean           // Image search links on artwork headings (lib/artwork-links.ts)
  highlight?: ReadHighlight | null // ?q= from a channel-history full-text search
}

function dateLabel(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
}

export function ReadArticleClient({ kind, id, title, subtitle, content, sources, createdAt, alreadyRead, backHref = '/listen', backQuery = '', backLabel = 'Back to the listen queue', artworkLinks = false, highlight = null }: Props) {
  const speechId = `${kind}:${id}`
  const endRef = useRef<HTMLDivElement>(null)
  const articleRef = useRef<HTMLDivElement>(null)
  const [read, setRead] = useState(alreadyRead)
  // While true, reaching the end doesn't mark the article read: the jump to
  // a search match moved the page, not the reader. Their own first scroll
  // gesture (wheel, touch, key) clears it.
  const jumpedToMatch = useRef(!!highlight)
  // Previous/Next keep the ?from= origin so the back arrow still returns there
  const neighbors = useQueueNeighbors(kind, id, backQuery)

  // "Fully reading" = reaching the end of the article. Marks it read (the
  // same read_at the archive uses); the item stays in the listen queue —
  // the queue's Remove control is the "skimmed it" override.
  useEffect(() => {
    if (read || !endRef.current) return
    const el = endRef.current
    let visible = false
    let done = false
    const gestures = ['wheel', 'touchmove', 'keydown'] as const
    const fire = () => {
      if (done) return
      done = true
      setRead(true)
      io.disconnect()
      for (const g of gestures) window.removeEventListener(g, onGesture)
      void fetch('/api/read', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(kind === 'briefing' ? { briefingIds: [id] } : { digestIds: [id] }),
      }).catch(() => {})
    }
    const io = new IntersectionObserver((entries) => {
      visible = entries.some((e) => e.isIntersecting)
      if (visible && !jumpedToMatch.current) fire()
    }, { threshold: 0.1 })
    function onGesture() {
      jumpedToMatch.current = false
      if (visible) fire()
    }
    io.observe(el)
    if (jumpedToMatch.current) for (const g of gestures) window.addEventListener(g, onGesture, { passive: true })
    return () => {
      io.disconnect()
      for (const g of gestures) window.removeEventListener(g, onGesture)
    }
  }, [read, kind, id])

  // Highlight the search matches and bring the first one into view. Runs a
  // little after mount so Next's post-navigation scroll doesn't undo it.
  const hq = highlight?.q ?? null
  const hWhole = !!highlight?.whole
  const hStory = highlight?.story ?? null
  useEffect(() => {
    if (!hq) return
    const registry = (globalThis.CSS as unknown as { highlights?: HighlightRegistry }).highlights
    const Ctor = (globalThis as unknown as { Highlight?: HighlightCtor }).Highlight
    let firstEl: Element | null = null
    const timers: ReturnType<typeof setTimeout>[] = []

    const apply = () => {
      const root = articleRef.current
      if (!root) return
      const nodes: Text[] = []
      const starts: number[] = []
      let text = ''
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        nodes.push(n as Text)
        starts.push(text.length)
        text += (n as Text).data
      }
      // Node holding character `pos` (for an end offset, the node it ends in)
      const locate = (pos: number, end: boolean): [Text, number] | null => {
        for (let i = nodes.length - 1; i >= 0; i--) {
          if (end ? starts[i] < pos : starts[i] <= pos) return [nodes[i], pos - starts[i]]
        }
        return null
      }
      const ranges: Range[] = []
      const re = buildSearchRegex(hq, hWhole)
      for (const m of text.matchAll(re)) {
        if (!m[0].length || m.index === undefined || ranges.length >= 500) continue
        const a = locate(m.index, false)
        const b = locate(m.index + m[0].length, true)
        if (!a || !b) continue
        const r = document.createRange()
        r.setStart(a[0], a[1])
        r.setEnd(b[0], b[1])
        ranges.push(r)
      }
      if (ranges.length === 0) return
      let first = ranges[0]
      if (hStory) {
        const want = strongNorm(hStory)
        const label = Array.from(root.querySelectorAll('.press-label')).find((el) => {
          const t = strongNorm(el.textContent ?? '')
          return t === want || t.startsWith(`${want} `)
        })
        const inStory = label && ranges.find((r) => label.compareDocumentPosition(r.startContainer) & Node.DOCUMENT_POSITION_FOLLOWING)
        if (inStory) first = inStory
      }
      if (registry && Ctor) {
        ensureHighlightStyle()
        registry.set(HIGHLIGHT_ALL, new Ctor(...ranges))
        registry.set(HIGHLIGHT_FIRST, new Ctor(first))
      }
      firstEl = first.startContainer.parentElement
    }
    const jump = () => {
      if (!firstEl) return
      jumpedToMatch.current = true
      firstEl.scrollIntoView({ block: 'center' })
    }
    timers.push(setTimeout(() => { apply(); jump() }, 120))
    timers.push(setTimeout(jump, 450))
    return () => {
      timers.forEach(clearTimeout)
      registry?.delete(HIGHLIGHT_ALL)
      registry?.delete(HIGHLIGHT_FIRST)
    }
  }, [hq, hWhole, hStory])

  // Bottom padding clears the docked mini player / "Queue finished" bar;
  // MiniPlayer sets --mini-player-h only while one is showing.
  return (
    <div className="min-h-screen paper-page pb-[var(--mini-player-h,0px)]">
      <header className="sticky top-0 z-20 bg-[#F0ECF4]/95 backdrop-blur-sm border-b-[0.5px] border-press-hair px-4 py-3">
        <div className="max-w-2xl mx-auto flex items-center gap-3">
          <Link
            href={backHref}
            className="p-1.5 rounded-lg text-press-muted hover:text-press-ink hover:bg-press-accent/10 transition-colors"
            aria-label={backLabel}
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
          <HistoryNav />
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 pt-3 pb-28">
        <QueueNeighborBar neighbors={neighbors} query={backQuery} className="mb-3" />
        <AudioPlayer id={speechId} kind={kind} itemId={id} content={content} className="mb-4" />
        <div ref={articleRef}>
          <SpokenArticle id={speechId}>
            <PressArticle content={content} channelName={title} sourceDate={createdAt} artworkLinks={artworkLinks} />
          </SpokenArticle>
        </div>

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
        <QueueNeighborBar neighbors={neighbors} query={backQuery} className="mt-4" />
      </main>

      <PressNav />
    </div>
  )
}
