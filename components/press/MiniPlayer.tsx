'use client'

import { usePathname } from 'next/navigation'
import { useQueue } from '@/contexts/QueueContext'
import { useSpeech } from '@/contexts/SpeechContext'

// Collapsed player: a slim bar docked at the bottom of every page whenever
// the queue is non-empty. Tap the bar to expand; the three controls act
// directly. A thin progress line runs along the top edge.

export const Icon = {
  prev: <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M6 6h2v12H6zm3.5 6l8.5 6V6z" /></svg>,
  next: <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M6 18l8.5-6L6 6zM16 6h2v12h-2z" /></svg>,
  play: <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z" /></svg>,
  pause: <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" /></svg>,
  spinner: (
    <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  ),
}

export function Monogram({ title, size = 'sm' }: { title: string; size?: 'sm' | 'lg' }) {
  const letter = (title.replace(/^[^A-Za-z0-9]+/, '')[0] ?? '•').toUpperCase()
  const dims = size === 'lg' ? 'w-24 h-24 text-[40px]' : 'w-8 h-8 text-[13px]'
  return (
    <div className={`${dims} rounded-full bg-press-accent/15 text-press-accent font-georgia flex items-center justify-center flex-shrink-0`}>
      {letter}
    </div>
  )
}

export function MiniPlayer() {
  const queue = useQueue()
  const speech = useSpeech()
  const pathname = usePathname()
  const { current, currentIndex, unplayed, isCurrentActive, finished, expanded } = queue

  if (expanded) return null
  if (!current && !finished) return null

  const bottom = pathname === '/' ? 'bottom-[76px]' : 'bottom-0'
  const wrap = `fixed left-0 right-0 ${bottom} z-40`
  const surface = 'bg-[#EFE9F5]/95 backdrop-blur-sm border-t-[0.5px] border-press-hair shadow-[0_-2px_16px_rgba(60,50,80,0.10)]'

  if (!current && finished) {
    return (
      <div className={wrap}>
        <div className={`${surface} px-4 py-2.5 pb-[calc(0.625rem+env(safe-area-inset-bottom,0px))]`}>
          <div className="max-w-2xl mx-auto flex items-center gap-3 font-chrome text-[11px] text-press-muted">
            <span className="uppercase tracking-[1px] text-[9px] text-press-accent">Queue finished</span>
            <span className="text-press-ink">{finished.count} played, marked read</span>
            <button onClick={queue.dismissFinished} aria-label="Dismiss" className="ml-auto px-2 text-press-faint hover:text-press-ink">×</button>
          </div>
        </div>
      </div>
    )
  }

  const item = current!
  const isPlaying = isCurrentActive && speech.status === 'playing'
  const isLoading = isCurrentActive && speech.status === 'loading'
  const fraction = isCurrentActive ? speech.progress.fraction : 0
  const position = currentIndex >= 0 ? `${currentIndex + 1} of ${unplayed.length}` : `${unplayed.length} queued`
  const btn = 'p-2 rounded-full text-press-ink hover:bg-press-accent/10 transition-colors disabled:opacity-40'

  return (
    <div className={wrap}>
      <div
        role="button"
        tabIndex={0}
        onClick={() => queue.setExpanded(true)}
        onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && queue.setExpanded(true)}
        className={`${surface} relative cursor-pointer pb-[env(safe-area-inset-bottom,0px)]`}
        aria-label="Open player"
      >
        {/* Progress line along the top edge */}
        <div className="absolute top-0 left-0 right-0 h-[2px] bg-press-hair">
          <div className="h-full bg-press-accent transition-[width] duration-500" style={{ width: `${Math.round(fraction * 1000) / 10}%` }} />
        </div>

        <div className="max-w-2xl mx-auto flex items-center gap-3 px-3 py-2">
          <Monogram title={item.title} />
          <div className="min-w-0 flex-1">
            <span className="block font-georgia text-[13px] text-press-ink truncate leading-tight">{item.title}</span>
            <span className="block font-chrome text-[10px] text-press-muted truncate">
              {position}
              {isLoading ? ' · generating audio…' : isPlaying ? ' · playing' : isCurrentActive ? ' · paused' : ''}
              {queue.error ? ` · ${queue.error}` : ''}
            </span>
          </div>
          <div className="flex items-center gap-0.5" onClick={(e) => e.stopPropagation()}>
            <button onClick={queue.prev} disabled={currentIndex <= 0} title="Previous" className={btn}>{Icon.prev}</button>
            <button
              onClick={queue.togglePlay}
              disabled={isLoading}
              title={isPlaying ? 'Pause' : 'Play'}
              className="p-2.5 rounded-full bg-press-accent text-white hover:bg-press-accent/90 disabled:opacity-60"
            >
              {isLoading ? Icon.spinner : isPlaying ? Icon.pause : Icon.play}
            </button>
            <button onClick={queue.next} disabled={currentIndex < 0 || currentIndex >= unplayed.length - 1} title="Next" className={btn}>{Icon.next}</button>
          </div>
        </div>
      </div>
    </div>
  )
}
