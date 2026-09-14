'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import type { PpPipelineStage, PpResearchRunSummary } from '@/lib/post-pulse-types'

interface Props {
  // A department scopes the run to itself; a stage runs a frontier scan
  // (spec §5a); neither = the full maintenance sweep.
  department?: { id: string; name: string }
  stage?: { value: PpPipelineStage; label: string }
  compact?: boolean
}

// Manual research triggers (spec §5): "Research this department now" on a
// department doc, "Run a full sweep now" on the pipeline map. Runs the
// same mechanism as the scheduled cron and reports what it found, with
// links to the queue and the briefing it wrote.
export function ResearchButton({ department, stage, compact }: Props) {
  const router = useRouter()
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState<PpResearchRunSummary | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function run() {
    setRunning(true)
    setError(null)
    setResult(null)
    try {
      const res = await fetch('/api/post-pulse/research', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(stage ? { stage: stage.value } : department ? { departmentId: department.id } : {}),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error ?? `Request failed (${res.status})`)
      setResult(body as PpResearchRunSummary)
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The research run failed')
    } finally {
      setRunning(false)
    }
  }

  const done = result?.departments.filter((d) => d.status === 'done') ?? []
  const failed = result?.departments.filter((d) => d.status === 'failed') ?? []
  const published = done.reduce((n, d) => n + d.published.length, 0)
  const queued = done.reduce((n, d) => n + d.queued.length, 0)
  const confirmed = done.reduce((n, d) => n + d.confirmed.length, 0)
  const scans = result?.frontier ?? []
  const scansDone = scans.filter((f) => f.status === 'done')
  const scanQueued = scansDone.reduce((n, f) => n + f.queued.length, 0)

  return (
    <div className={compact ? 'inline-flex flex-col items-start gap-1.5' : 'flex flex-col gap-2'}>
      <button
        type="button"
        onClick={run}
        disabled={running}
        className="inline-flex items-center gap-2 rounded-lg border border-cream-400 bg-cream-50 px-3 py-1.5 text-sm text-ink-200 hover:border-press-accent hover:text-press-accent disabled:opacity-60 disabled:cursor-wait transition-colors"
      >
        {running ? (
          <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
        ) : (
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M21 21l-4.35-4.35M11 18a7 7 0 100-14 7 7 0 000 14z" />
          </svg>
        )}
        {running
          ? stage
            ? `Scanning the ${stage.label} frontier…`
            : department
              ? `Researching ${department.name}…`
              : 'Sweeping every department…'
          : stage
            ? 'Frontier scan this stage'
            : department
              ? 'Research this department now'
              : 'Run a full sweep now'}
      </button>
      {running && (
        <p className="text-[11px] text-ink-50">
          {stage
            ? 'Open-ended: what AI exists for this stage that the dataset does not track. Three to four minutes; everything it finds goes to the queue tagged Frontier.'
            : department
              ? 'Usually three to four minutes at the current search budget.'
              : 'About four departments fit in one run; the rest stay due for the next daily run.'}
        </p>
      )}
      {error && <p className="text-xs text-press-down">{error}</p>}
      {result && (
        <div className="rounded-lg border border-cream-300 bg-cream-50 px-3 py-2 text-xs text-ink-200 max-w-md">
          {stage ? (
            <p>
              {scansDone.length ? (
                <>
                  Frontier scan of {scansDone.map((f) => f.stageLabel).join(', ')}: {scansDone.reduce((n, f) => n + f.searches, 0)} searches,{' '}
                  {scansDone.reduce((n, f) => n + f.findings, 0)} findings, {scanQueued} queued for review
                  {scansDone.some((f) => f.skippedExisting.length) ? `, ${scansDone.reduce((n, f) => n + f.skippedExisting.length, 0)} already tracked` : ''}.
                </>
              ) : (
                <>Frontier scan did not complete{scans[0]?.error ? `: ${scans[0].error}` : ''}.</>
              )}
            </p>
          ) : (
          <p>
            Checked {done.length} {done.length === 1 ? 'department' : 'departments'}
            {failed.length ? `, ${failed.length} failed` : ''}
            {result.remainingDepartmentIds.length ? `, ${result.remainingDepartmentIds.length} not reached` : ''}. {published} published, {queued} queued for
            review, {confirmed} confirmed unchanged.
            {result.rss.errors.length > 0 && (
              <span className="text-ink-50"> Feed errors: {result.rss.errors.map((e) => e.source).join(', ')}.</span>
            )}
          </p>
          )}
          <p className="mt-1 flex flex-wrap gap-x-3">
            {(queued > 0 || scanQueued > 0) && (
              <Link href="/post-pulse/queue" className="text-press-accent hover:underline">
                Review queue →
              </Link>
            )}
            <Link href="/post-pulse/activity" className="text-press-accent hover:underline">
              See activity →
            </Link>
            <span className="text-ink-50">${result.costUsd.toFixed(2)}</span>
          </p>
        </div>
      )}
    </div>
  )
}
