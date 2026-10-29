'use client'

// "Export PDF": a button and the sheet it opens (channels, date range,
// order, what the selection holds, Generate, then download links). One
// channel goes through /api/channels/[id]/export as before; two or more make
// a "Channel archive" through /api/archive-export, in volumes when the
// selection is too big for one file.
import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

export interface ExportChannel { id: string; name: string; recapGroup: 'pulse' | 'post_pulse' }

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

interface ArchiveSummary {
  count: number
  estimatedPages: number
  estimatedVolumes: number
  channels: { id: string; name: string; count: number }[]
  empty: string[]
  firstDay: string | null
  lastDay: string | null
  tooMany: string | null
  limits: { briefings: number; pages: number }
}

type Job =
  | { state: 'idle' }
  | { state: 'running'; label: string; fraction: number | null }
  | { state: 'ready'; url: string; filename: string; pages?: number; bytes?: number; cached: boolean; expiresAt: number; notes?: { what: string; count: number }[] }
  | { state: 'empty' | 'error'; message: string }
  | { state: 'too_large'; message: string; splits: Split[] }

interface Volume { index: number; filename: string; pages: number; briefings: number; channels: string[] }
interface VolumeState {
  status: 'waiting' | 'running' | 'ready' | 'pending'
  label?: string
  fraction?: number | null
  url?: string
  bytes?: number
  cached?: boolean
  expiresAt?: number
}
interface ArchiveJob {
  state: 'idle' | 'running' | 'finished' | 'empty' | 'error'
  message?: string
  label?: string
  fraction?: number | null
  plan: Volume[] | null
  vols: Record<number, VolumeState>
  expectVolumes?: number
  notes?: { what: string; count: number }[]
}

const IDLE_ARCHIVE: ArchiveJob = { state: 'idle', plan: null, vols: {} }

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

function volumeName(v: Volume, count: number): string {
  return count > 1 ? `Pulse archive vol ${v.index + 1} of ${count}` : 'Pulse archive'
}

// Reads an NDJSON response line by line
async function readLines(res: Response, onEvent: (ev: Record<string, unknown> & { type: string }) => void) {
  if (!res.body) throw new Error('No response')
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    let nl: number
    while ((nl = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, nl).trim()
      buffer = buffer.slice(nl + 1)
      if (line) onEvent(JSON.parse(line))
    }
  }
}

function phaseLabel(ev: Record<string, unknown>): { label: string; fraction: number | null } {
  const done = Number(ev.done)
  const total = Number(ev.total) || 1
  if (ev.phase === 'layout') return { label: `Setting type: briefing ${done} of ${total}`, fraction: (done / total) * 0.55 }
  if (ev.phase === 'draw') return { label: `Printing page ${done} of ${total}`, fraction: 0.55 + (done / total) * 0.4 }
  if (ev.phase === 'saving') return { label: 'Saving the PDF', fraction: 0.97 }
  if (ev.phase === 'plan') return { label: `Planning the volumes: briefing ${done} of ${total}`, fraction: done / total }
  return { label: 'Loading briefings', fraction: null }
}

function Pill({ active, onClick, disabled, children }: { active: boolean; onClick: () => void; disabled?: boolean; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={active}
      className={`min-h-[44px] px-3.5 font-chrome text-[11px] uppercase tracking-[1px] border-[0.5px] transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
        active ? 'bg-press-accent text-white border-press-accent' : 'bg-white/40 text-press-body border-press-hair hover:border-press-accent/50'
      }`}
    >
      {children}
    </button>
  )
}

function ProgressBar({ fraction }: { fraction: number | null | undefined }) {
  return (
    <div className="h-[3px] bg-press-hair overflow-hidden">
      <div
        className={`h-full bg-press-accent transition-[width] duration-300 ${fraction == null ? 'w-1/4 animate-pulse' : ''}`}
        style={fraction == null ? undefined : { width: `${Math.round(fraction * 100)}%` }}
      />
    </div>
  )
}

// channels: the profile's channels in app order. preselect: ids ticked when
// the sheet opens (the channel history page passes its channel).
export function ExportPdfButton({ channels, preselect = [] }: { channels: ExportChannel[]; preselect?: string[] }) {
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
      {open && createPortal(
        <ExportPdfSheet channels={channels} preselect={preselect.filter((id) => channels.some((c) => c.id === id))} onClose={() => setOpen(false)} />,
        document.body,
      )}
    </>
  )
}

function ExportPdfSheet({ channels, preselect, onClose }: { channels: ExportChannel[]; preselect: string[]; onClose: () => void }) {
  const [selected, setSelected] = useState<Set<string>>(() => new Set(preselect))
  const [range, setRange] = useState<RangeKind>('all')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState(todayEt())
  const [order, setOrder] = useState<Order>('oldest')
  const [summary, setSummary] = useState<Summary | null>(null)
  const [archiveSummary, setArchiveSummary] = useState<ArchiveSummary | null>(null)
  const [summaryError, setSummaryError] = useState<string | null>(null)
  const [loadingSummary, setLoadingSummary] = useState(false)
  const [job, setJob] = useState<Job>({ state: 'idle' })
  const [archive, setArchive] = useState<ArchiveJob>(IDLE_ARCHIVE)
  const abortRef = useRef<AbortController | null>(null)

  // Selection in app order; one channel is the single-channel export
  const chosen = useMemo(() => channels.filter((c) => selected.has(c.id)), [channels, selected])
  const mode: 'none' | 'single' | 'archive' = chosen.length === 0 ? 'none' : chosen.length === 1 ? 'single' : 'archive'
  const single = mode === 'single' ? chosen[0] : null
  const selectionKey = chosen.map((c) => c.id).join(',')

  const groups = useMemo(() => ({
    all: channels.map((c) => c.id),
    pulse: channels.filter((c) => c.recapGroup === 'pulse').map((c) => c.id),
    post: channels.filter((c) => c.recapGroup === 'post_pulse').map((c) => c.id),
  }), [channels])
  const isExactly = (ids: string[]) => ids.length > 0 && ids.length === selected.size && ids.every((id) => selected.has(id))

  const customReady = range !== 'custom' || (from !== '' && to !== '' && from <= to)
  const query = () => {
    const p = new URLSearchParams({ range, order })
    if (range === 'custom') { p.set('from', from); p.set('to', to) }
    return p
  }

  // What the selection holds, refreshed whenever it changes
  useEffect(() => {
    abortRef.current?.abort()
    setJob({ state: 'idle' })
    setArchive(IDLE_ARCHIVE)
    setSummary(null)
    setArchiveSummary(null)
    setSummaryError(null)
    if (!customReady || mode === 'none') return
    const ctrl = new AbortController()
    setLoadingSummary(true)
    const t = setTimeout(() => {
      const url = mode === 'single'
        ? `/api/channels/${single!.id}/export?${query()}`
        : `/api/archive-export?${new URLSearchParams({ channels: selectionKey, ...Object.fromEntries(query()) })}`
      fetch(url, { signal: ctrl.signal })
        .then(async (res) => {
          const data = await res.json()
          if (!res.ok) throw new Error(data.error ?? 'Could not count briefings')
          if (mode === 'single') setSummary(data)
          else setArchiveSummary(data)
        })
        .catch((err) => { if (!ctrl.signal.aborted) setSummaryError((err as Error).message) })
        .finally(() => { if (!ctrl.signal.aborted) setLoadingSummary(false) })
    }, 250)
    return () => { clearTimeout(t); ctrl.abort() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectionKey, range, from, to, order, customReady])

  useEffect(() => () => abortRef.current?.abort(), [])

  // Re-render when a signed link runs out so the sheet offers a new one
  const [, setTick] = useState(0)
  const nextExpiry = Math.min(
    job.state === 'ready' ? job.expiresAt : Infinity,
    ...Object.values(archive.vols).map((v) => v.expiresAt ?? Infinity),
  )
  useEffect(() => {
    if (!Number.isFinite(nextExpiry)) return
    const t = setTimeout(() => setTick((n) => n + 1), Math.max(0, nextExpiry - Date.now()) + 50)
    return () => clearTimeout(t)
  }, [nextExpiry])

  // Escape closes, as with the other sheets
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function generate() {
    abortRef.current?.abort()
    const ctrl = new AbortController()
    abortRef.current = ctrl
    setJob({ state: 'running', label: 'Loading briefings', fraction: null })
    try {
      const res = await fetch(`/api/channels/${single!.id}/export`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ range, order, ...(range === 'custom' ? { from, to } : {}) }),
        signal: ctrl.signal,
      })
      if (!res.ok || !res.body) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error ?? `Export failed (${res.status})`)
      }
      let finished = false
      await readLines(res, (ev) => {
        if (ev.type === 'progress') {
          setJob({ state: 'running', ...phaseLabel(ev) })
        } else if (ev.type === 'ready') {
          finished = true
          setJob({ state: 'ready', url: String(ev.url), filename: String(ev.filename), pages: ev.pages as number | undefined, bytes: ev.bytes as number | undefined, cached: !!ev.cached, notes: ev.notes as { what: string; count: number }[] | undefined, expiresAt: Date.now() + Number(ev.expiresIn) * 1000 })
        } else if (ev.type === 'empty' || ev.type === 'error') {
          finished = true
          setJob({ state: ev.type, message: String(ev.message) })
        } else if (ev.type === 'too_large') {
          finished = true
          setJob({ state: 'too_large', message: String(ev.message), splits: (ev.splits as Split[]) ?? [] })
        }
      })
      if (!finished) throw new Error('The export stopped before it finished. Try again.')
    } catch (err) {
      if (ctrl.signal.aborted) return
      setJob({ state: 'error', message: (err as Error).message })
    }
  }

  // Builds every volume, or only the given ones (pending, or a fresh link)
  async function generateArchive(only?: number[]) {
    abortRef.current?.abort()
    const ctrl = new AbortController()
    abortRef.current = ctrl
    setArchive((prev) => only
      ? { ...prev, state: 'running', label: 'Planning the volumes', fraction: null, vols: { ...prev.vols, ...Object.fromEntries(only.map((i) => [i, { status: 'waiting' as const }])) } }
      : { ...IDLE_ARCHIVE, state: 'running', label: 'Loading briefings', fraction: null })
    try {
      const res = await fetch('/api/archive-export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          channels: chosen.map((c) => c.id), range, order, ...(range === 'custom' ? { from, to } : {}),
          ...(only ? { volumes: only, expectVolumes: archive.plan?.length } : {}),
        }),
        signal: ctrl.signal,
      })
      if (!res.ok || !res.body) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error ?? `Export failed (${res.status})`)
      }
      let finished = false
      await readLines(res, (ev) => {
        if (ev.type === 'progress') {
          const p = phaseLabel(ev)
          if (typeof ev.volume === 'number') {
            const i = ev.volume
            setArchive((prev) => ({ ...prev, label: undefined, vols: { ...prev.vols, [i]: { status: 'running', ...p } } }))
          } else {
            setArchive((prev) => ({ ...prev, ...p }))
          }
        } else if (ev.type === 'plan') {
          const plan = ev.volumes as Volume[]
          setArchive((prev) => ({
            ...prev,
            label: undefined,
            plan,
            vols: Object.fromEntries(plan.map((v) => [v.index, prev.vols[v.index]?.status === 'ready' && only && !only.includes(v.index) ? prev.vols[v.index] : { status: 'waiting' as const }])),
          }))
        } else if (ev.type === 'volume_ready') {
          const i = Number(ev.index)
          setArchive((prev) => ({
            ...prev,
            vols: { ...prev.vols, [i]: { status: 'ready', url: String(ev.url), bytes: ev.bytes as number | undefined, cached: !!ev.cached, expiresAt: Date.now() + Number(ev.expiresIn) * 1000 } },
          }))
        } else if (ev.type === 'pending') {
          const list = ev.volumes as number[]
          setArchive((prev) => ({ ...prev, expectVolumes: Number(ev.expectVolumes), vols: { ...prev.vols, ...Object.fromEntries(list.map((i) => [i, { status: 'pending' as const }])) } }))
        } else if (ev.type === 'done') {
          finished = true
          setArchive((prev) => ({ ...prev, state: 'finished', notes: ev.notes as { what: string; count: number }[] }))
        } else if (ev.type === 'empty' || ev.type === 'error' || ev.type === 'too_many') {
          finished = true
          setArchive((prev) => ({ ...prev, state: ev.type === 'empty' ? 'empty' : 'error', message: String(ev.message) }))
        }
      })
      if (!finished) throw new Error('The export stopped before it finished. Try again.')
    } catch (err) {
      if (ctrl.signal.aborted) return
      setArchive((prev) => ({ ...prev, state: 'error', message: (err as Error).message }))
    }
  }

  function applySplit(split: Split) {
    setRange('custom')
    setFrom(split.from)
    setTo(split.to)
  }

  const splits = job.state === 'too_large' ? job.splits : summary?.overLimit ? summary.splits : []
  const overMessage = mode !== 'single' ? null : job.state === 'too_large' ? job.message : summary?.overLimit ?? null
  const canGenerate = mode === 'single'
    ? customReady && !!summary && summary.count > 0 && !summary.overLimit && job.state !== 'running' && !loadingSummary
    : mode === 'archive' && customReady && !!archiveSummary && archiveSummary.count > 0 && !archiveSummary.tooMany && archive.state !== 'running' && !loadingSummary
  const expired = job.state === 'ready' && Date.now() > job.expiresAt
  const volumeCount = archive.plan?.length ?? archiveSummary?.estimatedVolumes ?? 0
  const title = single ? single.name : 'Channel archive'

  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label={`Export ${title} as PDF`}>
      <div className="fixed inset-0 bg-ink-300/20 backdrop-blur-[2px]" onClick={onClose} />
      <div className="fixed bottom-0 inset-x-0 paper-page shadow-[0_-8px_40px_rgba(60,50,80,0.14)] animate-slide-up max-h-[90dvh] overflow-y-auto pb-[env(safe-area-inset-bottom)]">
        <div className="max-w-xl mx-auto px-4 pt-3 pb-6">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 pt-2">
              <p className="press-label">Export PDF</p>
              <h2 className="font-georgia text-[20px] tracking-[-0.3px] text-press-ink truncate">{title}</h2>
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

          <div className="flex items-baseline justify-between gap-3 mb-2">
            <p className="font-chrome text-[9px] uppercase tracking-[2px] text-press-muted">Channels</p>
            <p className="font-chrome text-[10px] text-press-muted">{selected.size} of {channels.length} selected</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Pill active={isExactly(groups.all)} onClick={() => setSelected(new Set(groups.all))} disabled={!groups.all.length}>All channels</Pill>
            <Pill active={isExactly(groups.pulse)} onClick={() => setSelected(new Set(groups.pulse))} disabled={!groups.pulse.length}>Pulse channels</Pill>
            <Pill active={isExactly(groups.post)} onClick={() => setSelected(new Set(groups.post))} disabled={!groups.post.length}>Post-Pulse channels</Pill>
          </div>
          <ul className="mt-2 max-h-[264px] overflow-y-auto border-[0.5px] border-press-hair bg-white/30">
            {channels.map((c) => (
              <li key={c.id} className="border-b-[0.5px] border-press-hair last:border-b-0">
                <label className="min-h-[44px] flex items-center gap-3 px-3 cursor-pointer hover:bg-press-accent/[0.05]">
                  <input
                    type="checkbox"
                    checked={selected.has(c.id)}
                    onChange={() => toggle(c.id)}
                    className="w-[18px] h-[18px] accent-[#6B5CA5] flex-shrink-0"
                  />
                  <span className="font-georgia text-[14px] text-press-ink truncate flex-1">{c.name}</span>
                  {c.recapGroup === 'post_pulse' && <span className="font-chrome text-[9px] uppercase tracking-[1px] text-press-faint flex-shrink-0">Post-Pulse</span>}
                </label>
              </li>
            ))}
          </ul>

          <p className="font-chrome text-[9px] uppercase tracking-[2px] text-press-muted mt-5 mb-2">Date range</p>
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
            {mode === 'none' ? (
              <p className="font-georgia text-[13px] text-press-ink">Pick at least one channel to export.</p>
            ) : !customReady ? (
              <p className="font-georgia italic text-[13px] text-press-muted">Pick a start and end date.</p>
            ) : summaryError ? (
              <p className="font-georgia text-[13px] text-press-down">{summaryError}</p>
            ) : mode === 'single' ? (
              !summary || loadingSummary ? (
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
              )
            ) : !archiveSummary || loadingSummary ? (
              <p className="font-georgia italic text-[13px] text-press-muted">Counting briefings…</p>
            ) : archiveSummary.count === 0 ? (
              <p className="font-georgia text-[13px] text-press-ink">No briefings in this range for these channels, so there is nothing to export.</p>
            ) : (
              <div>
                <p className="font-georgia text-[14px] text-press-ink">
                  {archiveSummary.count} briefing{archiveSummary.count === 1 ? '' : 's'} from {archiveSummary.channels.filter((c) => c.count).length} channels · about {archiveSummary.estimatedPages} pages
                </p>
                {archiveSummary.firstDay && archiveSummary.lastDay && (
                  <p className="font-chrome text-[10px] uppercase tracking-[1px] text-press-muted mt-1">
                    {archiveSummary.firstDay === archiveSummary.lastDay ? shortDay(archiveSummary.firstDay) : `${shortDay(archiveSummary.firstDay)} to ${shortDay(archiveSummary.lastDay)}`}
                  </p>
                )}
                {volumeCount > 1 && !archiveSummary.tooMany && (
                  <p className="font-georgia text-[13px] text-press-ink mt-2">
                    This will make {volumeCount} volumes. Each is its own PDF of at most {archiveSummary.limits.pages} pages and {archiveSummary.limits.briefings} briefings, split between channels.
                  </p>
                )}
                {archiveSummary.empty.length > 0 && (
                  <p className="font-chrome text-[10px] text-press-muted mt-1.5">Nothing in this range from {archiveSummary.empty.join(', ')}; left out.</p>
                )}
                {archiveSummary.tooMany && <p className="font-georgia text-[13px] text-press-down mt-2">{archiveSummary.tooMany}</p>}
              </div>
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
            {mode === 'archive' ? (
              <ArchiveResult archive={archive} canGenerate={canGenerate} onGenerate={generateArchive} />
            ) : job.state === 'running' ? (
              <div aria-live="polite">
                <ProgressBar fraction={job.fraction} />
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

function ArchiveResult({ archive, canGenerate, onGenerate }: { archive: ArchiveJob; canGenerate: boolean; onGenerate: (only?: number[]) => void }) {
  const running = archive.state === 'running'
  const count = archive.plan?.length ?? 0
  return (
    <div aria-live="polite">
      {/* Before the plan exists: loading and planning */}
      {running && !archive.plan && (
        <div className="mb-3">
          <ProgressBar fraction={archive.fraction} />
          <p className="font-chrome text-[11px] text-press-muted mt-2">{archive.label ?? 'Loading briefings'}…</p>
        </div>
      )}
      {archive.plan && (
        <ul className="flex flex-col gap-3 mb-3">
          {archive.plan.map((v) => {
            const st = archive.vols[v.index] ?? { status: 'waiting' }
            const expired = st.status === 'ready' && !!st.expiresAt && Date.now() > st.expiresAt
            return (
              <li key={v.index} className="border-t-[0.5px] border-press-hair pt-2">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-georgia text-[14px] text-press-ink">{volumeName(v, count)}</p>
                    <p className="font-chrome text-[10px] text-press-muted mt-0.5">
                      {v.pages} pages · {v.briefings} briefings{st.bytes ? ` · ${sizeLabel(st.bytes)}` : ''}{st.cached ? ' · unchanged since the last export' : ''}
                    </p>
                    <p className="font-chrome text-[10px] text-press-faint mt-0.5 line-clamp-2">{v.channels.join(', ')}</p>
                  </div>
                  {st.status === 'ready' && !expired ? (
                    <a href={st.url} download={v.filename}
                      className="min-h-[44px] px-4 flex items-center flex-shrink-0 bg-press-ink text-white font-chrome text-[11px] uppercase tracking-[1.5px] hover:bg-press-accent transition-colors">
                      Download
                    </a>
                  ) : (st.status === 'pending' || expired) && !running ? (
                    <button type="button" onClick={() => onGenerate([v.index])}
                      className="min-h-[44px] px-4 flex-shrink-0 bg-press-accent text-white font-chrome text-[11px] uppercase tracking-[1.5px] hover:bg-press-ink transition-colors">
                      {expired ? 'New link' : 'Generate'}
                    </button>
                  ) : null}
                </div>
                {st.status === 'running' && (
                  <div className="mt-2">
                    <ProgressBar fraction={st.fraction} />
                    <p className="font-chrome text-[11px] text-press-muted mt-1.5">{count > 1 ? `Volume ${v.index + 1} of ${count}: ` : ''}{st.label}…</p>
                  </div>
                )}
                {st.status === 'waiting' && running && <p className="font-chrome text-[11px] text-press-faint mt-1">Waiting…</p>}
                {st.status === 'pending' && <p className="font-chrome text-[11px] text-press-muted mt-1">Not built yet: this export ran out of time. Generate it on its own.</p>}
                {expired && <p className="font-chrome text-[11px] text-press-muted mt-1">The link expired. An unchanged volume is ready again at once.</p>}
              </li>
            )
          })}
        </ul>
      )}
      {archive.state === 'finished' && archive.plan && Object.values(archive.vols).some((v) => v.status === 'ready') && (
        <p className="font-chrome text-[10px] text-press-muted mb-3">
          Links work for 5 minutes.
          {archive.notes && archive.notes.length > 0 && ` Not carried over: ${archive.notes.map((n) => n.what).join('; ')}.`}
        </p>
      )}
      {(archive.state === 'error' || archive.state === 'empty') && (
        <p className="font-georgia text-[13px] text-press-down mb-3">{archive.message}</p>
      )}
      {!running && archive.state !== 'finished' && (
        <button
          type="button"
          onClick={() => onGenerate()}
          disabled={!canGenerate}
          className="min-h-[44px] w-full bg-press-accent text-white font-chrome text-[12px] uppercase tracking-[1.5px] disabled:opacity-40 disabled:cursor-not-allowed hover:bg-press-ink transition-colors"
        >
          Generate
        </button>
      )}
    </div>
  )
}
