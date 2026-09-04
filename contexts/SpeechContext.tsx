'use client'

import { createContext, useContext, useRef, useState, useCallback, useEffect } from 'react'
import { splitSentences } from '@/lib/speech'
import type { TtsProvider } from '@/lib/types'

// The transport engine. Two backends behind one interface:
//   browser    — SpeechSynthesis utterances; sentence position from onboundary
//   elevenlabs — an <audio> element playing generated MP3; sentence position
//                from the per-sentence start times returned with the audio
// The Listen Queue (contexts/QueueContext) sits above this and is the only
// thing that starts items; article bars and players talk to the queue.
// This context exposes: status, sentence index, progress (for scrubbing),
// seek/skip, an `ended` signal, and start offsets for resume.

// ── State shape ───────────────────────────────────────────────────────────────

interface SpeechState {
  activeId: string | null
  status: 'idle' | 'loading' | 'playing' | 'paused'
  provider: TtsProvider
  sentences: string[]
  sentenceStarts: number[]   // browser: char offsets in the full text; audio: sentence indices
  sentenceTimes: number[]    // audio only: seconds each sentence starts at
  currentCharIndex: number   // browser: charIndex + offset; audio: sentence index
  charIndexOffset: number    // browser: sentenceStarts[fromSentence] at start/resume
  rate: number
  voiceUri: string | null    // browser voice, reused on resume/setRate
  audioTime: number          // audio only, throttled to ~2 updates/s
  audioDuration: number      // audio only (0 until metadata loads)
  // Set (with a fresh seq) each time an item plays to its natural end —
  // never on stop()/pause(). The queue watches this to advance.
  ended: { id: string; seq: number } | null
}

export interface AudioTrack {
  url: string
  sentences: string[]
  sentenceTimes: number[]
}

export interface SpeechPosition {
  sentence: number   // current sentence index (both providers)
  seconds: number    // audio time (elevenlabs) — 0 for browser
}

export interface SpeechProgress {
  fraction: number   // 0..1
  elapsed: number    // audio: seconds; browser: sentences done
  duration: number   // audio: seconds; browser: sentence count
  unit: 'seconds' | 'sentences'
}

interface SpeechActions {
  play: (id: string, plainText: string, voiceUri?: string | null, rate?: number, fromSentence?: number) => void
  // Premium flow: prepareAudio() synchronously inside a user gesture (shows
  // the loading state and unlocks audio on iOS), then playAudio() once the
  // track URL is back, or cancelLoading() on failure.
  prepareAudio: (id: string, rate?: number) => void
  playAudio: (id: string, track: AudioTrack, rate?: number, fromSeconds?: number) => void
  cancelLoading: () => void
  pause: () => void
  resume: () => void
  stop: () => void
  setRate: (rate: number) => void
  seekFraction: (fraction: number) => void   // scrub
  skip: (seconds: number) => void            // ±15s (browser: ±2 sentences)
  getPosition: () => SpeechPosition
  progress: SpeechProgress
  currentSentenceIndex: number
}

type SpeechContextValue = SpeechState & SpeechActions

// ── Context ───────────────────────────────────────────────────────────────────

const SpeechContext = createContext<SpeechContextValue | null>(null)

const INITIAL_STATE: SpeechState = {
  activeId: null,
  status: 'idle',
  provider: 'browser',
  sentences: [],
  sentenceStarts: [],
  sentenceTimes: [],
  currentCharIndex: 0,
  charIndexOffset: 0,
  rate: 1,
  voiceUri: null,
  audioTime: 0,
  audioDuration: 0,
  ended: null,
}

// A 0-sample WAV: playing it inside a user gesture unlocks the element for
// the later, asynchronous real playback (iOS Safari autoplay policy).
const SILENT_WAV = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YQAAAAA='

// ── Helpers ───────────────────────────────────────────────────────────────────

function getSentenceIndex(sentenceStarts: number[], charIndex: number): number {
  if (sentenceStarts.length === 0) return 0
  let idx = 0
  for (let i = 0; i < sentenceStarts.length; i++) {
    if (sentenceStarts[i] <= charIndex) idx = i
    else break
  }
  return idx
}

function sentenceIndexAtTime(sentenceTimes: number[], t: number): number {
  let idx = 0
  for (let i = 0; i < sentenceTimes.length; i++) {
    if (sentenceTimes[i] <= t + 0.05) idx = i
    else break
  }
  return idx
}

function resolveVoice(voiceUri: string | null): SpeechSynthesisVoice | null {
  if (!voiceUri || typeof window === 'undefined') return null
  return window.speechSynthesis.getVoices().find((v) => v.voiceURI === voiceUri) ?? null
}

// Reset to idle but keep the rate and record the natural end of `id`
function endedState(prev: SpeechState, id: string): SpeechState {
  return { ...INITIAL_STATE, rate: prev.rate, ended: { id, seq: (prev.ended?.seq ?? 0) + 1 } }
}

function idleKeeping(prev: SpeechState): SpeechState {
  return { ...INITIAL_STATE, rate: prev.rate, ended: prev.ended }
}

// ── Provider ──────────────────────────────────────────────────────────────────

export function SpeechProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<SpeechState>(INITIAL_STATE)
  const stateRef = useRef<SpeechState>(INITIAL_STATE)
  const audioRef = useRef<HTMLAudioElement | null>(null)

  // Keep stateRef in sync for use inside callbacks without stale closure issues
  useEffect(() => { stateRef.current = state }, [state])

  // ── Browser: cancel any running utterance ───────────────────────────────────
  const cancelUtterance = useCallback(() => {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel()
    }
  }, [])

  // ── Audio element (created lazily, one per app) ─────────────────────────────
  const getAudio = useCallback((): HTMLAudioElement => {
    if (audioRef.current) return audioRef.current
    const audio = new Audio()
    audio.preload = 'auto'
    audio.addEventListener('loadedmetadata', () => {
      if (Number.isFinite(audio.duration)) setState((prev) => ({ ...prev, audioDuration: audio.duration }))
    })
    audio.addEventListener('timeupdate', () => {
      const cur = stateRef.current
      if (cur.provider !== 'elevenlabs' || cur.status === 'idle' || cur.status === 'loading') return
      const idx = sentenceIndexAtTime(cur.sentenceTimes, audio.currentTime)
      const t = Math.round(audio.currentTime * 2) / 2
      if (idx !== cur.currentCharIndex || t !== cur.audioTime) {
        setState((prev) => ({ ...prev, currentCharIndex: idx, audioTime: t }))
      }
    })
    audio.addEventListener('ended', () => {
      setState((prev) =>
        prev.provider === 'elevenlabs' && prev.status !== 'idle' && prev.activeId
          ? endedState(prev, prev.activeId)
          : prev,
      )
    })
    audio.addEventListener('error', () => {
      const cur = stateRef.current
      // Clearing src on stop() also fires 'error' — only real playback matters
      if (cur.provider !== 'elevenlabs' || cur.status === 'idle' || !audio.src || audio.src.startsWith('data:')) return
      console.warn('[speech] audio playback error', audio.error?.message)
      setState(idleKeeping)
    })
    audioRef.current = audio
    return audio
  }, [])

  const stopAudio = useCallback(() => {
    const audio = audioRef.current
    if (!audio) return
    audio.pause()
    audio.removeAttribute('src')
    audio.load()
  }, [])

  // ── Browser: build + speak an utterance from a sentence index ───────────────
  const speakFrom = useCallback((
    id: string,
    sentences: string[],
    sentenceStarts: number[],
    fromIdx: number,
    voiceUri: string | null,
    rate: number,
  ) => {
    cancelUtterance()
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return

    const text = sentences.slice(fromIdx).join(' ')
    if (!text.trim()) {
      setState((prev) => endedState(prev, id))
      return
    }

    const offset = sentenceStarts[fromIdx] ?? 0
    const utterance = new SpeechSynthesisUtterance(text)
    utterance.rate = rate
    const voice = resolveVoice(voiceUri)
    if (voice) utterance.voice = voice

    utterance.onboundary = (event) => {
      setState((prev) => ({ ...prev, currentCharIndex: event.charIndex + offset }))
    }
    utterance.onend = () => {
      setState((prev) => (prev.status === 'playing' && prev.activeId === id ? endedState(prev, id) : prev))
    }
    utterance.onerror = (event) => {
      // 'interrupted' is fired when we cancel() — not an actual error
      if (event.error === 'interrupted' || event.error === 'canceled') return
      setState((prev) => ({ ...prev, status: 'idle', activeId: null }))
    }

    window.speechSynthesis.speak(utterance)
  }, [cancelUtterance])

  // Restart the browser voice from a sentence (scrub/skip/rate)
  const restartBrowserAt = useCallback((sentIdx: number) => {
    const cur = stateRef.current
    if (cur.provider !== 'browser' || !cur.activeId || cur.sentences.length === 0) return
    const idx = Math.min(Math.max(0, sentIdx), cur.sentences.length - 1)
    const offset = cur.sentenceStarts[idx] ?? 0
    const resumePlaying = cur.status === 'playing'
    cancelUtterance()
    setState((prev) => ({ ...prev, charIndexOffset: offset, currentCharIndex: offset, status: resumePlaying ? 'playing' : 'paused' }))
    if (resumePlaying) speakFrom(cur.activeId, cur.sentences, cur.sentenceStarts, idx, cur.voiceUri, cur.rate)
  }, [cancelUtterance, speakFrom])

  // ── play (browser) ───────────────────────────────────────────────────────────
  const play = useCallback((
    id: string,
    plainText: string,
    voiceUri?: string | null,
    rate?: number,
    fromSentence = 0,
  ) => {
    cancelUtterance()
    stopAudio()
    const { sentences, starts } = splitSentences(plainText)
    const effectiveRate = rate ?? 1
    const effectiveVoice = voiceUri ?? null
    const fromIdx = Math.min(Math.max(0, fromSentence), Math.max(0, sentences.length - 1))
    const offset = starts[fromIdx] ?? 0

    setState((prev) => ({
      ...INITIAL_STATE,
      ended: prev.ended,
      activeId: id,
      status: 'playing',
      provider: 'browser',
      sentences,
      sentenceStarts: starts,
      currentCharIndex: offset,
      charIndexOffset: offset,
      rate: effectiveRate,
      voiceUri: effectiveVoice,
    }))

    speakFrom(id, sentences, starts, fromIdx, effectiveVoice, effectiveRate)
  }, [cancelUtterance, speakFrom, stopAudio])

  // ── prepareAudio (elevenlabs, call synchronously in the click handler) ──────
  const prepareAudio = useCallback((id: string, rate?: number) => {
    cancelUtterance()
    const audio = getAudio()
    audio.pause()
    audio.src = SILENT_WAV
    audio.play().catch(() => {})
    setState((prev) => ({
      ...INITIAL_STATE,
      ended: prev.ended,
      activeId: id,
      status: 'loading',
      provider: 'elevenlabs',
      rate: rate ?? 1,
    }))
  }, [cancelUtterance, getAudio])

  // ── playAudio (elevenlabs) ───────────────────────────────────────────────────
  const playAudio = useCallback((id: string, track: AudioTrack, rate?: number, fromSeconds = 0) => {
    cancelUtterance()
    const audio = getAudio()
    const effectiveRate = rate ?? stateRef.current.rate ?? 1
    const startIdx = fromSeconds > 0 ? sentenceIndexAtTime(track.sentenceTimes, fromSeconds) : 0
    setState((prev) => ({
      ...INITIAL_STATE,
      ended: prev.ended,
      activeId: id,
      status: 'playing',
      provider: 'elevenlabs',
      sentences: track.sentences,
      sentenceStarts: track.sentences.map((_, i) => i),
      sentenceTimes: track.sentenceTimes,
      currentCharIndex: startIdx,
      audioTime: fromSeconds,
      rate: effectiveRate,
    }))
    audio.src = track.url
    audio.playbackRate = effectiveRate
    if (fromSeconds > 0) {
      audio.addEventListener('loadedmetadata', () => {
        try { audio.currentTime = Math.min(fromSeconds, Math.max(0, audio.duration - 1)) } catch { /* not seekable yet */ }
      }, { once: true })
    }
    audio.play().catch((err) => {
      console.warn('[speech] audio.play() rejected', err)
      setState(idleKeeping)
    })
  }, [cancelUtterance, getAudio])

  const cancelLoading = useCallback(() => {
    stopAudio()
    setState((prev) => (prev.status === 'loading' ? idleKeeping(prev) : prev))
  }, [stopAudio])

  // ── pause / resume / stop ───────────────────────────────────────────────────
  const pause = useCallback(() => {
    const cur = stateRef.current
    if (cur.provider === 'elevenlabs') audioRef.current?.pause()
    else cancelUtterance() // Android-safe: cancel + remember position
    setState((prev) => (prev.status === 'playing' ? { ...prev, status: 'paused' } : prev))
  }, [cancelUtterance])

  const resume = useCallback(() => {
    const cur = stateRef.current
    if (cur.status !== 'paused' || !cur.activeId) return
    if (cur.provider === 'elevenlabs') {
      setState((prev) => ({ ...prev, status: 'playing' }))
      audioRef.current?.play().catch(() => {})
      return
    }
    if (cur.sentences.length === 0) return
    const sentIdx = getSentenceIndex(cur.sentenceStarts, cur.currentCharIndex)
    const offset = cur.sentenceStarts[sentIdx] ?? 0
    setState((prev) => ({ ...prev, status: 'playing', charIndexOffset: offset, currentCharIndex: offset }))
    speakFrom(cur.activeId, cur.sentences, cur.sentenceStarts, sentIdx, cur.voiceUri, cur.rate)
  }, [speakFrom])

  const stop = useCallback(() => {
    cancelUtterance()
    stopAudio()
    setState(idleKeeping)
  }, [cancelUtterance, stopAudio])

  // ── setRate: audio changes live; browser restarts from the current sentence ─
  const setRate = useCallback((rate: number) => {
    const cur = stateRef.current
    if (cur.provider === 'elevenlabs' && audioRef.current) audioRef.current.playbackRate = rate
    setState((prev) => ({ ...prev, rate }))
    if (cur.provider === 'browser' && cur.status === 'playing' && cur.activeId) {
      const sentIdx = getSentenceIndex(cur.sentenceStarts, cur.currentCharIndex)
      cancelUtterance()
      speakFrom(cur.activeId, cur.sentences, cur.sentenceStarts, sentIdx, cur.voiceUri, rate)
    }
  }, [cancelUtterance, speakFrom])

  // ── seek / skip ─────────────────────────────────────────────────────────────
  const seekFraction = useCallback((fraction: number) => {
    const cur = stateRef.current
    const f = Math.min(1, Math.max(0, fraction))
    if (cur.provider === 'elevenlabs') {
      const audio = audioRef.current
      if (!audio || !Number.isFinite(audio.duration)) return
      audio.currentTime = f * audio.duration
      setState((prev) => ({ ...prev, audioTime: audio.currentTime, currentCharIndex: sentenceIndexAtTime(prev.sentenceTimes, audio.currentTime) }))
      return
    }
    restartBrowserAt(Math.round(f * Math.max(0, cur.sentences.length - 1)))
  }, [restartBrowserAt])

  const skip = useCallback((seconds: number) => {
    const cur = stateRef.current
    if (cur.provider === 'elevenlabs') {
      const audio = audioRef.current
      if (!audio) return
      audio.currentTime = Math.max(0, Math.min((audio.duration || Infinity) - 0.5, audio.currentTime + seconds))
      setState((prev) => ({ ...prev, audioTime: audio.currentTime, currentCharIndex: sentenceIndexAtTime(prev.sentenceTimes, audio.currentTime) }))
      return
    }
    // No clock for the browser voice: two sentences ≈ 15 seconds of speech
    const sentIdx = getSentenceIndex(cur.sentenceStarts, cur.currentCharIndex)
    restartBrowserAt(sentIdx + (seconds >= 0 ? 2 : -2))
  }, [restartBrowserAt])

  // ── getPosition (for the queue's resume state) ──────────────────────────────
  const getPosition = useCallback((): SpeechPosition => {
    const cur = stateRef.current
    const sentence = getSentenceIndex(cur.sentenceStarts, cur.currentCharIndex)
    const seconds = cur.provider === 'elevenlabs' ? (audioRef.current?.currentTime ?? 0) : 0
    return { sentence, seconds }
  }, [])

  // ── Browser TTS stops on page hide (avoids ghost audio on tab switch). ──────
  // Premium audio keeps playing — screen-off listening is the point of it.
  useEffect(() => {
    function onHide() {
      if (document.hidden && stateRef.current.provider === 'browser' && stateRef.current.status !== 'idle') {
        cancelUtterance()
        setState(idleKeeping)
      }
    }
    document.addEventListener('visibilitychange', onHide)
    return () => document.removeEventListener('visibilitychange', onHide)
  }, [cancelUtterance])

  // ── Derived ─────────────────────────────────────────────────────────────────
  const currentSentenceIndex = getSentenceIndex(state.sentenceStarts, state.currentCharIndex)
  const progress: SpeechProgress = state.provider === 'elevenlabs'
    ? {
        unit: 'seconds',
        elapsed: state.audioTime,
        duration: state.audioDuration,
        fraction: state.audioDuration > 0 ? Math.min(1, state.audioTime / state.audioDuration) : 0,
      }
    : {
        unit: 'sentences',
        elapsed: currentSentenceIndex,
        duration: state.sentences.length,
        fraction: state.sentences.length > 0 ? currentSentenceIndex / state.sentences.length : 0,
      }

  return (
    <SpeechContext.Provider value={{
      ...state,
      play,
      prepareAudio,
      playAudio,
      cancelLoading,
      pause,
      resume,
      stop,
      setRate,
      seekFraction,
      skip,
      getPosition,
      progress,
      currentSentenceIndex,
    }}>
      {children}
    </SpeechContext.Provider>
  )
}

export function useSpeech(): SpeechContextValue {
  const ctx = useContext(SpeechContext)
  if (!ctx) throw new Error('useSpeech must be used within <SpeechProvider>')
  return ctx
}
