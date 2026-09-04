'use client'

import { useEffect, useState } from 'react'
import type { TtsProvider } from '@/lib/types'

// The profile's TTS choices, as the player and the queue consume them.
export interface TtsSettings {
  provider: TtsProvider
  voiceUri: string | null          // browser voice
  elevenLabsVoiceId: string | null
  speed: number
}

export const DEFAULT_TTS_SETTINGS: TtsSettings = { provider: 'browser', voiceUri: null, elevenLabsVoiceId: null, speed: 1 }

// Surfaces that don't already hold the profile's settings fetch them once;
// cached briefly so a page of 30 entries makes one request.
let cache: { at: number; promise: Promise<TtsSettings> } | null = null

export function fetchTtsSettings(): Promise<TtsSettings> {
  if (cache && Date.now() - cache.at < 60_000) return cache.promise
  const promise = fetch('/api/settings')
    .then((r) => r.json())
    .then((d) => ({
      provider: (d.tts_provider === 'elevenlabs' ? 'elevenlabs' : 'browser') as TtsProvider,
      voiceUri: d.tts_voice ?? null,
      elevenLabsVoiceId: d.tts_elevenlabs_voice_id ?? null,
      speed: Number(d.tts_speed) || 1,
    }))
    .catch(() => DEFAULT_TTS_SETTINGS)
  cache = { at: Date.now(), promise }
  return promise
}

export function invalidateTtsSettings() { cache = null }

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
