'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'

interface Props {
  docId: string
  departmentSlug: string
  stale: boolean
  lastVerifiedAt: string | null
}

// Re-run / Mark still accurate / Delete for a workflow doc (spec §11).
// Re-run is a link into chat: the department's current session (or a new
// one) receives the saved prompt as a fresh turn; nothing here overwrites.
export function WorkflowDocActions({ docId, departmentSlug, stale, lastVerifiedAt }: Props) {
  const router = useRouter()
  const [busy, setBusy] = useState<'verify' | 'delete' | null>(null)
  const [verifiedAt, setVerifiedAt] = useState(lastVerifiedAt)
  const [error, setError] = useState<string | null>(null)

  async function verify() {
    setBusy('verify')
    setError(null)
    try {
      const res = await fetch(`/api/post-pulse/workflow-docs/${docId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'verify' }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error ?? `Request failed (${res.status})`)
      setVerifiedAt(body.lastVerifiedAt)
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not verify')
    } finally {
      setBusy(null)
    }
  }

  async function remove() {
    setBusy('delete')
    setError(null)
    try {
      const res = await fetch(`/api/post-pulse/workflow-docs/${docId}`, { method: 'DELETE' })
      if (!res.ok) throw new Error(`Request failed (${res.status})`)
      router.push(`/post-pulse/departments/${departmentSlug}`)
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not delete')
      setBusy(null)
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Link
        href={`/post-pulse/chat/start?dept=${departmentSlug}&rerun=${docId}`}
        className="inline-flex items-center gap-2 rounded-lg bg-press-accent px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-600 transition-colors"
      >
        Re-run in chat
      </Link>
      <button
        type="button"
        disabled={busy !== null}
        onClick={verify}
        className="inline-flex items-center gap-2 rounded-lg border border-cream-400 bg-cream-50 px-3 py-1.5 text-sm text-ink-200 hover:border-press-accent hover:text-press-accent disabled:opacity-50 transition-colors"
      >
        {busy === 'verify' ? 'Marking…' : 'Mark still accurate'}
      </button>
      <button
        type="button"
        disabled={busy !== null}
        onClick={remove}
        className="text-xs text-ink-50 hover:text-press-down disabled:opacity-50"
      >
        {busy === 'delete' ? 'Deleting…' : 'Delete'}
      </button>
      <span className="text-[11px] text-ink-50">
        {verifiedAt
          ? `Verified ${new Date(verifiedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`
          : 'Not verified since it was saved'}
        {stale && !verifiedAt ? '' : ''}
      </span>
      {error && <span className="text-xs text-press-down">{error}</span>}
    </div>
  )
}
