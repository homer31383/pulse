'use client'

import { useEffect, useRef, useState } from 'react'
import { stripMarkdown } from '@/lib/speech'
import { formatTtsCost } from '@/lib/elevenlabs'
import { useSpeech, type AudioTrack } from '@/contexts/SpeechContext'
import type { TtsProvider } from '@/lib/types'

// One audio player for every reading surface (live sheet, archive edition,
// channel history, digest history). Always visible on a finished article:
// no settings gate. Standard = browser SpeechSynthesis; Premium = ElevenLabs
// audio via /api/tts/elevenlabs (per the profile's settings).

export interface TtsSettings {
  provider: TtsProvider
  voiceUri: string | null          // browser voice
  elevenLabsVoiceId: string | null
  speed: number
}

const DEFAULT_TTS_SETTINGS: TtsSettings = { provider: 'browser', voiceUri: null, elevenLabsVoiceId: null, speed: 1 }
const TTS_SPEEDS = [0.75, 1, 1.25, 1.5, 2] as const

// Surfaces that don't already hold the profile's settings (history pages)
// fetch them once; cached briefly so a page of 30 entries makes one request.
let settingsCache: { at: number; promise: Promise<TtsSettings> } | null = null
function fetchTtsSettings(): Promise<TtsSettings> {
  if (settingsCache && Date.now() - settingsCache.at < 60_000) return settingsCache.promise
  const promise = fetch('/api/settings')
    .then((r) => r.json())
    .then((d) => ({
      provider: (d.tts_provider === 'elevenlabs' ? 'elevenlabs' : 'browser') as TtsProvider,
      voiceUri: d.tts_voice ?? null,
      elevenLabsVoiceId: d.tts_elevenlabs_voice_id ?? null,
      speed: Number(d.tts_speed) || 1,
    }))
    .catch(() => DEFAULT_TTS_SETTINGS)
  settingsCache = { at: Date.now(), promise }
  return promise
}
export function invalidateTtsSettings() { settingsCache = null }

export function useTtsSettings(initial?: TtsSettings): TtsSettings {
  const [settings, setSettings] = useState<TtsSettings>(initial ?? DEFAULT_TTS_SETTINGS)
  useEffect(() => {
    if (initial) { setSettings(initial); return }
    let live = true
    fetchTtsSettings().then((s) => { if (live) setSettings(s) })
    return () => { live = false }
  }, [initial])
  return settings
}

interface Estimate {
  chars: number
  estimatedCost: number
  modelLabel: string
  voiceName: string
  voiceId: string
}

interface AudioPlayerProps {
  id: string                       // unique per article across the app, e.g. 'briefing:<uuid>'
  kind: 'briefing' | 'digest'
  itemId?: string | null           // DB id; without it only the browser voice is possible
  content: string                  // markdown
  settings?: TtsSettings           // pass when the page already has them; otherwise fetched
  className?: string
}

function readingMinutes(content: string): number {
  const words = content.trim().split(/\s+/).filter(Boolean).length
  return Math.max(1, Math.round(words / 200))
}

const Spinner = () => (
  <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
  </svg>
)

export function AudioPlayer({ id, kind, itemId, content, settings: given, className = '' }: AudioPlayerProps) {
  const speech = useSpeech()
  const settings = useTtsSettings(given)
  const [estimate, setEstimate] = useState<Estimate | null>(null)
  const [error, setError] = useState<string | null>(null)

  const isActive = speech.activeId === id
  const isPlaying = isActive && speech.status === 'playing'
  const isPaused = isActive && speech.status === 'paused'
  const isLoading = isActive && speech.status === 'loading'
  const premiumPossible = settings.provider === 'elevenlabs' && !!itemId

  function playBrowser() {
    speech.play(id, stripMarkdown(content), settings.voiceUri, settings.speed)
  }

  async function startPremium() {
    setError(null)
    setEstimate(null)
    speech.prepareAudio(id, settings.speed) // synchronous, inside the click gesture
    try {
      const q = new URLSearchParams({ kind, id: itemId! })
      if (settings.elevenLabsVoiceId) q.set('voiceId', settings.elevenLabsVoiceId)
      const res = await fetch(`/api/tts/elevenlabs?${q}`)
      const est = (await res.json()) as Partial<Estimate> & { error?: string; configured?: boolean; audio?: AudioTrack | null }
      if (!res.ok) throw new Error(est.error || 'Could not check premium audio')
      if (est.audio) { speech.playAudio(id, est.audio, settings.speed); return }
      speech.cancelLoading()
      if (!est.configured) {
        setError('Premium audio isn\'t configured on the server yet — using the standard voice.')
        playBrowser()
        return
      }
      setEstimate({
        chars: est.chars ?? 0,
        estimatedCost: est.estimatedCost ?? 0,
        modelLabel: est.modelLabel ?? 'ElevenLabs',
        voiceName: est.voiceName ?? 'Voice',
        voiceId: est.voiceId ?? settings.elevenLabsVoiceId ?? '',
      })
    } catch (err) {
      speech.cancelLoading()
      setError(err instanceof Error ? err.message : 'Premium audio failed')
    }
  }

  async function generatePremium() {
    const est = estimate
    setEstimate(null)
    setError(null)
    speech.prepareAudio(id, settings.speed)
    try {
      const res = await fetch('/api/tts/elevenlabs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind, id: itemId, voiceId: est?.voiceId || settings.elevenLabsVoiceId || undefined }),
      })
      const data = (await res.json()) as { error?: string; audio?: AudioTrack }
      if (!res.ok || !data.audio) throw new Error(data.error || 'Audio generation failed')
      speech.playAudio(id, data.audio, settings.speed)
    } catch (err) {
      speech.cancelLoading()
      setError(err instanceof Error ? err.message : 'Audio generation failed')
    }
  }

  function onPlayPause() {
    if (!content) return
    if (!isActive) {
      if (premiumPossible) void startPremium()
      else playBrowser()
    } else if (isLoading) {
      return
    } else if (isPlaying) {
      speech.pause()
    } else if (isPaused) {
      speech.resume()
    }
  }

  const providerLabel = settings.provider === 'elevenlabs' ? 'Premium' : 'Standard'

  return (
    <div className={`font-chrome text-[11px] text-press-muted ${className}`}>
      <div className="flex items-center gap-2 px-4 py-2 border-y-[0.5px] border-press-hair bg-press-accent/[0.04]">
        {/* Play / pause */}
        <button
          onClick={onPlayPause}
          disabled={!content || isLoading}
          title={isPlaying ? 'Pause' : isPaused ? 'Resume' : 'Listen'}
          className={[
            'flex items-center gap-1.5 rounded-full border px-2.5 py-1 transition-colors disabled:opacity-60',
            isActive
              ? 'border-press-accent bg-press-accent text-white hover:bg-press-accent/90'
              : 'border-press-accent/50 text-press-accent hover:bg-press-accent/10',
          ].join(' ')}
        >
          {isLoading ? (
            <Spinner />
          ) : isPlaying ? (
            <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" /></svg>
          ) : (
            <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z" /></svg>
          )}
          <span className="uppercase tracking-[1px] text-[10px]">
            {isLoading ? 'Generating audio' : isPlaying ? 'Pause' : isPaused ? 'Resume' : 'Listen'}
          </span>
        </button>

        {isActive ? (
          <>
            {/* Speed pills */}
            <div className="flex items-center gap-1">
              {TTS_SPEEDS.map((s) => (
                <button
                  key={s}
                  onClick={() => speech.setRate(s)}
                  className={[
                    'px-1.5 py-0.5 rounded-full border transition-colors',
                    speech.rate === s
                      ? 'border-press-accent bg-press-accent/10 text-press-accent'
                      : 'border-press-hair text-press-muted hover:border-press-accent/60 hover:text-press-accent',
                  ].join(' ')}
                >
                  {s}×
                </button>
              ))}
            </div>
            {/* Stop */}
            <button
              onClick={() => speech.stop()}
              title="Stop"
              className="ml-auto p-1 rounded text-press-muted hover:text-press-down transition-colors"
            >
              <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24"><path d="M6 6h12v12H6z" /></svg>
            </button>
          </>
        ) : (
          <span className="truncate">
            ~{readingMinutes(content)} min · {providerLabel}
            {settings.provider === 'elevenlabs' && !itemId ? ' (standard until saved)' : ''}
          </span>
        )}
      </div>

      {/* Premium: cost confirmation before anything is generated */}
      {estimate && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-2 border-b-[0.5px] border-press-hair bg-press-accent/[0.05] text-press-body">
          <span>
            Premium audio · {estimate.chars.toLocaleString()} characters · about {formatTtsCost(estimate.estimatedCost)} with {estimate.modelLabel} · {estimate.voiceName}
          </span>
          <span className="ml-auto flex items-center gap-2">
            <button
              onClick={() => void generatePremium()}
              className="px-2.5 py-1 rounded-full bg-press-accent text-white hover:bg-press-accent/90 transition-colors"
            >
              Generate
            </button>
            <button
              onClick={() => { setEstimate(null); playBrowser() }}
              className="px-2.5 py-1 rounded-full border border-press-hair text-press-muted hover:text-press-accent hover:border-press-accent/60 transition-colors"
            >
              Standard voice
            </button>
            <button onClick={() => setEstimate(null)} aria-label="Dismiss" className="px-1 text-press-faint hover:text-press-ink">×</button>
          </span>
        </div>
      )}
      {error && (
        <div className="px-4 py-1.5 border-b-[0.5px] border-press-hair text-press-down">{error}</div>
      )}
    </div>
  )
}

// Wraps an article: while this id is being read aloud, shows the sentence-
// highlighted view (auto-scrolling the active sentence); otherwise renders
// the children (normally a PressArticle).
export function SpokenArticle({ id, children }: { id: string; children: React.ReactNode }) {
  const speech = useSpeech()
  const activeRef = useRef<HTMLSpanElement>(null)
  const isActive = speech.activeId === id && speech.status !== 'loading' && speech.sentences.length > 0

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
