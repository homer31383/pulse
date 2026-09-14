'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import type { PpChatSessionSummary } from '@/lib/post-pulse-types'
import { usePostPulse } from './Shell'

interface Props {
  sessions: PpChatSessionSummary[]
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const m = Math.round(diff / 60_000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.round(h / 24)
  if (d < 7) return `${d}d ago`
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

// Session list: most recent activity first, name + last-message snippet,
// department scope chip, new-session and delete affordances.
export function ChatSessionsClient({ sessions: initial }: Props) {
  const { departments } = usePostPulse()
  const router = useRouter()
  const [sessions, setSessions] = useState(initial)
  const [creating, setCreating] = useState(false)
  const [scope, setScope] = useState('')
  const [error, setError] = useState<string | null>(null)
  const deptById = new Map(departments.map((d) => [d.id, d]))

  async function createSession() {
    setCreating(true)
    setError(null)
    try {
      const res = await fetch('/api/post-pulse/chat/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ departmentContextId: scope || null }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error ?? `Request failed (${res.status})`)
      router.push(`/post-pulse/chat/${body.id}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start a session')
      setCreating(false)
    }
  }

  async function remove(id: string) {
    const res = await fetch(`/api/post-pulse/chat/sessions/${id}`, { method: 'DELETE' })
    if (res.ok) setSessions((prev) => prev.filter((s) => s.id !== id))
  }

  return (
    <div className="max-w-3xl">
      <header className="mb-5">
        <h1 className="font-display text-2xl text-ink-300">Research chat</h1>
        <p className="text-sm text-ink-100 mt-1">
          Ask about a tool, work out where it fits, or propose a department. Every proposal it makes lands in the review
          queue, not in the data.
        </p>
      </header>

      <div className="flex flex-wrap items-center gap-2 mb-6">
        <button
          type="button"
          disabled={creating}
          onClick={createSession}
          className="px-3.5 py-2 rounded-lg bg-press-accent text-white text-sm font-medium hover:bg-brand-600 disabled:opacity-50 transition-colors"
        >
          {creating ? 'Starting…' : 'New session'}
        </button>
        <label className="inline-flex items-center gap-1.5 text-xs text-ink-100">
          <span>scoped to</span>
          <select
            value={scope}
            onChange={(e) => setScope(e.target.value)}
            className="rounded-md border border-cream-300 bg-cream-50 px-2 py-1 text-xs text-ink-300 focus:outline-none focus:border-press-accent/60"
          >
            <option value="">No department</option>
            {departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </label>
        {error && <span className="text-xs text-press-down">{error}</span>}
      </div>

      {sessions.length === 0 ? (
        <p className="text-sm text-ink-50 py-10 text-center">No sessions yet. Start one above, or open one from a department doc.</p>
      ) : (
        <ul className="rounded-xl border border-cream-300 bg-cream-50 divide-y divide-cream-300/70">
          {sessions.map((s) => {
            const dept = s.department_context_id ? deptById.get(s.department_context_id) : null
            return (
              <li key={s.id} className="group flex gap-3 px-4 py-3 hover:bg-cream-100/70 transition-colors">
                <Link href={`/post-pulse/chat/${s.id}`} className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                    <span className="font-medium text-ink-300 group-hover:text-press-accent transition-colors">{s.name}</span>
                    {dept && (
                      <span className="text-[11px] px-1.5 py-px rounded-full bg-press-accent/10 text-press-accent">{dept.name}</span>
                    )}
                    <span className="text-[11px] text-ink-50 ml-auto">{relativeTime(s.updated_at)}</span>
                  </div>
                  <p className="text-sm text-ink-100 mt-0.5 line-clamp-1">
                    {s.lastMessage ? (
                      <>
                        <span className="text-ink-50">{s.lastRole === 'user' ? 'You: ' : ''}</span>
                        {s.lastMessage}
                      </>
                    ) : (
                      <span className="text-ink-50 italic">Empty session</span>
                    )}
                  </p>
                </Link>
                <button
                  type="button"
                  onClick={() => remove(s.id)}
                  aria-label={`Delete session ${s.name}`}
                  className="self-start p-1 rounded-md text-ink-50 opacity-0 group-hover:opacity-100 hover:text-press-down hover:bg-cream-200 transition-all"
                >
                  ×
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
