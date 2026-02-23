'use client'

import { createContext, useContext, useRef, useState, useCallback, useEffect } from 'react'
import { splitSentences } from '@/lib/speech'

// ── State shape ───────────────────────────────────────────────────────────────

interface SpeechState {
  activeId: string | null
  status: 'idle' | 'playing' | 'paused'
  sentences: string[]
  sentenceStarts: number[]   // char offsets in the ORIGINAL full text
  currentCharIndex: number   // charIndex + charIndexOffset (approx position in original text)
  charIndexOffset: number    // sentenceStarts[fromSentence] at the time we started/resumed
  rate: number
  voiceUri: string | null    // stored so resume/setRate can reuse the same voice
}

interface SpeechActions {
  play: (id: string, plainText: string, voiceUri?: string | null, rate?: number) => void
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
  sentences: [],
  sentenceStarts: [],
  currentCharIndex: 0,
  charIndexOffset: 0,
  rate: 1,
  voiceUri: null,
}

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

function resolveVoice(voiceUri: string | null): SpeechSynthesisVoice | null {
  if (!voiceUri || typeof window === 'undefined') return null
  return window.speechSynthesis.getVoices().find((v) => v.voiceURI === voiceUri) ?? null
}

// ── Provider ──────────────────────────────────────────────────────────────────

export function SpeechProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<SpeechState>(INITIAL_STATE)
  const stateRef = useRef<SpeechState>(INITIAL_STATE)

  // Keep stateRef in sync for use inside callbacks without stale closure issues
  useEffect(() => { stateRef.current = state }, [state])

  // ── Core: cancel any running utterance ──────────────────────────────────────
  const cancelUtterance = useCallback(() => {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel()
    }
  }, [])

  // ── Core: build + speak an utterance from a sentence index ──────────────────
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

  // ── play ─────────────────────────────────────────────────────────────────────
  const play = useCallback((
    id: string,
    plainText: string,
    voiceUri?: string | null,
    rate?: number,
  ) => {
    cancelUtterance()
    const { sentences, starts } = splitSentences(plainText)
    const effectiveRate = rate ?? 1
    const effectiveVoice = voiceUri ?? null

    setState({
      activeId: id,
      status: 'playing',
      sentences,
      sentenceStarts: starts,
      currentCharIndex: 0,
      charIndexOffset: 0,
      rate: effectiveRate,
      voiceUri: effectiveVoice,
    })

    speakFrom(sentences, starts, 0, effectiveVoice, effectiveRate)
  }, [cancelUtterance, speakFrom])

  // ── pause (Android-safe: cancel + remember position) ─────────────────────────
  const pause = useCallback(() => {
    cancelUtterance()
    setState((prev) =>
      prev.status === 'playing' ? { ...prev, status: 'paused' } : prev
    )
  }, [cancelUtterance])

  // ── resume ────────────────────────────────────────────────────────────────────
  const resume = useCallback(() => {
    const cur = stateRef.current
    if (cur.status !== 'paused' || cur.sentences.length === 0) return

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

  // ── stop ──────────────────────────────────────────────────────────────────────
  const stop = useCallback(() => {
    cancelUtterance()
    setState(INITIAL_STATE)
  }, [cancelUtterance])

  // ── setRate (restarts from current sentence at new speed) ─────────────────────
  const setRate = useCallback((rate: number) => {
    const cur = stateRef.current
    if (cur.status === 'idle') {
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

  // ── Stop on page hide (avoids ghost audio on tab switch) ─────────────────────
  useEffect(() => {
    function onHide() {
      if (document.hidden) {
        cancelUtterance()
        setState(INITIAL_STATE)
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
