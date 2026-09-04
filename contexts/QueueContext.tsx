'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { useSpeech, type AudioTrack } from '@/contexts/SpeechContext'
import { fetchTtsSettings } from '@/contexts/TtsSettings'
import { buildSpeechScript } from '@/lib/speechScript'
import type { ListenQueueItem, QueueCostSummary } from '@/lib/types'

// The Listen Queue: the one playback system. It owns the ordered list (from
// /api/queue), the current item, auto-advance on the engine's `ended`
// signal, resume state, on-demand premium generation, and the player's
// expanded/collapsed UI state. Mounted in the root layout so playback and
// position survive navigation. Article Listen buttons route through here.

export type QueueKind = 'briefing' | 'digest'

interface QueueContextValue {
  items: ListenQueueItem[]
  unplayed: ListenQueueItem[]
  cost: QueueCostSummary | null
  loading: boolean
  error: string | null
  // The item the player is showing: the one playing, else where you'd resume
  current: ListenQueueItem | null
  currentIndex: number              // 0-based within `unplayed`, -1 if none
  isCurrentActive: boolean          // engine is on the current item (playing/paused/loading)
  expanded: boolean
  setExpanded: (v: boolean) => void
  finished: { count: number } | null
  dismissFinished: () => void
  refresh: () => Promise<void>
  playAll: () => void               // resume where you left off
  playItem: (queueId: string, opts?: { resume?: boolean }) => void
  playFromArticle: (kind: QueueKind, itemId: string) => Promise<void>
  togglePlay: () => void
  next: () => void
  prev: () => void
  stopQueue: () => void
  add: (kind: QueueKind, itemId: string) => Promise<void>
  remove: (queueId: string) => Promise<void>
  reorder: (orderedIds: string[]) => Promise<void>
  find: (kind: QueueKind, itemId: string) => ListenQueueItem | undefined
}

const QueueContext = createContext<QueueContextValue | null>(null)

export const speechIdOf = (item: { kind: QueueKind; item_id: string }) => `${item.kind}:${item.item_id}`

export function QueueProvider({ children }: { children: React.ReactNode }) {
  const speech = useSpeech()
  const [items, setItems] = useState<ListenQueueItem[]>([])
  const [cost, setCost] = useState<QueueCostSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [currentId, setCurrentId] = useState<string | null>(null)
  const [expanded, setExpanded] = useState(false)
  const [finished, setFinished] = useState<{ count: number } | null>(null)
  const [error, setError] = useState<string | null>(null)

  const itemsRef = useRef(items)
  const currentIdRef = useRef(currentId)
  const lastEndedSeq = useRef(0)
  const playedThisSession = useRef(0)
  // Set once the engine reports the current item playing. An `ended` that
  // arrives before that (e.g. from the audio unlock clip) is not a completion.
  const currentStarted = useRef(false)
  useEffect(() => { itemsRef.current = items }, [items])
  useEffect(() => { currentIdRef.current = currentId }, [currentId])

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/queue')
      if (!res.ok) throw new Error('Could not load the listen queue')
      const data = (await res.json()) as { items: ListenQueueItem[]; cost: QueueCostSummary }
      setItems(data.items)
      setCost(data.cost)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load the listen queue')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void refresh() }, [refresh])

  const unplayed = useMemo(() => items.filter((i) => !i.played_at), [items])

  const resumeTarget = useCallback((): ListenQueueItem | null => {
    const list = itemsRef.current.filter((i) => !i.played_at)
    if (list.length === 0) return null
    const touched = list.filter((i) => i.last_played_at)
    if (touched.length) return [...touched].sort((a, b) => (b.last_played_at! > a.last_played_at! ? 1 : -1))[0]
    return list[0]
  }, [])

  const current = useMemo(() => {
    if (currentId) return items.find((i) => i.id === currentId) ?? null
    const list = items.filter((i) => !i.played_at)
    if (list.length === 0) return null
    const touched = list.filter((i) => i.last_played_at)
    return touched.length ? [...touched].sort((a, b) => (b.last_played_at! > a.last_played_at! ? 1 : -1))[0] : list[0]
  }, [items, currentId])
  const currentIndex = current ? unplayed.findIndex((i) => i.id === current.id) : -1
  const isCurrentActive = !!current && speech.activeId === speechIdOf(current) && speech.status !== 'idle'
  const isPlaying = isCurrentActive && speech.status === 'playing'

  // ── Persisting progress ──────────────────────────────────────────────────────
  const saveProgress = useCallback((queueId: string, keepalive = false) => {
    const pos = speech.getPosition()
    void fetch(`/api/queue/${queueId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ progress_sentence: pos.sentence, progress_seconds: Math.round(pos.seconds * 10) / 10 }),
      keepalive,
    }).catch(() => {})
    setItems((prev) => prev.map((i) => (i.id === queueId
      ? { ...i, progress_sentence: pos.sentence, progress_seconds: pos.seconds, last_played_at: new Date().toISOString() }
      : i)))
  }, [speech])

  useEffect(() => {
    if (!isPlaying || !currentId) return
    const id = setInterval(() => saveProgress(currentId), 15_000)
    const onHide = () => { if (document.hidden) saveProgress(currentId, true) }
    const onUnload = () => saveProgress(currentId, true)
    document.addEventListener('visibilitychange', onHide)
    window.addEventListener('pagehide', onUnload)
    return () => {
      clearInterval(id)
      document.removeEventListener('visibilitychange', onHide)
      window.removeEventListener('pagehide', onUnload)
    }
  }, [isPlaying, currentId, saveProgress])

  // Save on pause
  const wasPlaying = useRef(false)
  useEffect(() => {
    if (isPlaying) { wasPlaying.current = true; return }
    if (wasPlaying.current && currentId && speech.status === 'paused') saveProgress(currentId)
    if (speech.status !== 'paused') wasPlaying.current = false
  }, [isPlaying, speech.status, currentId, saveProgress])

  // ── Starting an item ─────────────────────────────────────────────────────────
  // Premium audio is generated on demand — the first time an item is played —
  // never in bulk. Uncached items show the loading state while ElevenLabs
  // generates and caches; a generation failure falls back to the standard
  // voice so the queue keeps moving.
  const startItem = useCallback(async (item: ListenQueueItem, resume: boolean) => {
    setError(null)
    setFinished(null)
    setCurrentId(item.id)
    currentStarted.current = false
    const speechId = speechIdOf(item)
    try {
      const settings = await fetchTtsSettings()
      const res = await fetch(`/api/queue/${item.id}/content`)
      if (!res.ok) throw new Error('This item is no longer available')
      const { content, channelNames } = (await res.json()) as { content: string; channelNames?: string[] }
      const script = buildSpeechScript(content, item.kind, { channelNames })
      const fromSentence = resume ? item.progress_sentence : 0

      if (settings.provider === 'elevenlabs') {
        speech.prepareAudio(speechId, settings.speed)
        const q = new URLSearchParams({ kind: item.kind, id: item.item_id })
        if (settings.elevenLabsVoiceId) q.set('voiceId', settings.elevenLabsVoiceId)
        const er = await fetch(`/api/tts/elevenlabs?${q}`)
        const est = (await er.json()) as { error?: string; configured?: boolean; audio?: AudioTrack | null; voiceId?: string }
        if (!er.ok) throw new Error(est.error || 'Could not check premium audio')
        let track = est.audio ?? null
        if (!track && est.configured) {
          const gen = await fetch('/api/tts/elevenlabs', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ kind: item.kind, id: item.item_id, voiceId: est.voiceId || settings.elevenLabsVoiceId || undefined }),
          })
          const data = (await gen.json()) as { error?: string; audio?: AudioTrack }
          if (!gen.ok || !data.audio) throw new Error(data.error || 'Audio generation failed')
          track = data.audio
          void refresh() // cached flag + cost line
        }
        if (track) {
          speech.playAudio(speechId, track, settings.speed, resume ? item.progress_seconds : 0)
          return
        }
        speech.cancelLoading()
        setError('Premium audio isn\'t configured on the server — using the standard voice.')
      }
      speech.play(speechId, script.text, settings.voiceUri, settings.speed, fromSentence, script.chapters)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not play this item'
      // Premium trouble → standard voice, so the queue keeps moving
      try {
        const settings = await fetchTtsSettings()
        const res = await fetch(`/api/queue/${item.id}/content`)
        const { content, channelNames } = (await res.json()) as { content: string; channelNames?: string[] }
        const script = buildSpeechScript(content, item.kind, { channelNames })
        speech.cancelLoading()
        speech.play(speechId, script.text, settings.voiceUri, settings.speed, resume ? item.progress_sentence : 0, script.chapters)
        setError(`${message} — playing with the standard voice.`)
      } catch {
        speech.cancelLoading()
        setError(message)
      }
    }
  }, [speech, refresh])

  // ── Public controls ──────────────────────────────────────────────────────────
  const playAll = useCallback(() => {
    const target = resumeTarget()
    if (target) void startItem(target, true)
  }, [resumeTarget, startItem])

  const playItem = useCallback((queueId: string, opts?: { resume?: boolean }) => {
    const item = itemsRef.current.find((i) => i.id === queueId)
    if (item) void startItem(item, opts?.resume ?? true)
  }, [startItem])

  // Article Listen buttons: queue it if needed, then play through the queue
  const playFromArticle = useCallback(async (kind: QueueKind, itemId: string) => {
    let item = itemsRef.current.find((i) => i.kind === kind && i.item_id === itemId && !i.played_at)
    if (!item) {
      const res = await fetch('/api/queue', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind, itemId }) })
      if (!res.ok) { setError('Could not add this item to the queue'); return }
      await refresh()
      item = itemsRef.current.find((i) => i.kind === kind && i.item_id === itemId && !i.played_at)
    }
    if (item) void startItem(item, true)
  }, [refresh, startItem])

  const togglePlay = useCallback(() => {
    if (!current) return
    if (isCurrentActive) {
      if (speech.status === 'playing') speech.pause()
      else if (speech.status === 'paused') speech.resume()
      return
    }
    void startItem(current, true)
  }, [current, isCurrentActive, speech, startItem])

  const advance = useCallback((direction: 1 | -1) => {
    const list = itemsRef.current.filter((i) => !i.played_at)
    const cur = currentIdRef.current
    const idx = cur ? list.findIndex((i) => i.id === cur) : -1
    const nxt = list[idx + direction]
    if (nxt) void startItem(nxt, direction === -1)
  }, [startItem])

  const next = useCallback(() => {
    if (currentIdRef.current) saveProgress(currentIdRef.current)
    advance(1)
  }, [advance, saveProgress])
  const prev = useCallback(() => advance(-1), [advance])

  const stopQueue = useCallback(() => {
    if (currentIdRef.current) saveProgress(currentIdRef.current)
    speech.stop()
    setCurrentId(null)
  }, [speech, saveProgress])

  // Remember that the current item genuinely started playing
  useEffect(() => {
    if (!current || speech.status !== 'playing' || speech.activeId !== speechIdOf(current)) return
    currentStarted.current = true
  }, [current, speech.status, speech.activeId])

  // ── Auto-advance on natural end ──────────────────────────────────────────────
  useEffect(() => {
    const ended = speech.ended
    if (!ended || ended.seq === lastEndedSeq.current) return
    lastEndedSeq.current = ended.seq
    const cur = currentIdRef.current
    const item = cur ? itemsRef.current.find((i) => i.id === cur) : null
    if (!item || speechIdOf(item) !== ended.id) return
    if (!currentStarted.current) return // never reached playback — not a completion

    // Completed: mark played (the server also marks it read), then move on
    playedThisSession.current += 1
    setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, played_at: new Date().toISOString() } : i)))
    void fetch(`/api/queue/${item.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ played: true }),
    }).catch(() => {})

    const list = itemsRef.current.filter((i) => !i.played_at && i.id !== item.id)
    const nxt = list.find((i) => i.position > item.position) ?? list[0] ?? null
    if (nxt) {
      void startItem(nxt, true)
    } else {
      setCurrentId(null)
      setFinished({ count: playedThisSession.current })
      playedThisSession.current = 0
    }
  }, [speech.ended, startItem])

  // ── Mutations ────────────────────────────────────────────────────────────────
  const add = useCallback(async (kind: QueueKind, itemId: string) => {
    await fetch('/api/queue', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind, itemId }) })
    setFinished(null)
    await refresh()
  }, [refresh])

  const remove = useCallback(async (queueId: string) => {
    setItems((prev) => prev.filter((i) => i.id !== queueId))
    if (currentIdRef.current === queueId) { speech.stop(); setCurrentId(null) }
    await fetch(`/api/queue/${queueId}`, { method: 'DELETE' })
    await refresh()
  }, [refresh, speech])

  const reorder = useCallback(async (orderedIds: string[]) => {
    setItems((prev) => {
      const pos = new Map(orderedIds.map((id, i) => [id, i + 1]))
      return [...prev].map((i) => (pos.has(i.id) ? { ...i, position: pos.get(i.id)! } : i)).sort((a, b) => a.position - b.position)
    })
    await fetch('/api/queue', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ orderedIds }) })
  }, [])

  const find = useCallback((kind: QueueKind, itemId: string) =>
    itemsRef.current.find((i) => i.kind === kind && i.item_id === itemId && !i.played_at), [])

  const dismissFinished = useCallback(() => setFinished(null), [])

  return (
    <QueueContext.Provider value={{
      items, unplayed, cost, loading, error,
      current, currentIndex, isCurrentActive,
      expanded, setExpanded, finished, dismissFinished,
      refresh, playAll, playItem, playFromArticle, togglePlay, next, prev, stopQueue,
      add, remove, reorder, find,
    }}>
      {children}
    </QueueContext.Provider>
  )
}

export function useQueue(): QueueContextValue {
  const ctx = useContext(QueueContext)
  if (!ctx) throw new Error('useQueue must be used within <QueueProvider>')
  return ctx
}
