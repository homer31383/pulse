'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import type { Channel, ChannelGroup, ConversationMessage, ConfigChatStreamEvent, BriefingWithCost } from '@/lib/types'
import { BriefingHistorySection } from '@/components/BriefingHistorySection'

type Tab = 'settings' | 'chat'
type SaveStatus = 'idle' | 'saving' | 'saved' | 'error'

interface Props {
  channel: Channel
  initialMessages: ConversationMessage[]
  initialBriefings: BriefingWithCost[]
  groups: ChannelGroup[]
}

export function ChannelConfigClient({ channel: initialChannel, initialMessages, initialBriefings, groups }: Props) {
  const router = useRouter()
  const [tab, setTab] = useState<Tab>('settings')

  // ── Settings state ──────────────────────────────────────────────────────────
  const [name, setName] = useState(initialChannel.name)
  const [description, setDescription] = useState(initialChannel.description ?? '')
  const [instructions, setInstructions] = useState(initialChannel.instructions)
  const [searchQueries, setSearchQueries] = useState<string[]>(
    initialChannel.search_queries ?? []
  )
  const [newQuery, setNewQuery] = useState('')
  const [groupId, setGroupId] = useState<string | null>(initialChannel.group_id ?? null)
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle')

  // ── Chat state ───────────────────────────────────────────────────────────────
  const [messages, setMessages] = useState<ConversationMessage[]>(initialMessages)
  const [input, setInput] = useState('')
  const [isChatting, setIsChatting] = useState(false)
  const [isSynthesizing, setIsSynthesizing] = useState(false)
  const [synthMessage, setSynthMessage] = useState('')
  const messagesEndRef = useRef<HTMLDivElement>(null)

  // ── Delete state ─────────────────────────────────────────────────────────────
  const [deleteStep, setDeleteStep] = useState<'idle' | 'confirm'>('idle')
  const [isDeleting, setIsDeleting] = useState(false)

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // ── Settings: save ───────────────────────────────────────────────────────────
  async function saveSettings() {
    if (saveStatus === 'saving') return
    setSaveStatus('saving')
    try {
      const res = await fetch(`/api/channels/${initialChannel.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim() || initialChannel.name,
          description: description.trim() || null,
          instructions: instructions.trim(),
          search_queries: searchQueries.filter((q) => q.trim()),
          group_id: groupId,
        }),
      })
      if (!res.ok) throw new Error()
      setSaveStatus('saved')
      setTimeout(() => setSaveStatus('idle'), 2000)
      router.refresh()
    } catch {
      setSaveStatus('error')
      setTimeout(() => setSaveStatus('idle'), 2500)
    }
  }

  // ── Settings: search query pill editor ──────────────────────────────────────
  function addQuery() {
    const q = newQuery.trim()
    if (q && !searchQueries.includes(q)) {
      setSearchQueries((prev) => [...prev, q])
      setNewQuery('')
    }
  }

  function removeQuery(i: number) {
    setSearchQueries((prev) => prev.filter((_, idx) => idx !== i))
  }

  function handleQueryKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault()
      addQuery()
    }
  }

  // ── Chat: send message ───────────────────────────────────────────────────────
  const sendMessage = useCallback(async () => {
    const text = input.trim()
    if (!text || isChatting) return
    setInput('')

    const userMsg: ConversationMessage = { role: 'user', content: text }
    const updatedMessages: ConversationMessage[] = [...messages, userMsg]
    setMessages([...updatedMessages, { role: 'assistant', content: '' }])
    setIsChatting(true)

    let accumulated = ''

    try {
      const res = await fetch(`/api/config-chat/${initialChannel.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: updatedMessages, channel: initialChannel }),
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
            const event = JSON.parse(line.slice(6)) as ConfigChatStreamEvent
            if (event.type === 'text_delta') {
              accumulated += event.text
              setMessages((prev) => {
                const next = [...prev]
                next[next.length - 1] = { role: 'assistant', content: accumulated }
                return next
              })
            }
          } catch { /* skip malformed */ }
        }
      }

      // Auto-save full conversation (including assistant reply) to DB
      const finalMessages: ConversationMessage[] = [
        ...updatedMessages,
        { role: 'assistant', content: accumulated },
      ]
      fetch(`/api/config-conversations/${initialChannel.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: finalMessages }),
      })
    } catch {
      setMessages((prev) => {
        const next = [...prev]
        next[next.length - 1] = {
          role: 'assistant',
          content: 'Something went wrong. Please try again.',
        }
        return next
      })
    } finally {
      setIsChatting(false)
    }
  }, [input, isChatting, messages, initialChannel])

  function handleChatKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage()
    }
  }

  // ── Delete channel ───────────────────────────────────────────────────────────
  async function deleteChannel() {
    if (isDeleting) return
    setIsDeleting(true)
    try {
      const res = await fetch(`/api/channels/${initialChannel.id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error()
      router.push('/')
      router.refresh()
    } catch {
      setIsDeleting(false)
      setDeleteStep('idle')
    }
  }

  // ── Synthesize instructions from chat ────────────────────────────────────────
  async function synthesize() {
    if (messages.length < 2 || isSynthesizing) return
    setIsSynthesizing(true)
    setSynthMessage('')
    try {
      const res = await fetch(`/api/config-chat/${initialChannel.id}/synthesize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages, channel: initialChannel }),
      })
      if (!res.ok) throw new Error()
      const { instructions: newInstructions, search_queries: newQueries } =
        await res.json() as { instructions: string; search_queries: string[] }

      // Update settings fields with synthesised values
      setInstructions(newInstructions)
      setSearchQueries(newQueries)
      setSynthMessage('Instructions saved! Switching to Settings…')
      setTimeout(() => {
        setSynthMessage('')
        setTab('settings')
      }, 1500)
    } catch {
      setSynthMessage('Synthesis failed — please try again.')
      setTimeout(() => setSynthMessage(''), 3000)
    } finally {
      setIsSynthesizing(false)
    }
  }

  // ── Render ───────────────────────────────────────────────────────────────────
  const settingsSaveLabel =
    saveStatus === 'saving'
      ? 'Saving…'
      : saveStatus === 'saved'
      ? 'Saved!'
      : saveStatus === 'error'
      ? 'Error — try again'
      : 'Save changes'

  return (
    <div className="min-h-screen bg-warm-900 flex flex-col">
      {/* ── Header ── */}
      <header className="sticky top-0 z-20 bg-warm-900/95 backdrop-blur-sm border-b border-warm-800">
        <div className="max-w-2xl mx-auto px-4 py-3 flex items-center gap-3">
          <Link
            href="/"
            className="p-1.5 rounded-lg text-warm-400 hover:text-warm-200 hover:bg-warm-800 transition-colors flex-shrink-0"
            aria-label="Back"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </Link>
          <h1 className="text-lg font-semibold text-warm-100 truncate flex-1">{initialChannel.name}</h1>
          {/* History link */}
          <Link
            href={`/channels/${initialChannel.id}/history`}
            className="p-1.5 rounded-lg text-warm-400 hover:text-warm-200 hover:bg-warm-800 transition-colors flex-shrink-0"
            aria-label="View briefing history"
            title="Briefing history"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </Link>
        </div>

        {/* Tab bar */}
        <div className="max-w-2xl mx-auto px-4 pb-3">
          <div className="flex gap-1 bg-warm-800/60 rounded-xl p-1">
            {(['settings', 'chat'] as const).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={[
                  'flex-1 py-1.5 rounded-lg text-sm font-medium transition-all',
                  tab === t
                    ? 'bg-warm-700 text-white shadow'
                    : 'text-warm-400 hover:text-warm-200',
                ].join(' ')}
              >
                {t === 'settings' ? 'Settings' : 'Chat with Claude'}
              </button>
            ))}
          </div>
        </div>
      </header>

      {/* ── Settings tab ── */}
      {tab === 'settings' && (
        <main className="max-w-2xl mx-auto w-full px-4 pt-6 pb-32 space-y-6">
          {/* Name */}
          <div className="space-y-1.5">
            <label className="block text-xs font-semibold text-warm-400 uppercase tracking-wider">
              Channel name
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full bg-warm-800/60 border border-warm-700/60 rounded-xl px-4 py-3 text-warm-100 placeholder-warm-600 focus:outline-none focus:ring-2 focus:ring-brand-500/50 focus:border-brand-500/50 text-sm transition-colors"
              placeholder="e.g. AI & Machine Learning"
            />
          </div>

          {/* Group */}
          {groups.length > 0 && (
            <div className="space-y-1.5">
              <label className="block text-xs font-semibold text-warm-400 uppercase tracking-wider">
                Group <span className="text-warm-600 normal-case font-normal">(optional)</span>
              </label>
              <select
                value={groupId ?? ''}
                onChange={(e) => setGroupId(e.target.value || null)}
                className="w-full bg-warm-800/60 border border-warm-700/60 rounded-xl px-4 py-3 text-warm-100 focus:outline-none focus:ring-2 focus:ring-brand-500/50 focus:border-brand-500/50 text-sm transition-colors"
              >
                <option value="">No group</option>
                {groups.map((g) => (
                  <option key={g.id} value={g.id}>{g.name}</option>
                ))}
              </select>
            </div>
          )}

          {/* Description */}
          <div className="space-y-1.5">
            <label className="block text-xs font-semibold text-warm-400 uppercase tracking-wider">
              Description <span className="text-warm-600 normal-case font-normal">(optional)</span>
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              className="w-full bg-warm-800/60 border border-warm-700/60 rounded-xl px-4 py-3 text-warm-100 placeholder-warm-600 focus:outline-none focus:ring-2 focus:ring-brand-500/50 focus:border-brand-500/50 text-sm transition-colors resize-none"
              placeholder="A short description of this channel"
            />
          </div>

          {/* Instructions */}
          <div className="space-y-1.5">
            <label className="block text-xs font-semibold text-warm-400 uppercase tracking-wider">
              Instructions
            </label>
            <p className="text-xs text-warm-500">
              System prompt given to Claude when generating briefings. Use the Chat tab to develop these with AI assistance.
            </p>
            <textarea
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              rows={7}
              className="w-full bg-warm-800/60 border border-warm-700/60 rounded-xl px-4 py-3 text-warm-100 placeholder-warm-600 focus:outline-none focus:ring-2 focus:ring-brand-500/50 focus:border-brand-500/50 text-sm transition-colors resize-none font-mono"
              placeholder="You are a research assistant. Search the web and provide a concise briefing about…"
            />
          </div>

          {/* Search queries */}
          <div className="space-y-2">
            <label className="block text-xs font-semibold text-warm-400 uppercase tracking-wider">
              Search queries
            </label>
            <p className="text-xs text-warm-500">
              Keywords and phrases used to search the web during briefing generation.
            </p>

            {/* Existing query pills */}
            {searchQueries.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {searchQueries.map((q, i) => (
                  <span
                    key={i}
                    className="flex items-center gap-1.5 bg-brand-900/40 border border-brand-700/40 text-brand-300 text-xs px-2.5 py-1 rounded-full"
                  >
                    {q}
                    <button
                      onClick={() => removeQuery(i)}
                      className="text-brand-400/60 hover:text-brand-200 transition-colors"
                      aria-label={`Remove "${q}"`}
                    >
                      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </span>
                ))}
              </div>
            )}

            {/* Add new query */}
            <div className="flex gap-2">
              <input
                type="text"
                value={newQuery}
                onChange={(e) => setNewQuery(e.target.value)}
                onKeyDown={handleQueryKeyDown}
                placeholder="Add a search query…"
                className="flex-1 bg-warm-800/60 border border-warm-700/60 rounded-xl px-4 py-2.5 text-warm-100 placeholder-warm-600 focus:outline-none focus:ring-2 focus:ring-brand-500/50 focus:border-brand-500/50 text-sm transition-colors"
              />
              <button
                onClick={addQuery}
                disabled={!newQuery.trim()}
                className="px-4 py-2.5 bg-warm-700 hover:bg-warm-600 disabled:opacity-40 disabled:cursor-not-allowed text-warm-200 text-sm font-medium rounded-xl transition-colors"
              >
                Add
              </button>
            </div>
          </div>

          {/* ── Briefing history ── */}
          <BriefingHistorySection
            channelName={initialChannel.name}
            channelId={initialChannel.id}
            initialBriefings={initialBriefings}
          />

          {/* ── Danger zone ── */}
          <div className="mt-2 pt-6 border-t border-warm-800">
            <p className="text-xs font-semibold text-warm-500 uppercase tracking-wider mb-3">
              Danger zone
            </p>

            {deleteStep === 'idle' ? (
              <button
                onClick={() => setDeleteStep('confirm')}
                className="text-sm text-red-400 hover:text-red-300 border border-red-800/50 hover:border-red-700/60 hover:bg-red-950/30 px-4 py-2 rounded-xl transition-colors"
              >
                Delete channel…
              </button>
            ) : (
              <div className="bg-red-950/30 border border-red-800/50 rounded-xl p-4 space-y-3">
                <p className="text-sm text-red-300 font-medium">Delete this channel?</p>
                <p className="text-xs text-red-400/80">
                  This will permanently remove <strong className="text-red-300">{initialChannel.name}</strong> and
                  all of its saved briefings. This cannot be undone.
                </p>
                <div className="flex gap-2">
                  <button
                    onClick={deleteChannel}
                    disabled={isDeleting}
                    className="flex-1 py-2 rounded-lg bg-red-700 hover:bg-red-600 disabled:opacity-50 text-white text-sm font-semibold transition-colors"
                  >
                    {isDeleting ? 'Deleting…' : 'Yes, delete'}
                  </button>
                  <button
                    onClick={() => setDeleteStep('idle')}
                    disabled={isDeleting}
                    className="flex-1 py-2 rounded-lg bg-warm-700 hover:bg-warm-600 disabled:opacity-50 text-warm-200 text-sm font-medium transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        </main>
      )}

      {/* ── Chat tab ── */}
      {tab === 'chat' && (
        <div className="flex-1 flex flex-col max-w-2xl mx-auto w-full min-h-0">
          {/* Message list */}
          <div className="flex-1 overflow-y-auto px-4 py-5 space-y-4">
            {messages.length === 0 ? (
              <div className="text-center py-12 text-warm-500 text-sm">
                <div className="w-12 h-12 bg-warm-800 rounded-2xl flex items-center justify-center mx-auto mb-3">
                  <svg className="w-6 h-6 text-warm-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                  </svg>
                </div>
                <p className="font-medium text-warm-400 mb-1">Chat with Claude</p>
                <p className="text-warm-600 text-xs max-w-xs mx-auto">
                  Describe what you want to be briefed on and Claude will help you craft the perfect instructions and search queries.
                </p>
              </div>
            ) : (
              messages.map((msg, i) => (
                <div key={i} className={msg.role === 'user' ? 'flex justify-end' : 'flex justify-start'}>
                  <div
                    className={[
                      'max-w-[85%] rounded-2xl px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap',
                      msg.role === 'user'
                        ? 'bg-brand-600 text-white rounded-br-sm'
                        : 'bg-warm-800 text-warm-200 rounded-bl-sm',
                      !msg.content && msg.role === 'assistant' ? 'opacity-50' : '',
                    ].join(' ')}
                  >
                    {msg.content || (
                      <span className="flex items-center gap-1.5 text-warm-400">
                        <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                        </svg>
                        Thinking…
                      </span>
                    )}
                  </div>
                </div>
              ))
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Synthesize button */}
          {messages.length >= 2 && (
            <div className="px-4 pb-2">
              <button
                onClick={synthesize}
                disabled={isSynthesizing || isChatting}
                className="w-full py-2.5 rounded-xl border border-emerald-700/40 bg-emerald-900/30 hover:bg-emerald-900/50 disabled:opacity-50 disabled:cursor-not-allowed text-emerald-300 text-sm font-medium transition-colors"
              >
                {isSynthesizing ? (
                  <span className="flex items-center justify-center gap-2">
                    <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    Synthesising instructions…
                  </span>
                ) : synthMessage ? (
                  synthMessage
                ) : (
                  '✦ Save instructions from this chat'
                )}
              </button>
            </div>
          )}

          {/* Input area */}
          <div className="px-4 pb-6 pt-2 border-t border-warm-800">
            <div className="flex gap-2 items-end">
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleChatKeyDown}
                disabled={isChatting}
                rows={1}
                placeholder="Describe what you want from this channel…"
                className="flex-1 bg-warm-800/60 border border-warm-700/60 rounded-xl px-4 py-3 text-warm-100 placeholder-warm-600 focus:outline-none focus:ring-2 focus:ring-brand-500/50 focus:border-brand-500/50 text-sm transition-colors resize-none"
                style={{ maxHeight: '120px' }}
                onInput={(e) => {
                  const el = e.currentTarget
                  el.style.height = 'auto'
                  el.style.height = `${el.scrollHeight}px`
                }}
              />
              <button
                onClick={sendMessage}
                disabled={!input.trim() || isChatting}
                className="flex-shrink-0 w-10 h-10 rounded-xl bg-brand-600 hover:bg-brand-500 disabled:opacity-40 disabled:cursor-not-allowed text-white flex items-center justify-center transition-colors"
                aria-label="Send"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 19V5M5 12l7-7 7 7" />
                </svg>
              </button>
            </div>
            <p className="text-xs text-warm-600 mt-1.5 pl-1">Enter to send · Shift+Enter for new line</p>
          </div>
        </div>
      )}

      {/* ── Fixed save button (settings tab only) ── */}
      {tab === 'settings' && (
        <div className="fixed bottom-0 inset-x-0 px-4 pb-6 pt-10 bg-gradient-to-t from-warm-900 via-warm-900/90 to-transparent pointer-events-none">
          <div className="max-w-2xl mx-auto pointer-events-auto">
            <button
              onClick={saveSettings}
              disabled={saveStatus === 'saving'}
              className={[
                'w-full font-semibold py-4 rounded-2xl text-base transition-all duration-200',
                saveStatus === 'saved'
                  ? 'bg-emerald-600 text-white'
                  : saveStatus === 'error'
                  ? 'bg-red-700 text-white'
                  : 'bg-brand-600 hover:bg-brand-500 active:scale-[0.98] text-white shadow-lg shadow-brand-600/25',
              ].join(' ')}
            >
              {settingsSaveLabel}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
