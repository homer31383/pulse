'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { MarkdownRenderer } from '@/components/MarkdownRenderer'
import type { PpChatMessage, PpChatQueued, PpChatSession, PpChatSource } from '@/lib/post-pulse-types'
import { usePostPulse } from './Shell'

interface Props {
  session: PpChatSession
}

type StreamEvent =
  | { type: 'session'; id: string }
  | { type: 'searching'; query: string }
  | { type: 'source'; source: PpChatSource }
  | { type: 'text_delta'; text: string }
  | { type: 'queued'; item: PpChatQueued }
  | { type: 'done'; name: string; message: PpChatMessage }
  | { type: 'error'; error: string }

// Conversation view for one session. The turn streams over SSE; queue
// writes made during the turn show as a small inline indicator on that
// message (review happens in the Queue view, so no preview card here).
export function ChatClient({ session }: Props) {
  const { departments } = usePostPulse()
  const router = useRouter()
  const context = session.department_context_id
    ? departments.find((d) => d.id === session.department_context_id) ?? null
    : null

  const [messages, setMessages] = useState<PpChatMessage[]>(session.messages)
  const [name, setName] = useState(session.name)
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [pending, setPending] = useState<{
    text: string
    searching: string[]
    sources: PpChatSource[]
    queued: PpChatQueued[]
  } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' })
  }, [messages, pending?.text, pending?.searching.length])

  async function send() {
    const text = draft.trim()
    if (!text || busy) return
    setDraft('')
    setError(null)
    setBusy(true)
    const userMsg: PpChatMessage = { role: 'user', content: text, created_at: new Date().toISOString() }
    setMessages((prev) => [...prev, userMsg])
    setPending({ text: '', searching: [], sources: [], queued: [] })

    try {
      const res = await fetch('/api/post-pulse/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: session.id, message: text }),
      })
      if (!res.ok || !res.body) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error ?? `Request failed (${res.status})`)
      }
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let finished = false
      while (!finished) {
        const { value, done } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const chunks = buffer.split('\n\n')
        buffer = chunks.pop() ?? ''
        for (const chunk of chunks) {
          const line = chunk.split('\n').find((l) => l.startsWith('data: '))
          if (!line) continue
          let event: StreamEvent
          try {
            event = JSON.parse(line.slice(6)) as StreamEvent
          } catch {
            continue
          }
          switch (event.type) {
            case 'searching':
              setPending((p) => (p ? { ...p, searching: [...p.searching, event.query] } : p))
              break
            case 'source':
              setPending((p) => (p ? { ...p, sources: [...p.sources, event.source] } : p))
              break
            case 'text_delta':
              setPending((p) => (p ? { ...p, text: p.text + event.text } : p))
              break
            case 'queued':
              setPending((p) => (p ? { ...p, queued: [...p.queued, event.item] } : p))
              break
            case 'done':
              setMessages((prev) => [...prev, event.message])
              setName(event.name)
              setPending(null)
              finished = true
              break
            case 'error':
              setError(event.error)
              setPending((p) => {
                if (p?.text) {
                  setMessages((prev) => [...prev, { role: 'assistant', content: p.text, created_at: new Date().toISOString(), queued: p.queued }])
                }
                return null
              })
              finished = true
              break
          }
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
      setPending(null)
    } finally {
      setBusy(false)
      // Sidebar queue badge + session list order come from the layout fetch.
      router.refresh()
      inputRef.current?.focus()
    }
  }

  async function rename(next: string) {
    const trimmed = next.trim()
    if (!trimmed || trimmed === name) {
      setName(name)
      return
    }
    setName(trimmed)
    await fetch(`/api/post-pulse/chat/sessions/${session.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: trimmed }),
    }).catch(() => {})
    router.refresh()
  }

  return (
    <div className="max-w-3xl flex flex-col min-h-[calc(100dvh-8rem)]">
      <header className="mb-4">
        <nav className="text-xs text-ink-50 mb-2 flex items-center gap-1.5">
          <Link href="/post-pulse/chat" className="hover:text-press-accent">
            Research chat
          </Link>
          <span>/</span>
          <span className="truncate">{name}</span>
        </nav>
        <input
          type="text"
          defaultValue={name}
          key={name}
          onBlur={(e) => rename(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
          }}
          aria-label="Session name"
          className="w-full font-display text-2xl text-ink-300 bg-transparent border-b border-transparent hover:border-cream-400 focus:border-press-accent focus:outline-none"
        />
        {context ? (
          <p className="text-xs text-ink-50 mt-1.5">
            Scoped to{' '}
            <Link href={`/post-pulse/departments/${context.slug}`} className="text-press-accent hover:underline">
              {context.name}
            </Link>{' '}
            as the default frame. Other departments still get full answers.
          </p>
        ) : (
          <p className="text-xs text-ink-50 mt-1.5">Not scoped to a department.</p>
        )}
      </header>

      <div className="flex-1 space-y-4">
        {messages.length === 0 && !pending && (
          <div className="rounded-xl border border-dashed border-cream-400 bg-cream-50/60 px-4 py-5 text-sm text-ink-100">
            <p className="font-medium text-ink-200 mb-1">Try asking</p>
            <ul className="space-y-0.5 text-ink-100">
              <li>“What does Beeble actually do, and where would it fit?”</li>
              <li>“Is there anything tracked for virtual production yet? What should the department look like?”</li>
              <li>“Has Ziva’s replacement story changed since September?”</li>
            </ul>
          </div>
        )}

        {messages.map((m, i) => (
          <MessageBubble key={`${m.created_at}-${i}`} message={m} />
        ))}

        {pending && (
          <div className="rounded-xl border border-cream-300 bg-cream-50 px-4 py-3">
            {pending.searching.length > 0 && (
              <ul className="mb-2 space-y-0.5">
                {pending.searching.map((q, i) => (
                  <li key={i} className="text-[11px] text-ink-50 flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-press-accent animate-pulse-dot" />
                    Searching: {q}
                  </li>
                ))}
              </ul>
            )}
            {pending.text ? (
              <MarkdownRenderer content={pending.text} />
            ) : (
              <p className="text-sm text-ink-50 animate-pulse">Thinking…</p>
            )}
            {pending.queued.length > 0 && <QueuedLine items={pending.queued} />}
          </div>
        )}

        {error && (
          <div className="rounded-lg border border-press-down/30 bg-press-down/10 px-3 py-2 text-sm text-press-down">{error}</div>
        )}
        <div ref={bottomRef} />
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault()
          send()
        }}
        className="sticky bottom-0 mt-6 pt-3 pb-[calc(0.5rem+env(safe-area-inset-bottom,0px))] bg-cream-200"
      >
        <div className="flex gap-2 items-end">
          <textarea
            ref={inputRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                send()
              }
            }}
            rows={2}
            disabled={busy}
            placeholder={context ? `Ask about ${context.name}, or anything else…` : 'Ask about a tool, a department, or something you heard about…'}
            className="flex-1 rounded-xl border border-cream-300 bg-cream-50 px-3 py-2 text-sm text-ink-300 placeholder:text-ink-50 resize-none focus:outline-none focus:border-press-accent/60 focus:ring-2 focus:ring-press-accent/15 disabled:opacity-60"
          />
          <button
            type="submit"
            disabled={busy || !draft.trim()}
            className="px-4 py-2 rounded-xl bg-press-accent text-white text-sm font-medium hover:bg-brand-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {busy ? '…' : 'Send'}
          </button>
        </div>
        <p className="text-[11px] text-ink-50 mt-1.5">Enter to send, Shift+Enter for a new line. Proposals go straight to the review queue.</p>
      </form>
    </div>
  )
}

function MessageBubble({ message }: { message: PpChatMessage }) {
  if (message.role === 'user') {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-2xl rounded-br-md bg-press-accent/10 border border-press-accent/20 px-4 py-2.5 text-sm text-ink-300 whitespace-pre-wrap">
          {message.content}
        </div>
      </div>
    )
  }
  return (
    <div className="rounded-xl border border-cream-300 bg-cream-50 px-4 py-3">
      <MarkdownRenderer content={message.content} />
      {message.queued && message.queued.length > 0 && <QueuedLine items={message.queued} />}
      {message.sources && message.sources.length > 0 && (
        <details className="mt-2">
          <summary className="text-[11px] text-ink-50 cursor-pointer hover:text-ink-100">
            {message.sources.length} {message.sources.length === 1 ? 'source' : 'sources'} searched
          </summary>
          <ul className="mt-1 space-y-0.5">
            {message.sources.map((s) => (
              <li key={s.url} className="text-[11px] truncate">
                <a href={s.url} target="_blank" rel="noopener noreferrer" className="text-press-accent hover:underline">
                  {s.title}
                </a>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  )
}

// The inline "added to queue" indicator: one line per proposal, linked to
// the Queue view where the actual review happens.
function QueuedLine({ items }: { items: PpChatQueued[] }) {
  return (
    <ul className="mt-3 pt-2 border-t border-cream-300/70 space-y-1">
      {items.map((q) => (
        <li key={q.id} className="flex flex-wrap items-center gap-x-2 text-xs">
          <span className="inline-flex items-center gap-1 px-1.5 py-px rounded-full bg-press-up/10 text-press-up font-medium">
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
            </svg>
            Added to queue
          </span>
          <span className="text-ink-200">{q.label}</span>
          <Link href="/post-pulse/queue" className="text-press-accent hover:underline">
            Review →
          </Link>
        </li>
      ))}
    </ul>
  )
}
