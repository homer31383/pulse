'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { formatCost, formatTokens } from '@/lib/cost'
import { stripMarkdown } from '@/lib/speech'
import { useSpeech } from '@/contexts/SpeechContext'
import type { BriefingState, ConversationMessage } from '@/lib/types'

const TTS_SPEEDS = [0.75, 1, 1.25, 1.5, 2] as const

interface BriefingCardProps {
  briefing: BriefingState
  highlightsEnabled?: boolean
  sharingEnabled?: boolean
  feedbackEnabled?: boolean
  discussEnabled?: boolean
  ttsEnabled?: boolean
  defaultVoice?: string | null
  defaultSpeed?: number
  sheetMode?: boolean
}

function readingTime(content: string): string {
  const words = content.trim().split(/\s+/).filter(Boolean).length
  const minutes = Math.max(1, Math.round(words / 200))
  return `~${minutes} min read`
}

const SUGGESTED_QUESTIONS = [
  'What\'s the most significant development here?',
  'What could happen next?',
  'Give me more background context',
]

export function BriefingCard({
  briefing,
  highlightsEnabled = false,
  sharingEnabled = false,
  feedbackEnabled = false,
  discussEnabled = false,
  ttsEnabled = false,
  defaultVoice = null,
  defaultSpeed = 1,
  sheetMode = false,
}: BriefingCardProps) {
  const contentRef = useRef<HTMLDivElement>(null)
  const activeSentenceRef = useRef<HTMLSpanElement>(null)
  const isDone = briefing.status === 'done'
  const hasId = !!briefing.briefingId

  // ── TTS ───────────────────────────────────────────────────────────────────
  const speech = useSpeech()
  const cardId = briefing.briefingId ?? briefing.channelId
  const isActive = speech.activeId === cardId
  const isPlaying = isActive && speech.status === 'playing'
  const isPaused = isActive && speech.status === 'paused'

  function handleTtsPlayPause() {
    if (!isDone || !briefing.content) return
    if (!isActive) {
      const plain = stripMarkdown(briefing.content)
      speech.play(cardId, plain, defaultVoice, defaultSpeed)
    } else if (isPlaying) {
      speech.pause()
    } else if (isPaused) {
      speech.resume()
    }
  }

  // Auto-scroll active sentence into view
  useEffect(() => {
    if (isActive && activeSentenceRef.current) {
      activeSentenceRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    }
  }, [isActive, speech.currentSentenceIndex])

  // ── Highlight / clip ──────────────────────────────────────────────────────
  const [clipText, setClipText] = useState('')
  const [clipPos, setClipPos] = useState({ top: 0, left: 0 })
  const [clipSaved, setClipSaved] = useState(false)

  const handleMouseUp = useCallback(() => {
    if (!highlightsEnabled) return
    const sel = window.getSelection()
    const text = sel?.toString().trim()
    if (text && text.length > 5 && contentRef.current?.contains(sel?.anchorNode ?? null)) {
      const range = sel!.getRangeAt(0)
      const rect = range.getBoundingClientRect()
      setClipText(text)
      setClipPos({ top: rect.top + window.scrollY - 44, left: rect.left + rect.width / 2 })
    } else {
      setClipText('')
    }
  }, [highlightsEnabled])

  useEffect(() => {
    function onMouseDown(e: MouseEvent) {
      if (!(e.target as Element).closest('[data-clip-btn]')) setClipText('')
    }
    document.addEventListener('mousedown', onMouseDown)
    return () => document.removeEventListener('mousedown', onMouseDown)
  }, [])

  async function saveClip() {
    if (!clipText) return
    await fetch('/api/notes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        briefingId: briefing.briefingId ?? null,
        channelName: briefing.channelName,
        content: clipText,
      }),
    })
    setClipSaved(true)
    setClipText('')
    window.getSelection()?.removeAllRanges()
    setTimeout(() => setClipSaved(false), 2000)
  }

  // ── Feedback ──────────────────────────────────────────────────────────────
  const [vote, setVote] = useState<1 | -1 | null>(null)
  const [voteSaving, setVoteSaving] = useState(false)

  async function submitFeedback(v: 1 | -1) {
    if (!hasId || voteSaving) return
    setVoteSaving(true)
    setVote(v)
    await fetch('/api/feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ briefingId: briefing.briefingId, vote: v }),
    })
    setVoteSaving(false)
  }

  // ── Share ─────────────────────────────────────────────────────────────────
  const [shareState, setShareState] = useState<'idle' | 'loading' | 'copied'>('idle')

  async function handleShare() {
    if (!hasId || shareState === 'loading') return
    setShareState('loading')
    try {
      const res = await fetch('/api/share', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ briefingId: briefing.briefingId }),
      })
      const { slug } = await res.json()
      const url = `${window.location.origin}/share/${slug}`
      await navigator.clipboard.writeText(url)
      setShareState('copied')
      setTimeout(() => setShareState('idle'), 2500)
    } catch {
      setShareState('idle')
    }
  }

  // ── Discuss ───────────────────────────────────────────────────────────────
  const [discussOpen, setDiscussOpen] = useState(false)
  const [discussMessages, setDiscussMessages] = useState<ConversationMessage[]>([])
  const [discussInput, setDiscussInput] = useState('')
  const [streamingText, setStreamingText] = useState('')
  const [isStreaming, setIsStreaming] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [discussMessages, streamingText])

  useEffect(() => {
    if (discussOpen) {
      setTimeout(() => inputRef.current?.focus(), 50)
    }
  }, [discussOpen])

  async function sendDiscussMessage(text?: string) {
    const input = (text ?? discussInput).trim()
    if (!input || isStreaming) return

    setDiscussInput('')
    const userMsg: ConversationMessage = { role: 'user', content: input }
    const nextMessages = [...discussMessages, userMsg]
    setDiscussMessages(nextMessages)
    setIsStreaming(true)
    setStreamingText('')

    let accumulated = ''

    try {
      const res = await fetch('/api/discuss', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: nextMessages,
          briefingContent: briefing.content,
          channelName: briefing.channelName,
        }),
      })

      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`)

      const reader = res.body.getReader()
      const decoder = new TextDecoder()

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        const chunk = decoder.decode(value, { stream: true })
        for (const line of chunk.split('\n')) {
          if (!line.startsWith('data: ')) continue
          try {
            const event = JSON.parse(line.slice(6))
            if (event.type === 'text_delta') {
              accumulated += event.text
              setStreamingText(accumulated)
            }
          } catch { /* skip malformed lines */ }
        }
      }

      // Commit whatever was accumulated when the stream ends
      setDiscussMessages((prev) => [
        ...prev,
        { role: 'assistant', content: accumulated || '(no response received)' },
      ])
    } catch {
      setDiscussMessages((prev) => [
        ...prev,
        { role: 'assistant', content: '⚠️ Failed to get a response. Please try again.' },
      ])
    } finally {
      setStreamingText('')
      setIsStreaming(false)
    }
  }

  return (
    <>
      {/* Floating clip button — fixed positioned above selection */}
      {highlightsEnabled && clipText && (
        <button
          data-clip-btn
          onClick={saveClip}
          style={{ top: clipPos.top, left: clipPos.left, transform: 'translateX(-50%)' }}
          className="fixed z-50 flex items-center gap-1.5 px-3 py-1.5 bg-brand-600 hover:bg-brand-500 text-white text-xs font-medium rounded-full shadow-lg transition-colors"
        >
          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z" />
          </svg>
          Save
        </button>
      )}

      {/* Outer wrapper — structural difference only */}
      <div className={sheetMode
        ? 'bg-transparent'
        : 'bg-cream-50 border border-cream-300/60 rounded-2xl overflow-hidden'
      }>
        {/* Card header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-cream-300/60">
          <div className="flex items-center gap-2">
            <StatusDot status={briefing.status} />
            {sheetMode ? (
              <h3 className="font-display text-2xl font-normal text-ink-300 leading-tight">
                {briefing.channelName}
              </h3>
            ) : (
              <h3 className="font-sans text-sm font-medium text-ink-300">{briefing.channelName}</h3>
            )}
          </div>
          <div className="flex items-center gap-2">
            {/* TTS play/pause button */}
            {ttsEnabled && isDone && (
              <button
                onClick={handleTtsPlayPause}
                title={isPlaying ? 'Pause audio' : isPaused ? 'Resume audio' : 'Play audio'}
                className={[
                  'flex items-center gap-1 text-xs transition-colors',
                  isActive
                    ? 'text-amber-600 hover:text-amber-700'
                    : 'text-ink-100 hover:text-amber-600',
                ].join(' ')}
              >
                {isPlaying ? (
                  /* Pause icon */
                  <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
                  </svg>
                ) : (
                  /* Play icon */
                  <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M8 5v14l11-7z" />
                  </svg>
                )}
              </button>
            )}

            {/* Share button */}
            {sharingEnabled && isDone && hasId && (
              <button
                onClick={handleShare}
                disabled={shareState === 'loading'}
                className="flex items-center gap-1 text-xs text-ink-200 hover:text-ink-300 transition-colors"
                title="Copy share link"
              >
                {shareState === 'copied' ? (
                  <span className="text-emerald-600">✓ Copied</span>
                ) : (
                  <>
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                        d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
                    </svg>
                    Share
                  </>
                )}
              </button>
            )}
            <span className="text-xs text-ink-100">
              {briefing.status === 'streaming'
                ? briefing.searchQueries.length > 0
                  ? `${briefing.searchQueries.length} search${briefing.searchQueries.length !== 1 ? 'es' : ''}…`
                  : 'Generating…'
                : briefing.status === 'done'
                ? briefing.searchQueries.length > 0
                  ? `${briefing.searchQueries.length} searches · ${briefing.sources.length} sources · ${readingTime(briefing.content)}`
                  : readingTime(briefing.content)
                : 'Error'}
            </span>
          </div>
        </div>

        {/* TTS controls bar — visible when this card is active */}
        {ttsEnabled && isActive && (
          <div className="flex items-center gap-2 px-4 py-2 border-b bg-amber-50/40 border-amber-300/40">
            {/* Speed pills */}
            <div className="flex items-center gap-1">
              {TTS_SPEEDS.map((s) => (
                <button
                  key={s}
                  onClick={() => speech.setRate(s)}
                  className={[
                    'text-xs px-2 py-0.5 rounded-full border transition-colors',
                    speech.rate === s
                      ? 'border-amber-500 bg-amber-50 text-amber-700'
                      : 'border-cream-300 text-ink-100 hover:border-amber-400 hover:text-amber-700',
                  ].join(' ')}
                >
                  {s}×
                </button>
              ))}
            </div>
            {/* Stop button */}
            <button
              onClick={() => speech.stop()}
              title="Stop audio"
              className="ml-auto p-1 rounded transition-colors text-ink-100 hover:text-red-600"
            >
              <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
                <path d="M6 6h12v12H6z" />
              </svg>
            </button>
          </div>
        )}

        {/* Card body */}
        <div className={sheetMode ? 'px-5 py-4' : 'px-4 py-4'}>
          {briefing.status === 'error' ? (
            <p className="text-red-700 text-sm">
              {briefing.error || 'Failed to generate briefing.'}
            </p>
          ) : briefing.content ? (
            <div
              ref={contentRef}
              onMouseUp={handleMouseUp}
              className={highlightsEnabled ? 'select-text' : ''}
            >
              {isActive ? (
                /* ── TTS sentence-highlighted view ── */
                <div className="text-sm text-ink-200 leading-relaxed">
                  {speech.sentences.map((s, i) => (
                    <span
                      key={i}
                      ref={i === speech.currentSentenceIndex ? activeSentenceRef : undefined}
                      className={
                        i === speech.currentSentenceIndex
                          ? 'bg-amber-300/40 text-amber-900 rounded-sm'
                          : 'text-ink-100'
                      }
                    >
                      {s}{' '}
                    </span>
                  ))}
                </div>
              ) : (
                /* ── Normal markdown view ── */
                sheetMode ? (
                  <div className="font-serif prose prose-sm max-w-none prose-headings:font-display prose-headings:font-normal prose-headings:text-ink-300 prose-p:text-ink-200 prose-p:leading-relaxed prose-li:text-ink-200 prose-strong:text-ink-300 prose-a:text-brand-600 prose-a:no-underline hover:prose-a:underline prose-hr:border-ink-50/30 prose-code:text-ink-300 prose-code:bg-cream-300 prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded prose-blockquote:border-brand-500/50 prose-blockquote:text-ink-200">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{briefing.content}</ReactMarkdown>
                  </div>
                ) : (
                  <div className="font-serif prose prose-sm max-w-none prose-headings:font-sans prose-headings:font-semibold prose-headings:text-ink-300 prose-p:text-ink-200 prose-p:leading-relaxed prose-li:text-ink-200 prose-strong:text-ink-300 prose-a:text-brand-600 prose-a:no-underline hover:prose-a:underline prose-hr:border-cream-300 prose-code:text-ink-300 prose-code:bg-cream-300 prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded prose-blockquote:border-brand-500/50 prose-blockquote:text-ink-200">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{briefing.content}</ReactMarkdown>
                  </div>
                )
              )}
              {highlightsEnabled && isDone && !isActive && (
                <p className="text-xs text-ink-50 mt-3 select-none">
                  {clipSaved ? '✓ Saved to notes' : 'Select any text to save it to notes'}
                </p>
              )}
            </div>
          ) : (
            /* Skeleton — show live search queries while waiting for first text token */
            <div className="space-y-2.5 py-1">
              <div className="flex items-center gap-2 text-sm text-ink-100">
                <svg className="w-4 h-4 animate-spin flex-shrink-0" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                {briefing.searchQueries.length > 0
                  ? `Searching for "${briefing.searchQueries[briefing.searchQueries.length - 1]}"…`
                  : 'Starting web search…'}
              </div>
              {briefing.searchQueries.length > 1 && (
                <div className="flex flex-wrap gap-1.5 pl-6">
                  {briefing.searchQueries.slice(0, -1).map((q, i) => (
                    <span key={i} className="text-xs px-2 py-0.5 rounded-full bg-cream-300 text-ink-200">
                      ✓ {q}
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Sources footer */}
          {briefing.sources.length > 0 && (
            <div className="mt-4 pt-3 border-t border-cream-300/60">
              <p className="text-xs font-medium text-ink-100 mb-2">Sources</p>
              <div className="flex flex-col gap-1.5">
                {briefing.sources.slice(0, 5).map((src, i) => (
                  <a
                    key={i}
                    href={src.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs truncate transition-colors text-ink-200 hover:text-ink-300"
                  >
                    {src.title || src.url}
                  </a>
                ))}
              </div>
            </div>
          )}

          {/* Feedback footer */}
          {feedbackEnabled && isDone && hasId && (
            <div className="mt-4 pt-3 border-t border-cream-300/60 flex items-center gap-3">
              <span className="text-xs text-ink-100">Was this useful?</span>
              <button
                onClick={() => submitFeedback(1)}
                disabled={voteSaving}
                className={[
                  'flex items-center gap-1 text-xs px-2.5 py-1 rounded-full border transition-colors',
                  vote === 1
                    ? 'border-emerald-600/60 bg-emerald-50 text-emerald-700'
                    : 'border-cream-300 text-ink-100 hover:border-emerald-600/50 hover:text-emerald-700',
                ].join(' ')}
              >
                <svg className="w-3.5 h-3.5" fill={vote === 1 ? 'currentColor' : 'none'} viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M14 10h4.764a2 2 0 011.789 2.894l-3.5 7A2 2 0 0115.263 21h-4.017c-.163 0-.326-.02-.485-.06L7 20m7-10V5a2 2 0 00-2-2h-.095c-.5 0-.905.405-.905.905 0 .714-.211 1.412-.608 2.006L7 11v9m7-10h-2M7 20H5a2 2 0 01-2-2v-6a2 2 0 012-2h2.5" />
                </svg>
                Yes
              </button>
              <button
                onClick={() => submitFeedback(-1)}
                disabled={voteSaving}
                className={[
                  'flex items-center gap-1 text-xs px-2.5 py-1 rounded-full border transition-colors',
                  vote === -1
                    ? 'border-red-600/60 bg-red-50 text-red-700'
                    : 'border-cream-300 text-ink-100 hover:border-red-600/50 hover:text-red-700',
                ].join(' ')}
              >
                <svg className="w-3.5 h-3.5" fill={vote === -1 ? 'currentColor' : 'none'} viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M10 14H5.236a2 2 0 01-1.789-2.894l3.5-7A2 2 0 018.736 3h4.018c.163 0 .326.02.485.06L17 4m-7 10v2a2 2 0 002 2h.095c.5 0 .905-.405.905-.905 0-.714.211-1.412.608-2.006L17 13V4m-7 10h2m5-10h2a2 2 0 012 2v6a2 2 0 01-2 2h-2.5" />
                </svg>
                No
              </button>
            </div>
          )}

          {/* Cost summary */}
          {isDone && briefing.usage && (
            <div className="mt-3 flex items-center gap-1.5 text-xs text-ink-50">
              <svg className="w-3 h-3 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <span>
                {formatTokens(briefing.usage.inputTokens)} in
                &thinsp;·&thinsp;
                {formatTokens(briefing.usage.outputTokens)} out
                &thinsp;·&thinsp;
                {formatCost(briefing.usage.costUsd)}
              </span>
            </div>
          )}

          {/* Discuss toggle */}
          {discussEnabled && isDone && (
            <div className={[
              'flex justify-start',
              feedbackEnabled && hasId
                ? 'mt-3'
                : 'mt-4 pt-3 border-t border-cream-300/60',
            ].join(' ')}>
              <button
                onClick={() => setDiscussOpen((o) => !o)}
                className={[
                  'flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full border transition-colors',
                  discussOpen
                    ? 'border-brand-600/60 bg-brand-50 text-brand-700'
                    : 'border-cream-300 text-ink-100 hover:border-brand-600/50 hover:text-brand-700',
                ].join(' ')}
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
                </svg>
                {discussOpen ? 'Close discussion' : 'Ask Claude'}
              </button>
            </div>
          )}
        </div>

        {/* Discuss panel */}
        {discussEnabled && discussOpen && isDone && (
          <div className="border-t border-brand-500/20 bg-cream-100/60">
            {/* Messages area */}
            <div className="max-h-96 overflow-y-auto px-4 py-3 space-y-3">
              {/* Suggested questions when conversation is empty */}
              {discussMessages.length === 0 && !isStreaming && (
                <div className="space-y-2">
                  <p className="text-xs text-ink-100">Suggested questions:</p>
                  <div className="flex flex-wrap gap-2">
                    {SUGGESTED_QUESTIONS.map((q) => (
                      <button
                        key={q}
                        onClick={() => sendDiscussMessage(q)}
                        className="text-xs px-3 py-1.5 rounded-full border border-cream-300 text-ink-100 hover:border-brand-600/50 hover:text-brand-700 transition-colors text-left"
                      >
                        {q}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Message history */}
              {discussMessages.map((msg, i) => (
                <div key={i} className={msg.role === 'user' ? 'flex justify-end' : 'flex justify-start'}>
                  {msg.role === 'user' ? (
                    <div className="max-w-[80%] bg-brand-600 rounded-2xl rounded-tr-sm px-3 py-2">
                      <p className="text-sm text-white">{msg.content}</p>
                    </div>
                  ) : (
                    <div className="max-w-[90%]">
                      <div className="prose prose-sm max-w-none prose-p:text-ink-200 prose-p:leading-relaxed prose-li:text-ink-200 prose-strong:text-ink-300 prose-headings:text-ink-300 prose-headings:text-sm prose-a:text-brand-600 prose-code:text-ink-300 prose-code:bg-cream-300 prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-p:my-1 prose-ul:my-1 prose-li:my-0">
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.content}</ReactMarkdown>
                      </div>
                    </div>
                  )}
                </div>
              ))}

              {/* Streaming response */}
              {isStreaming && (
                <div className="flex justify-start">
                  <div className="max-w-[90%]">
                    {streamingText ? (
                      <div className="prose prose-sm max-w-none prose-p:text-ink-200 prose-p:leading-relaxed prose-li:text-ink-200 prose-strong:text-ink-300 prose-headings:text-ink-300 prose-headings:text-sm prose-a:text-brand-600 prose-code:text-ink-300 prose-code:bg-cream-300 prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-p:my-1 prose-ul:my-1 prose-li:my-0">
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>{streamingText}</ReactMarkdown>
                      </div>
                    ) : (
                      /* Dots while waiting for first token */
                      <div className="flex items-center gap-1 py-2">
                        <span className="w-1.5 h-1.5 rounded-full bg-ink-100 animate-bounce [animation-delay:0ms]" />
                        <span className="w-1.5 h-1.5 rounded-full bg-ink-100 animate-bounce [animation-delay:150ms]" />
                        <span className="w-1.5 h-1.5 rounded-full bg-ink-100 animate-bounce [animation-delay:300ms]" />
                      </div>
                    )}
                  </div>
                </div>
              )}

              <div ref={messagesEndRef} />
            </div>

            {/* Input area */}
            <div className="px-4 pb-3 pt-2 border-t border-cream-300/60 flex gap-2">
              <input
                ref={inputRef}
                type="text"
                value={discussInput}
                onChange={(e) => setDiscussInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault()
                    sendDiscussMessage()
                  }
                }}
                placeholder="Ask a question about this briefing…"
                disabled={isStreaming}
                className="flex-1 bg-cream-100 border border-cream-300 rounded-xl px-3 py-2 text-sm text-ink-300 placeholder-ink-50 focus:outline-none focus:border-brand-500/50 focus:ring-1 focus:ring-brand-500/30 disabled:opacity-50 transition-colors"
              />
              <button
                onClick={() => sendDiscussMessage()}
                disabled={!discussInput.trim() || isStreaming}
                className="flex-shrink-0 p-2 rounded-xl bg-brand-600 hover:bg-brand-500 disabled:opacity-40 disabled:cursor-not-allowed text-white transition-colors"
                title="Send"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                </svg>
              </button>
            </div>
          </div>
        )}
      </div>
    </>
  )
}

function StatusDot({ status }: { status: BriefingState['status'] }) {
  if (status === 'streaming') {
    return (
      <span className="relative flex h-2 w-2 flex-shrink-0">
        <span className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 bg-brand-500" />
        <span className="relative inline-flex rounded-full h-2 w-2 bg-brand-500" />
      </span>
    )
  }
  if (status === 'done') {
    return <span className="h-2 w-2 rounded-full bg-emerald-500 flex-shrink-0" />
  }
  return <span className="h-2 w-2 rounded-full bg-red-500 flex-shrink-0" />
}
