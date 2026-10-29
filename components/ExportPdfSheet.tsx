'use client'

// "Export PDF" on a channel's history page: a button and the small sheet
// it opens (date range, order, what the selection holds, Generate, then a
// download link). The work happens in /api/channels/[id]/export.
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

type RangeKind = 'all' | '30' | '90' | 'custom'
type Order = 'oldest' | 'newest'

interface Split { from: string; to: string; count: number; pages: number }

interface Summary {
  count: number
  estimatedPages: number
  firstDay: string | null
  lastDay: string | null
  overLimit: string | null
  splits: Split[]
  cached: boolean
  limits: { briefings: number; pages: number }
}

type Job =
  | { state: 'idle' }
  | { state: 'running'; label: string; fraction: number | null }
  | { state: 'ready'; url: string; filename: string; pages?: number; bytes?: number; cached: boolean; expiresAt: number; notes?: { what: string; count: number }[] }
  | { state: 'empty' | 'error'; message: string }
  | { state: 'too_large'; message: string; splits: Split[] }

const RANGES: { kind: RangeKind; label: string }[] = [
  { kind: 'all', label: 'All time' },
  { kind: '30', label: 'Last 30 days' },
  { kind: '90', label: 'Last 90 days' },
  { kind: 'custom', label: 'Custom' },
]

function todayEt(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date())
}

function shortDay(day: string): string {
  return new Date(`${day}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
}

function sizeLabel(bytes: number): string {
  return bytes >= 1_048_576 ? `${(bytes / 1_048_576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`
}

function Pill({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`min-h-[44px] px-3.5 font-chrome text-[11px] uppercase tracking-[1px] border-[0.5px] transition-colors ${
        active ? 'bg-press-accent text-white border-press-accent' : 'bg-white/40 text-press-body border-press-hair hover:border-press-accent/50'
      }`}
    >
      {children}
    </button>
  )
}

export function ExportPdfButton({ channelId, channelName }: { channelId: string; channelName: string }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="min-h-[44px] min-w-[44px] flex items-center gap-1.5 px-2.5 font-chrome text-[10px] uppercase tracking-[1.5px] text-press-accent hover:bg-press-accent/10 transition-colors flex-shrink-0"
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 4v11m0 0l-4-4m4 4l4-4M5 19h14" />
        </svg>
        <span>Export PDF</span>
      </button>
      {/* Portalled: the button sits in a sticky header whose backdrop blur
          would otherwise become the sheet's containing block */}
      {open && createPortal(<ExportPdfSheet channelId={channelId} channelName={channelName} onClose={() => setOpen(false)} />, document.body)}
    </>
  )
}

function ExportPdfSheet({ channelId, channelName, onClose }: { channelId: string; channelName: string; onClose: () => void }) {
  const [range, setRange] = useState<RangeKind>('all')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState(todayEt())
  const [order, setOrder] = useState<Order>('oldest')
  const [summary, setSummary] = useState<Summary | null>(null)
  const [summaryError, setSummaryError] = useState<string | null>(null)
  const [loadingSummary, setLoadingSummary] = useState(false)
  const [job, setJob] = useState<Job>({ state: 'idle' })
  const abortRef = useRef<AbortController | null>(null)

  const customReady = range !== 'custom' || (from !== '' && to !== '' && from <= to)
  const query = () => {
    const p = new URLSearchParams({ range, order })
    if (range === 'custom') { p.set('from', from); p.set('to', to) }
    return p
  }

  // What the selection holds, refreshed whenever it changes
  useEffect(() => {
    if (!customReady) { setSummary(null); return }
    const ctrl = new AbortController()
    setLoadingSummary(true)
    setSummaryError(null)
    const t = setTimeout(() => {
      fetch(`/api/channels/${channelId}/export?${query()}`, { signal: ctrl.signal })
        .then(async (res) => {
          const data = await res.json()
          if (!res.ok) throw new Error(data.error ?? 'Could not count briefings')
          setSummary(data)
        })
        .catch((err) => { if (!ctrl.signal.aborted) setSummaryError((err as Error).message) })
        .finally(() => { if (!ctrl.signal.aborted) setLoadingSummary(false) })
    }, 200)
    setJob({ state: 'idle' })
    return () => { clearTimeout(t); ctrl.abort() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channelId, range, from, to, order, customReady])

  useEffect(() => () => abortRef.current?.abort(), [])

  // Re-render when the signed link runs out so the sheet offers Generate again
  const [, setTick] = useState(0)
  const expiresAt = job.state === 'ready' ? job.expiresAt : 0
  useEffect(() => {
    if (!expiresAt) return
    const t = setTimeout(() => setTick((n) => n + 1), Math.max(0, expiresAt - Date.now()) + 50)
    return () => clearTimeout(t)
  }, [expiresAt])

  // Escape closes, as with the other sheets
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  async function generate() {
    abortRef.current?.abort()
    const ctrl = new AbortController()
    abortRef.current = ctrl
    setJob({ state: 'running', label: 'Loading briefings', fraction: null })
    try {
      const res = await fetch(`/api/channels/${channelId}/export`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ range, order, ...(range === 'custom' ? { from, to } : {}) }),
        signal: ctrl.signal,
      })
      if (!res.ok || !res.body) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error ?? `Export failed (${res.status})`)
      }
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let finished = false
      for (;;) {
        const { value, done } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        let nl: number
        while ((nl = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, nl).trim()
          buffer = buffer.slice(nl + 1)
          if (!line) continue
          const ev = JSON.parse(line)
          if (ev.type === 'progress') {
            const label = ev.phase === 'layout' ? `Setting type: briefing ${ev.done} of ${ev.total}`
              : ev.phase === 'draw' ? `Printing page ${ev.done} of ${ev.total}`
              : ev.phase === 'saving' ? 'Saving the PDF'
              : 'Loading briefings'
            const fraction = ev.phase === 'layout' ? (ev.done / ev.total) * 0.55
              : ev.phase === 'draw' ? 0.55 + (ev.done / ev.total) * 0.4
              : ev.phase === 'saving' ? 0.97 : null
            setJob({ state: 'running', label, fraction })
          } else if (ev.type === 'ready') {
            finished = true
            setJob({ state: 'ready', url: ev.url, filename: ev.filename, pages: ev.pages, bytes: ev.bytes, cached: ev.cached, notes: ev.notes, expiresAt: Date.now() + ev.expiresIn * 1000 })
          } else if (ev.type === 'empty' || ev.type === 'error') {
            finished = true
            setJob({ state: ev.type, message: ev.message })
          } else if (ev.type === 'too_large') {
            finished = true
            setJob({ state: 'too_large', message: ev.message, splits: ev.splits ?? [] })
          }
        }
      }
      if (!finished) throw new Error('The export stopped before it finished. Try again.')
    } catch (err) {
      if (ctrl.signal.aborted) return
      setJob({ state: 'error', message: (err as Error).message })
    }
  }

  function applySplit(split: Split) {
    setRange('custom')
    setFrom(split.from)
    setTo(split.to)
  }

  const splits = job.state === 'too_large' ? job.splits : summary?.overLimit ? summary.splits : []
  const overMessage = job.state === 'too_large' ? job.message : summary?.overLimit ?? null
  const canGenerate = customReady && !!summary && summary.count > 0 && !summary.overLimit && job.state !== 'running' && !loadingSummary
  const expired = job.state === 'ready' && Date.now() > job.expiresAt

  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label={`Export ${channelName} as PDF`}>
      <div className="fixed inset-0 bg-ink-300/20 backdrop-blur-[2px]" onClick={onClose} />
      <div className="fixed bottom-0 inset-x-0 paper-page shadow-[0_-8px_40px_rgba(60,50,80,0.14)] animate-slide-up max-h-[90dvh] overflow-y-auto pb-[env(safe-area-inset-bottom)]">
        <div className="max-w-xl mx-auto px-4 pt-3 pb-6">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 pt-2">
              <p className="press-label">Export PDF</p>
              <h2 className="font-georgia text-[20px] tracking-[-0.3px] text-press-ink truncate">{channelName}</h2>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="min-h-[44px] min-w-[44px] flex items-center justify-center text-press-muted hover:text-press-ink"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          <div className="press-rule-h mt-2 mb-4" />

          <p className="font-chrome text-[9px] uppercase tracking-[2px] text-press-muted mb-2">Date range</p>
          <div className="flex flex-wrap gap-2">
            {RANGES.map((r) => (
              <Pill key={r.kind} active={range === r.kind} onClick={() => setRange(r.kind)}>{r.label}</Pill>
            ))}
          </div>
          {range === 'custom' && (
            <div className="grid grid-cols-2 gap-3 mt-3">
              <label className="font-chrome text-[10px] uppercase tracking-[1px] text-press-muted">
                From
                <input type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)}
                  className="mt-1 block w-full min-h-[44px] bg-white/50 border-[0.5px] border-press-hair px-2 font-chrome text-[14px] normal-case tracking-normal text-press-ink" />
              </label>
              <label className="font-chrome text-[10px] uppercase tracking-[1px] text-press-muted">
                To
                <input type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)}
                  className="mt-1 block w-full min-h-[44px] bg-white/50 border-[0.5px] border-press-hair px-2 font-chrome text-[14px] normal-case tracking-normal text-press-ink" />
              </label>
            </div>
          )}

          <p className="font-chrome text-[9px] uppercase tracking-[2px] text-press-muted mt-5 mb-2">Order</p>
          <div className="flex flex-wrap gap-2">
            <Pill active={order === 'oldest'} onClick={() => setOrder('oldest')}>Oldest first</Pill>
            <Pill active={order === 'newest'} onClick={() => setOrder('newest')}>Newest first</Pill>
          </div>

          {/* What the selection holds */}
          <div className="mt-5 border-t-[0.5px] border-b-[0.5px] border-press-hair py-3 min-h-[52px]" aria-live="polite">
            {!customReady ? (
              <p className="font-georgia italic text-[13px] text-press-muted">Pick a start and end date.</p>
            ) : summaryError ? (
              <p className="font-georgia text-[13px] text-press-down">{summaryError}</p>
            ) : !summary || loadingSummary ? (
              <p className="font-georgia italic text-[13px] text-press-muted">Counting briefings…</p>
            ) : summary.count === 0 ? (
              <p className="font-georgia text-[13px] text-press-ink">No briefings in this range, so there is nothing to export.</p>
            ) : (
              <p className="font-georgia text-[14px] text-press-ink">
                {summary.count} briefing{summary.count === 1 ? '' : 's'} · about {summary.estimatedPages} pages
                {summary.firstDay && summary.lastDay && (
                  <span className="block font-chrome text-[10px] uppercase tracking-[1px] text-press-muted mt-1">
                    {summary.firstDay === summary.lastDay ? shortDay(summary.firstDay) : `${shortDay(summary.firstDay)} to ${shortDay(summary.lastDay)}`}
                    {summary.cached && ' · ready, no wait'}
                  </span>
                )}
              </p>
            )}
          </div>

          {/* Too big for one export: offer date ranges that each fit */}
          {overMessage && (
            <div className="mt-4 p-3 bg-press-accent/[0.06] border-l-2 border-press-accent">
              <p className="font-georgia text-[13px] text-press-ink">{overMessage}</p>
              {splits.length > 0 && (
                <>
                  <p className="font-georgia text-[13px] text-press-body mt-1">Split it by date and export each part:</p>
                  <div className="mt-2 flex flex-col gap-1.5">
                    {splits.map((s) => (
                      <button key={`${s.from}-${s.to}`} type="button" onClick={() => applySplit(s)}
                        className="min-h-[44px] text-left px-3 bg-white/50 border-[0.5px] border-press-hair hover:border-press-accent/50 font-chrome text-[12px] text-press-ink">
                        {shortDay(s.from)} to {shortDay(s.to)}
                        <span className="text-press-muted"> · {s.count} briefings · about {s.pages} pages</span>
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}

          {/* Generate, progress, result */}
          <div className="mt-5">
            {job.state === 'running' ? (
              <div aria-live="polite">
                <div className="h-[3px] bg-press-hair overflow-hidden">
                  <div
                    className={`h-full bg-press-accent transition-[width] duration-300 ${job.fraction === null ? 'w-1/4 animate-pulse' : ''}`}
                    style={job.fraction === null ? undefined : { width: `${Math.round(job.fraction * 100)}%` }}
                  />
                </div>
                <p className="font-chrome text-[11px] text-press-muted mt-2">{job.label}…</p>
              </div>
            ) : job.state === 'ready' && !expired ? (
              <div>
                <a
                  href={job.url}
                  download={job.filename}
                  className="min-h-[44px] w-full flex items-center justify-center gap-2 bg-press-ink text-white font-chrome text-[12px] uppercase tracking-[1.5px] hover:bg-press-accent transition-colors"
                >
                  Download PDF
                </a>
                <p className="font-chrome text-[10px] text-press-muted mt-2">
                  {[job.pages && `${job.pages} pages`, job.bytes && sizeLabel(job.bytes), job.cached && 'unchanged since the last export'].filter(Boolean).join(' · ')}
                  {' · '}The link works for 5 minutes.
                </p>
                {job.notes && job.notes.length > 0 && (
                  <p className="font-chrome text-[10px] text-press-faint mt-1.5 leading-relaxed">
                    Not carried over: {job.notes.map((n) => n.what).join('; ')}.
                  </p>
                )}
              </div>
            ) : (
              <>
                {(job.state === 'error' || job.state === 'empty') && (
                  <p className="font-georgia text-[13px] text-press-down mb-3">{job.message}</p>
                )}
                {expired && <p className="font-georgia italic text-[13px] text-press-muted mb-3">The download link expired. Generate again; an unchanged export is ready at once.</p>}
                <button
                  type="button"
                  onClick={generate}
                  disabled={!canGenerate}
                  className="min-h-[44px] w-full bg-press-accent text-white font-chrome text-[12px] uppercase tracking-[1.5px] disabled:opacity-40 disabled:cursor-not-allowed hover:bg-press-ink transition-colors"
                >
                  Generate
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
