'use client'

import { useEffect, useRef } from 'react'
import { stripMarkdown } from '@/lib/speech'
import { useSpeech } from '@/contexts/SpeechContext'
import { useQueue } from '@/contexts/QueueContext'
import { useTtsSettings as useTtsSettingsHook, type TtsSettings as TtsSettingsType } from '@/contexts/TtsSettings'

// The per-article "Listen" bar. Playback itself is the Listen Queue's job:
// pressing Listen queues the item (if it isn't already) and starts it
// through the persistent player, which carries the transport. This bar
// shows the item's state, a play/pause shortcut, and the queue toggle —
// including the explicit remove for "skimmed it, don't need the audio".

// Settings live in contexts/TtsSettings; re-exported for existing imports.
export { useTtsSettings, invalidateTtsSettings, type TtsSettings } from '@/contexts/TtsSettings'

interface AudioPlayerProps {
  id: string                       // 'briefing:<uuid>' | 'digest:<uuid>' (or a live card key)
  kind: 'briefing' | 'digest'
  itemId?: string | null           // DB id; without it only the browser voice is possible
  content: string                  // markdown
  settings?: TtsSettingsType       // pass when the page already has them; otherwise fetched
  className?: string
}

function readingMinutes(content: string): number {
  const words = content.trim().split(/\s+/).filter(Boolean).length
  return Math.max(1, Math.round(words / 200))
}

export function AudioPlayer({ id, kind, itemId, content, settings: given, className = '' }: AudioPlayerProps) {
  const speech = useSpeech()
  const queue = useQueue()
  const settings = useTtsSettingsHook(given)
  const queued = itemId ? queue.find(kind, itemId) : undefined

  const isActive = speech.activeId === id && speech.status !== 'idle'
  const isPlaying = isActive && speech.status === 'playing'
  const isPaused = isActive && speech.status === 'paused'
  const isLoading = isActive && speech.status === 'loading'

  function onPlayPause() {
    if (!content) return
    if (isLoading) return
    if (isPlaying) { speech.pause(); return }
    if (isPaused) { speech.resume(); return }
    if (itemId) void queue.playFromArticle(kind, itemId)
    else speech.play(id, stripMarkdown(content), settings.voiceUri, settings.speed) // unsaved live card
  }

  const providerLabel = settings.provider === 'elevenlabs' ? 'Premium' : 'Standard'
  const statusLabel = isLoading ? 'Generating audio' : isPlaying ? 'Pause' : isPaused ? 'Resume' : 'Listen'

  return (
    <div className={`font-chrome text-[11px] text-press-muted ${className}`}>
      <div className="flex items-center gap-2 px-4 py-2 border-y-[0.5px] border-press-hair bg-press-accent/[0.04]">
        <button
          onClick={onPlayPause}
          disabled={!content || isLoading}
          title={statusLabel}
          className={[
            'flex items-center gap-1.5 rounded-full border px-2.5 py-1 transition-colors disabled:opacity-60',
            isActive
              ? 'border-press-accent bg-press-accent text-white hover:bg-press-accent/90'
              : 'border-press-accent/50 text-press-accent hover:bg-press-accent/10',
          ].join(' ')}
        >
          {isLoading ? (
            <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
          ) : isPlaying ? (
            <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" /></svg>
          ) : (
            <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z" /></svg>
          )}
          <span className="uppercase tracking-[1px] text-[10px]">{statusLabel}</span>
        </button>

        <span className="truncate">
          ~{readingMinutes(content)} min · {providerLabel}
          {isActive && speech.sentences.length > 0 ? ` · sentence ${speech.currentSentenceIndex + 1}/${speech.sentences.length}` : ''}
          {settings.provider === 'elevenlabs' && !itemId ? ' (standard until saved)' : ''}
        </span>

        {/* Queue toggle — the explicit remove is the "skimmed it" override */}
        {itemId && (
          <button
            onClick={() => void (queued ? queue.remove(queued.id) : queue.add(kind, itemId))}
            title={queued ? 'Remove from listen queue' : 'Add to listen queue'}
            className={[
              'ml-auto flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-[1px] transition-colors flex-shrink-0',
              queued
                ? 'border-press-accent/50 text-press-accent hover:border-press-down hover:text-press-down'
                : 'border-press-hair text-press-muted hover:border-press-accent/60 hover:text-press-accent',
            ].join(' ')}
          >
            {queued ? (
              <>
                In queue
                <span aria-hidden className="text-press-faint">·</span>
                <span className="flex items-center gap-0.5">
                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                  Remove
                </span>
              </>
            ) : '+ Queue'}
          </button>
        )}
      </div>
    </div>
  )
}

// Wraps an article: while this id is being read aloud, shows the sentence-
// highlighted view (auto-scrolling the active sentence); otherwise renders
// the children (normally a PressArticle).
export function SpokenArticle({ id, children }: { id: string; children: React.ReactNode }) {
  const speech = useSpeech()
  const activeRef = useRef<HTMLSpanElement>(null)
  const isActive = speech.activeId === id && speech.status !== 'loading' && speech.status !== 'idle' && speech.sentences.length > 0

  useEffect(() => {
    if (isActive && activeRef.current) {
      activeRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    }
  }, [isActive, speech.currentSentenceIndex])

  if (!isActive) return <>{children}</>
  return (
    <div className="font-georgia text-[13px] text-press-body leading-[1.65]">
      {speech.sentences.map((s, i) => (
        <span
          key={i}
          ref={i === speech.currentSentenceIndex ? activeRef : undefined}
          className={i === speech.currentSentenceIndex ? 'bg-press-accent/15 text-press-ink rounded-sm' : 'text-press-muted'}
        >
          {s}{' '}
        </span>
      ))}
    </div>
  )
}
