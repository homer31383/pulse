'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { MarkdownRenderer } from '@/components/MarkdownRenderer'
import type { PpChatMessage, PpChatQueued, PpChatSession, PpChatSource, PpDepartment } from '@/lib/post-pulse-types'
import { generateWorkflowTitle } from '@/lib/post-pulse-workflows'
import { usePostPulse } from './Shell'

interface Props {
  session: PpChatSession
  // Re-run of a saved workflow doc: its prompt is submitted as a new turn on
  // mount; the answer shows up alongside and can be saved as a new version.
  rerun?: { docId: string; title: string; prompt: string; departmentId: string } | null
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
export function ChatClient({ session, rerun = null }: Props) {
  const { departments } = usePostPulse()
  const router = useRouter()
  const context = session.department_context_id
    ? departments.find((d) => d.id === session.department_context_id) ?? null
    : null
  // Saved-doc bookkeeping per assistant message index → doc id (this visit).
  const [savedDocs, setSavedDocs] = useState<Record<number, string>>({})
  const rerunFired = useRef(false)

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

  // Re-run: submit the saved prompt once, as a normal turn.
  useEffect(() => {
    if (!rerun || rerunFired.current) return
    rerunFired.current = true
    void send(rerun.prompt)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rerun?.docId])

  async function send(override?: string) {
    const text = (override ?? draft).trim()
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

        {rerun && (
          <div className="rounded-xl border border-press-accent/30 bg-press-accent/5 px-4 py-3 text-sm text-ink-200">
            <p className="text-[10px] uppercase tracking-[1.5px] text-press-accent font-medium">Re-running a workflow doc</p>
            <p className="mt-0.5">
              <span className="font-medium text-ink-300">{rerun.title}</span> — the saved prompt is sent again below. The saved doc is
              not changed; compare the fresh answer and save it as a new version if it is better.
            </p>
          </div>
        )}

        {messages.map((m, i) => (
          <MessageBubble
            key={`${m.created_at}-${i}`}
            message={m}
            index={i}
            prompt={m.role === 'assistant' ? previousUserPrompt(messages, i) : null}
            earlierPrompts={m.role === 'assistant' ? earlierUserPrompts(messages, i) : []}
            sessionId={session.id}
            context={context}
            departments={departments}
            savedDocId={savedDocs[i] ?? null}
            onSaved={(docId) => setSavedDocs((prev) => ({ ...prev, [i]: docId }))}
            defaultTitle={rerun && i === messages.length - 1 ? rerun.title : undefined}
          />
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

function previousUserPrompt(messages: PpChatMessage[], index: number): string | null {
  for (let i = index - 1; i >= 0; i--) if (messages[i].role === 'user') return messages[i].content
  return null
}

// User messages before an answer's own prompt — the places a saved
// conversation can start from. Oldest first.
function earlierUserPrompts(messages: PpChatMessage[], index: number): { index: number; content: string }[] {
  let own = -1
  for (let i = index - 1; i >= 0; i--) {
    if (messages[i].role === 'user') {
      own = i
      break
    }
  }
  const out: { index: number; content: string }[] = []
  for (let i = 0; i < own; i++) if (messages[i].role === 'user') out.push({ index: i, content: messages[i].content })
  return out
}

function MessageBubble({
  message,
  index,
  prompt,
  earlierPrompts,
  sessionId,
  context,
  departments,
  savedDocId,
  onSaved,
  defaultTitle,
}: {
  message: PpChatMessage
  index: number
  prompt: string | null
  earlierPrompts: { index: number; content: string }[]
  sessionId: string
  context: PpDepartment | null
  departments: PpDepartment[]
  savedDocId: string | null
  onSaved: (docId: string) => void
  defaultTitle?: string
}) {
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
      {prompt && (
        <SaveWorkflow
          index={index}
          prompt={prompt}
          earlierPrompts={earlierPrompts}
          sessionId={sessionId}
          context={context}
          departments={departments}
          savedDocId={savedDocId}
          onSaved={onSaved}
          defaultTitle={defaultTitle}
        />
      )}
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

// "Save as workflow doc" (spec §11): files this answer + its prompt under a
// department. Title is generated from the prompt and editable; department
// comes from the session's context or a select. Referenced tools and
// sources are derived server-side.
function SaveWorkflow({
  index,
  prompt,
  earlierPrompts,
  sessionId,
  context,
  departments,
  savedDocId,
  onSaved,
  defaultTitle,
}: {
  index: number
  prompt: string
  earlierPrompts: { index: number; content: string }[]
  sessionId: string
  context: PpDepartment | null
  departments: PpDepartment[]
  savedDocId: string | null
  onSaved: (docId: string) => void
  defaultTitle?: string
}) {
  const [open, setOpen] = useState(false)
  // Scope: '' = this answer only; otherwise the index of the user message the
  // saved conversation starts from (through this answer).
  const [startIndex, setStartIndex] = useState<string>('')
  const scopePrompt = startIndex === '' ? prompt : earlierPrompts.find((p) => String(p.index) === startIndex)?.content ?? prompt
  const suggested = defaultTitle ?? generateWorkflowTitle(scopePrompt).title
  const [title, setTitle] = useState(suggested)
  const [departmentId, setDepartmentId] = useState(context?.id ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const dept = departments.find((d) => d.id === (savedDocId ? departmentId : departmentId))

  async function save() {
    if (!departmentId || !title.trim()) return
    setSaving(true)
    setError(null)
    try {
      const res = await fetch('/api/post-pulse/workflow-docs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // titleAuto: the user left the suggestion untouched, so the server may
        // replace a merely-clipped suggestion with a real summary.
        body: JSON.stringify({
          sessionId,
          messageIndex: index,
          departmentId,
          title,
          titleAuto: !defaultTitle && title === suggested,
          ...(startIndex !== '' ? { startIndex: Number(startIndex) } : {}),
        }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error ?? `Request failed (${res.status})`)
      onSaved(body.id)
      setOpen(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save')
    } finally {
      setSaving(false)
    }
  }

  if (savedDocId) {
    return (
      <p className="mt-3 pt-2 border-t border-cream-300/70 text-xs text-ink-100">
        Saved as a workflow doc{dept ? ` under ${dept.name}` : ''}.{' '}
        {dept && (
          <Link href={`/post-pulse/departments/${dept.slug}/workflows/${savedDocId}`} className="text-press-accent hover:underline">
            View →
          </Link>
        )}
      </p>
    )
  }

  return (
    <div className="mt-3 pt-2 border-t border-cream-300/70">
      {!open ? (
        <button type="button" onClick={() => setOpen(true)} className="text-xs text-ink-100 hover:text-press-accent">
          {defaultTitle ? 'Save as new version of the workflow doc' : 'Save as workflow doc'}
        </button>
      ) : (
        <div className="flex flex-col gap-2 text-xs">
          {earlierPrompts.length > 0 && (
            <label className="flex flex-col gap-1">
              <span className="text-ink-100">What to keep</span>
              <select
                value={startIndex}
                onChange={(e) => {
                  const next = e.target.value
                  const nextPrompt = next === '' ? prompt : earlierPrompts.find((p) => String(p.index) === next)?.content ?? prompt
                  setStartIndex(next)
                  if (!defaultTitle && title === suggested) setTitle(generateWorkflowTitle(nextPrompt).title)
                }}
                className="rounded-md border border-cream-300 bg-cream-100 px-2 py-1.5 text-sm text-ink-300 focus:outline-none focus:border-press-accent/60"
              >
                <option value="">This answer only</option>
                <option value={String(earlierPrompts[0].index)}>The whole conversation up to here</option>
                {earlierPrompts.slice(1).map((p) => (
                  <option key={p.index} value={String(p.index)}>
                    From: {p.content.replace(/\s+/g, ' ').slice(0, 60)}
                    {p.content.length > 60 ? '…' : ''}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className="flex flex-col gap-1">
            <span className="text-ink-100">Title</span>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="rounded-md border border-cream-300 bg-cream-100 px-2 py-1.5 text-sm text-ink-300 focus:outline-none focus:border-press-accent/60"
            />
          </label>
          {context ? (
            <p className="text-ink-50">Filed under {context.name}.</p>
          ) : (
            <label className="flex items-center gap-2">
              <span className="text-ink-100">Department</span>
              <select
                value={departmentId}
                onChange={(e) => setDepartmentId(e.target.value)}
                className="rounded-md border border-cream-300 bg-cream-100 px-2 py-1 text-sm text-ink-300 focus:outline-none focus:border-press-accent/60"
              >
                <option value="">Choose…</option>
                {departments.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          {error && <p className="text-press-down">{error}</p>}
          <div className="flex gap-2">
            <button
              type="button"
              disabled={saving || !departmentId || !title.trim()}
              onClick={save}
              className="px-3 py-1.5 rounded-lg bg-press-accent text-white font-medium hover:bg-brand-600 disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
            <button type="button" onClick={() => setOpen(false)} className="px-3 py-1.5 rounded-lg border border-cream-400 text-ink-200 hover:bg-cream-200">
              Cancel
            </button>
          </div>
        </div>
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
