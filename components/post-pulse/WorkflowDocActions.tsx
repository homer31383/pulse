'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { usePostPulse } from './Shell'

interface Props {
  docId: string
  departmentSlug: string
  stale: boolean
  lastVerifiedAt: string | null
  filing: { departmentId: string; alsoDepartmentIds: string[] }
}

// Re-run / Mark still accurate / Delete for a workflow doc (spec §11).
// Re-run is a link into chat: the department's current session (or a new
// one) receives the saved prompt as a fresh turn; nothing here overwrites.
export function WorkflowDocActions({ docId, departmentSlug, stale, lastVerifiedAt, filing }: Props) {
  const router = useRouter()
  const { departments } = usePostPulse()
  const [busy, setBusy] = useState<'verify' | 'delete' | 'move' | null>(null)
  const [verifiedAt, setVerifiedAt] = useState(lastVerifiedAt)
  const [error, setError] = useState<string | null>(null)
  // "Filed under" editor: primary department + any additional ones.
  const [editing, setEditing] = useState(false)
  const [primaryId, setPrimaryId] = useState(filing.departmentId)
  const [alsoIds, setAlsoIds] = useState<string[]>(filing.alsoDepartmentIds)

  async function move() {
    setBusy('move')
    setError(null)
    try {
      const res = await fetch(`/api/post-pulse/workflow-docs/${docId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'move', departmentId: primaryId, alsoDepartmentIds: alsoIds.filter((x) => x !== primaryId) }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error ?? `Request failed (${res.status})`)
      setEditing(false)
      // The URL is anchored on the primary department; follow it if it changed.
      if (body.primarySlug && body.primarySlug !== departmentSlug) router.push(`/post-pulse/departments/${body.primarySlug}/workflows/${docId}`)
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not change filing')
    } finally {
      setBusy(null)
    }
  }

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
    <div className="flex flex-col gap-2">
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
        onClick={() => setEditing((v) => !v)}
        className="inline-flex items-center gap-2 rounded-lg border border-cream-400 bg-cream-50 px-3 py-1.5 text-sm text-ink-200 hover:border-press-accent hover:text-press-accent disabled:opacity-50 transition-colors"
      >
        Change filing
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
      {editing && (
        <div className="rounded-xl border border-cream-300 bg-cream-50 px-4 py-3 text-sm max-w-xl">
          <label className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-ink-100">Primary department</span>
            <select
              value={primaryId}
              onChange={(e) => setPrimaryId(e.target.value)}
              className="rounded-md border border-cream-300 bg-cream-100 px-2 py-1 text-sm text-ink-300 focus:outline-none focus:border-press-accent/60"
            >
              {departments.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </label>
          <p className="text-xs text-ink-100 mt-3 mb-1">Also file under</p>
          <div className="grid sm:grid-cols-2 gap-x-4 gap-y-1">
            {departments
              .filter((d) => d.id !== primaryId)
              .map((d) => (
                <label key={d.id} className="flex items-center gap-2 text-xs text-ink-200">
                  <input
                    type="checkbox"
                    checked={alsoIds.includes(d.id)}
                    onChange={(e) => setAlsoIds((prev) => (e.target.checked ? [...prev, d.id] : prev.filter((x) => x !== d.id)))}
                    className="accent-[#6B5CA5]"
                  />
                  {d.name}
                </label>
              ))}
          </div>
          <div className="flex gap-2 mt-3">
            <button
              type="button"
              disabled={busy !== null}
              onClick={move}
              className="px-3 py-1.5 rounded-lg bg-press-accent text-white text-sm font-medium hover:bg-brand-600 disabled:opacity-50"
            >
              {busy === 'move' ? 'Saving…' : 'Save filing'}
            </button>
            <button type="button" onClick={() => setEditing(false)} className="px-3 py-1.5 rounded-lg border border-cream-400 text-sm text-ink-200 hover:bg-cream-200">
              Cancel
            </button>
          </div>
          <p className="text-[11px] text-ink-50 mt-2">Referenced tools are re-matched against the new departments&apos; rosters when you save.</p>
        </div>
      )}
    </div>
  )
}
