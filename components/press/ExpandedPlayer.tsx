'use client'

import { useEffect } from 'react'
import { useQueue } from '@/contexts/QueueContext'
import { useSpeech } from '@/contexts/SpeechContext'
import { Icon, Monogram } from './MiniPlayer'
import { QueueCostLine, QueueList } from './QueueList'

// Full player: a sheet sliding up from the bottom (same motion as the
// briefing sheet). Transport, scrub, speed, then the queue. Expanding or
// collapsing is UI state only — playback never notices.

const SPEEDS = [0.75, 1, 1.25, 1.5, 2] as const

function mmss(s: number) {
  const m = Math.floor(s / 60)
  const r = Math.floor(s % 60)
  return `${m}:${String(r).padStart(2, '0')}`
}

export function ExpandedPlayer() {
  const queue = useQueue()
  const speech = useSpeech()
  const { current, currentIndex, unplayed, isCurrentActive, expanded } = queue

  // Lock the page behind the sheet
  useEffect(() => {
    if (!expanded) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [expanded])

  if (!expanded) return null
  const close = () => queue.setExpanded(false)
  if (!current) { close(); return null }

  const isPlaying = isCurrentActive && speech.status === 'playing'
  const isLoading = isCurrentActive && speech.status === 'loading'
  const p = speech.progress
  const active = isCurrentActive && speech.status !== 'loading'
  const elapsedLabel = !active
    ? '—'
    : p.unit === 'seconds' ? mmss(p.elapsed) : `${p.elapsed} / ${p.duration} sentences`
  const remainingLabel = !active
    ? `~${current.minutes} min`
    : p.unit === 'seconds' && p.duration > 0 ? `-${mmss(Math.max(0, p.duration - p.elapsed))}` : ''
  const nextSpeed = () => {
    const i = SPEEDS.indexOf(speech.rate as (typeof SPEEDS)[number])
    speech.setRate(SPEEDS[(i + 1) % SPEEDS.length])
  }
  const btn = 'p-2.5 rounded-full text-press-ink hover:bg-press-accent/10 transition-colors disabled:opacity-40'

  return (
    <>
      <div className="fixed inset-0 bg-ink-300/20 backdrop-blur-[2px]" style={{ zIndex: 39 }} onClick={close} />
      <div
        className="fixed bottom-0 inset-x-0 rounded-t-3xl paper-page shadow-[0_-8px_40px_rgba(60,50,80,0.14)] animate-slide-up flex flex-col h-sheet"
        style={{ zIndex: 40 }}
        role="dialog"
        aria-label="Listen queue player"
      >
        {/* Handle + collapse */}
        <div className="flex-shrink-0">
          <div className="flex justify-center pt-3 pb-1">
            <button onClick={close} aria-label="Collapse player" className="w-10 h-1 bg-press-pin/60 rounded-full" />
          </div>
          <div className="flex items-center justify-between px-4 pb-1">
            <span className="font-chrome text-[9px] uppercase tracking-[2px] text-press-accent">Now playing · {currentIndex + 1} of {unplayed.length}</span>
            <button onClick={close} aria-label="Collapse" className="p-1.5 text-press-muted hover:text-press-ink">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto min-h-0 px-4 pb-[calc(1rem+env(safe-area-inset-bottom,0px))]">
          <div className="max-w-2xl mx-auto">
            {/* Art + titles */}
            <div className="flex flex-col items-center text-center pt-3 pb-4">
              <Monogram title={current.title} size="lg" />
              <h2 className="font-georgia text-[20px] text-press-ink mt-4 leading-tight">{current.title}</h2>
              <p className="font-chrome text-[11px] text-press-muted mt-1">
                {current.subtitle ? `${current.subtitle} · ` : ''}{currentIndex + 1} of {unplayed.length}
                {isLoading ? ' · generating audio…' : ''}
              </p>
              {queue.error && <p className="font-chrome text-[11px] text-press-down mt-1">{queue.error}</p>}
            </div>

            {/* Scrub */}
            <div className="px-2">
              <input
                type="range"
                min={0}
                max={1000}
                value={Math.round((active ? p.fraction : 0) * 1000)}
                onChange={(e) => active && speech.seekFraction(Number(e.target.value) / 1000)}
                disabled={!active}
                aria-label="Position"
                className="w-full accent-[#6B5CA5] h-1 cursor-pointer disabled:cursor-default"
              />
              <div className="flex justify-between font-chrome text-[10px] text-press-muted mt-1">
                <span>{elapsedLabel}</span>
                <span>{remainingLabel}</span>
              </div>
            </div>

            {/* Transport */}
            <div className="flex items-center justify-center gap-1 mt-2">
              <button onClick={() => speech.skip(-15)} disabled={!active} title="Back 15s" className={btn}>
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 5V2L7 6l5 4V7a6 6 0 11-6 6" />
                </svg>
              </button>
              <button onClick={queue.prev} disabled={currentIndex <= 0} title="Previous" className={btn}>{Icon.prev}</button>
              <button
                onClick={queue.togglePlay}
                disabled={isLoading}
                title={isPlaying ? 'Pause' : 'Play'}
                className="p-4 mx-1 rounded-full bg-press-accent text-white hover:bg-press-accent/90 disabled:opacity-60"
              >
                {isLoading ? Icon.spinner : isPlaying ? Icon.pause : Icon.play}
              </button>
              <button onClick={queue.next} disabled={currentIndex < 0 || currentIndex >= unplayed.length - 1} title="Next" className={btn}>{Icon.next}</button>
              <button onClick={() => speech.skip(15)} disabled={!active} title="Forward 15s" className={btn}>
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 5V2l5 4-5 4V7a6 6 0 106 6" />
                </svg>
              </button>
            </div>

            {/* Speed pill */}
            <div className="flex justify-center mt-2">
              <button
                onClick={nextSpeed}
                className="font-chrome text-[11px] px-3 py-1 rounded-full border border-press-hair text-press-muted hover:border-press-accent/60 hover:text-press-accent"
                title="Playback speed"
              >
                {speech.rate}×
              </button>
            </div>

            {/* Queue */}
            <div className="mt-6">
              <div className="flex items-center gap-3 mb-1">
                <div className="flex-1 border-t-[3px] border-double border-press-hair" />
                <span className="press-label">Up next</span>
                <div className="flex-1 border-t-[3px] border-double border-press-hair" />
              </div>
              <QueueCostLine className="text-center mb-2" />
              <QueueList onNavigate={close} />
            </div>
          </div>
        </div>
      </div>
    </>
  )
}
