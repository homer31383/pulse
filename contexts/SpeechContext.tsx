'use client'

import { createContext, useContext, useRef, useState, useCallback, useEffect } from 'react'
import { splitSentences } from '@/lib/speech'
import type { TtsProvider } from '@/lib/types'

// One player context, two backends:
//   browser    — SpeechSynthesis utterances; sentence position from onboundary
//   elevenlabs — an <audio> element playing generated MP3; sentence position
//                from the per-sentence start times returned with the audio
// The card only sees play/pause/resume/stop/setRate + currentSentenceIndex.

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
}

export interface AudioTrack {
  url: string
  sentences: string[]
  sentenceTimes: number[]
}

interface SpeechActions {
  play: (id: string, plainText: string, voiceUri?: string | null, rate?: number) => void
  // Premium flow: prepareAudio() inside the click handler (shows the loading
  // state and unlocks audio playback on iOS), then playAudio() once the
  // track URL is back, or cancelLoading() on failure.
  prepareAudio: (id: string, rate?: number) => void
  playAudio: (id: string, track: AudioTrack, rate?: number) => void
  cancelLoading: () => void
  pause: () => void
  resume: () => void
  stop: () => void
  setRate: (rate: number) => void
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
    audio.addEventListener('timeupdate', () => {
      const cur = stateRef.current
      if (cur.provider !== 'elevenlabs' || cur.status !== 'playing') return
      const idx = sentenceIndexAtTime(cur.sentenceTimes, audio.currentTime)
      if (idx !== cur.currentCharIndex) setState((prev) => ({ ...prev, currentCharIndex: idx }))
    })
    audio.addEventListener('ended', () => {
      setState((prev) => (prev.provider === 'elevenlabs' && prev.status !== 'idle' ? { ...INITIAL_STATE, rate: prev.rate } : prev))
    })
    audio.addEventListener('error', () => {
      const cur = stateRef.current
      // Clearing src on stop() also fires 'error' — only real playback matters
      if (cur.provider !== 'elevenlabs' || cur.status === 'idle' || !audio.src || audio.src.startsWith('data:')) return
      console.warn('[speech] audio playback error', audio.error?.message)
      setState((prev) => ({ ...INITIAL_STATE, rate: prev.rate }))
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
      setState((prev) => ({ ...prev, status: 'idle', activeId: null }))
      return
    }

    const offset = sentenceStarts[fromIdx] ?? 0
    const utterance = new SpeechSynthesisUtterance(text)
    utterance.rate = rate
    const voice = resolveVoice(voiceUri)
    if (voice) utterance.voice = voice

    utterance.onboundary = (event) => {
      setState((prev) => ({
        ...prev,
        currentCharIndex: event.charIndex + offset,
      }))
    }

    utterance.onend = () => {
      setState((prev) =>
        prev.status === 'playing'
          ? { ...prev, status: 'idle', activeId: null }
          : prev
      )
    }

    utterance.onerror = (event) => {
      // 'interrupted' is fired when we cancel() — not an actual error
      if (event.error === 'interrupted' || event.error === 'canceled') return
      setState((prev) => ({ ...prev, status: 'idle', activeId: null }))
    }

    window.speechSynthesis.speak(utterance)
  }, [cancelUtterance])

  // ── play (browser) ───────────────────────────────────────────────────────────
  const play = useCallback((
    id: string,
    plainText: string,
    voiceUri?: string | null,
    rate?: number,
  ) => {
    cancelUtterance()
    stopAudio()
    const { sentences, starts } = splitSentences(plainText)
    const effectiveRate = rate ?? 1
    const effectiveVoice = voiceUri ?? null

    setState({
      activeId: id,
      status: 'playing',
      provider: 'browser',
      sentences,
      sentenceStarts: starts,
      sentenceTimes: [],
      currentCharIndex: 0,
      charIndexOffset: 0,
      rate: effectiveRate,
      voiceUri: effectiveVoice,
    })

    speakFrom(sentences, starts, 0, effectiveVoice, effectiveRate)
  }, [cancelUtterance, speakFrom, stopAudio])

  // ── prepareAudio (elevenlabs, call synchronously in the click handler) ──────
  const prepareAudio = useCallback((id: string, rate?: number) => {
    cancelUtterance()
    const audio = getAudio()
    audio.pause()
    audio.src = SILENT_WAV
    audio.play().catch(() => {})
    setState({
      ...INITIAL_STATE,
      activeId: id,
      status: 'loading',
      provider: 'elevenlabs',
      rate: rate ?? 1,
    })
  }, [cancelUtterance, getAudio])

  // ── playAudio (elevenlabs) ───────────────────────────────────────────────────
  const playAudio = useCallback((id: string, track: AudioTrack, rate?: number) => {
    cancelUtterance()
    const audio = getAudio()
    const effectiveRate = rate ?? stateRef.current.rate ?? 1
    setState({
      activeId: id,
      status: 'playing',
      provider: 'elevenlabs',
      sentences: track.sentences,
      sentenceStarts: track.sentences.map((_, i) => i),
      sentenceTimes: track.sentenceTimes,
      currentCharIndex: 0,
      charIndexOffset: 0,
      rate: effectiveRate,
      voiceUri: null,
    })
    audio.src = track.url
    audio.playbackRate = effectiveRate
    audio.play().catch((err) => {
      console.warn('[speech] audio.play() rejected', err)
      setState((prev) => ({ ...INITIAL_STATE, rate: prev.rate }))
    })
  }, [cancelUtterance, getAudio])

  const cancelLoading = useCallback(() => {
    stopAudio()
    setState((prev) => (prev.status === 'loading' ? { ...INITIAL_STATE, rate: prev.rate } : prev))
  }, [stopAudio])

  // ── pause ───────────────────────────────────────────────────────────────────
  const pause = useCallback(() => {
    const cur = stateRef.current
    if (cur.provider === 'elevenlabs') {
      audioRef.current?.pause()
    } else {
      cancelUtterance() // Android-safe: cancel + remember position
    }
    setState((prev) =>
      prev.status === 'playing' ? { ...prev, status: 'paused' } : prev
    )
  }, [cancelUtterance])

  // ── resume ──────────────────────────────────────────────────────────────────
  const resume = useCallback(() => {
    const cur = stateRef.current
    if (cur.status !== 'paused') return

    if (cur.provider === 'elevenlabs') {
      setState((prev) => ({ ...prev, status: 'playing' }))
      audioRef.current?.play().catch(() => {})
      return
    }

    if (cur.sentences.length === 0) return
    const sentIdx = getSentenceIndex(cur.sentenceStarts, cur.currentCharIndex)
    const offset = cur.sentenceStarts[sentIdx] ?? 0

    setState((prev) => ({
      ...prev,
      status: 'playing',
      charIndexOffset: offset,
      currentCharIndex: offset,
    }))

    speakFrom(cur.sentences, cur.sentenceStarts, sentIdx, cur.voiceUri, cur.rate)
  }, [speakFrom])

  // ── stop ────────────────────────────────────────────────────────────────────
  const stop = useCallback(() => {
    cancelUtterance()
    stopAudio()
    setState((prev) => ({ ...INITIAL_STATE, rate: prev.rate }))
  }, [cancelUtterance, stopAudio])

  // ── setRate ─────────────────────────────────────────────────────────────────
  // audio: live playbackRate change (no regeneration, cache stays one object)
  // browser: restarts from the current sentence at the new speed
  const setRate = useCallback((rate: number) => {
    const cur = stateRef.current
    if (cur.status === 'idle' || cur.status === 'loading') {
      setState((prev) => ({ ...prev, rate }))
      return
    }

    if (cur.provider === 'elevenlabs') {
      if (audioRef.current) audioRef.current.playbackRate = rate
      setState((prev) => ({ ...prev, rate }))
      return
    }

    const sentIdx = getSentenceIndex(cur.sentenceStarts, cur.currentCharIndex)
    const offset = cur.sentenceStarts[sentIdx] ?? 0

    cancelUtterance()
    setState((prev) => ({
      ...prev,
      rate,
      status: 'playing',
      charIndexOffset: offset,
      currentCharIndex: offset,
    }))

    speakFrom(cur.sentences, cur.sentenceStarts, sentIdx, cur.voiceUri, rate)
  }, [cancelUtterance, speakFrom])

  // ── Browser TTS stops on page hide (avoids ghost audio on tab switch). ──────
  // Premium audio keeps playing — screen-off listening is the point of it.
  useEffect(() => {
    function onHide() {
      if (document.hidden && stateRef.current.provider === 'browser' && stateRef.current.status !== 'idle') {
        cancelUtterance()
        setState((prev) => ({ ...INITIAL_STATE, rate: prev.rate }))
      }
    }
    document.addEventListener('visibilitychange', onHide)
    return () => document.removeEventListener('visibilitychange', onHide)
  }, [cancelUtterance])

  // ── Derived: current sentence index ──────────────────────────────────────────
  const currentSentenceIndex = getSentenceIndex(state.sentenceStarts, state.currentCharIndex)

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
