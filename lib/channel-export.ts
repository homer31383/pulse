// Server-only: "Export channel as PDF". Selection (one channel's briefings in
// a date range), ownership, limits, the Storage cache and the signed download.
// The PDF itself is drawn by lib/pdf/channel-pdf. Exporting reads briefings
// and nothing else: no read marks, no queue changes, no model or TTS calls.
// Never import in 'use client' files.
import { createHash } from 'node:crypto'
import { supabase } from '@/lib/supabase'
import { coverSpan, estimatePages, type ExportBriefing } from '@/lib/pdf/channel-pdf'

// Private bucket (migration 036_pdf_exports_bucket.sql): service role only,
// no policies, so anon and authenticated keys can't list or read it.
export const EXPORT_BUCKET = 'pdf-exports'
export const MAX_BRIEFINGS = 200
export const MAX_PAGES = 400
export const SIGNED_URL_TTL_S = 300
// Cached exports kept per channel (the newest few selections)
const KEEP_PER_CHANNEL = 3
// Bump when the PDF's look or layout changes so cached files are redrawn
export const EXPORT_LAYOUT_VERSION = 2 // 2: sources capped at 8, story-headline contents titles

const TIME_ZONE = 'America/New_York'

export type ExportRange =
  | { kind: 'all' }
  | { kind: 'days'; days: 30 | 90 }
  | { kind: 'custom'; from: string; to: string } // ET calendar days, inclusive

export type ExportOrder = 'oldest' | 'newest'

export interface ExportRequest { range: ExportRange; order: ExportOrder }

const DAY = /^\d{4}-\d{2}-\d{2}$/

export function parseExportRequest(input: Record<string, unknown>): ExportRequest | string {
  const order = input.order === 'newest' ? 'newest' : input.order === undefined || input.order === 'oldest' ? 'oldest' : null
  if (!order) return 'order must be "oldest" or "newest"'
  const range = String(input.range ?? 'all')
  if (range === 'all') return { range: { kind: 'all' }, order }
  if (range === '30' || range === '90') return { range: { kind: 'days', days: Number(range) as 30 | 90 }, order }
  if (range === 'custom') {
    const from = String(input.from ?? '')
    const to = String(input.to ?? '')
    if (!DAY.test(from) || !DAY.test(to) || Number.isNaN(Date.parse(from)) || Number.isNaN(Date.parse(to))) return 'custom range needs from and to as YYYY-MM-DD'
    if (from > to) return 'the range starts after it ends'
    return { range: { kind: 'custom', from, to }, order }
  }
  return 'range must be all, 30, 90 or custom'
}

export function rangeLabel(range: ExportRange): string {
  if (range.kind === 'all') return 'All time'
  if (range.kind === 'days') return `Last ${range.days} days`
  return 'Custom range'
}

// Midnight at the start of an Eastern calendar day, as a UTC instant
function etDayStart(day: string): Date {
  const [y, m, d] = day.split('-').map(Number)
  const guess = Date.UTC(y, m - 1, d, 12)
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: TIME_ZONE, timeZoneName: 'longOffset' }).formatToParts(new Date(guess))
  const off = parts.find((p) => p.type === 'timeZoneName')?.value ?? 'GMT-05:00'
  const match = /GMT([+-])(\d{2}):(\d{2})/.exec(off)
  const minutes = match ? (match[1] === '-' ? -1 : 1) * (Number(match[2]) * 60 + Number(match[3])) : -300
  return new Date(Date.UTC(y, m - 1, d) - minutes * 60_000)
}

export function etDay(iso: string | Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE }).format(new Date(iso))
}

function nextDay(day: string): string {
  const d = new Date(`${day}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + 1)
  return d.toISOString().slice(0, 10)
}

// The channel, only if the cookie's profile owns it. A channel id from the
// client is never used without this check.
export async function ownedChannel(profileId: string, channelId: string): Promise<{ id: string; name: string } | null> {
  if (!/^[0-9a-f-]{36}$/i.test(channelId)) return null
  const { data, error } = await supabase
    .from('channels')
    .select('id, name')
    .eq('id', channelId)
    .eq('profile_id', profileId)
    .maybeSingle()
  if (error) throw new Error(error.message)
  return data
}

export async function fetchExportBriefings(channelId: string, req: ExportRequest, now = new Date()): Promise<ExportBriefing[]> {
  let q = supabase
    .from('briefings')
    .select('id, created_at, content, sources')
    .eq('channel_id', channelId)
    .order('created_at', { ascending: req.order === 'oldest' })
    .order('id', { ascending: true })
    .limit(2000)
  const { range } = req
  if (range.kind === 'days') q = q.gte('created_at', new Date(now.getTime() - range.days * 86_400_000).toISOString())
  if (range.kind === 'custom') {
    q = q.gte('created_at', etDayStart(range.from).toISOString()).lt('created_at', etDayStart(nextDay(range.to)).toISOString())
  }
  const { data, error } = await q
  if (error) throw new Error(error.message)
  return (data ?? []) as ExportBriefing[]
}

export interface ExportSplit { from: string; to: string; count: number; pages: number }

export interface ExportSummary {
  count: number
  estimatedPages: number
  firstDay: string | null
  lastDay: string | null
  span: string
  limits: { briefings: number; pages: number }
  overLimit: string | null  // why the selection can't be one export
  splits: ExportSplit[]     // date ranges that each fit, when over the limit
}

// Date ranges, oldest first, that each stay under both limits. Pages come
// from the layout when known (a refused render), otherwise the estimate
// with a margin so an estimated split doesn't then land just over.
export function splitByDate(briefings: ExportBriefing[], pagesEach?: number[]): ExportSplit[] {
  const items = briefings
    .map((b, i) => ({ b, pages: pagesEach?.[i] ?? estimatePages([{ contentLength: b.content.length }]) - 2 }))
    .sort((x, y) => x.b.created_at.localeCompare(y.b.created_at))
  const pageBudget = pagesEach ? MAX_PAGES - 4 : Math.floor(MAX_PAGES * 0.9)
  const splits: ExportSplit[] = []
  let cur: typeof items = []
  let pages = 0
  const flush = () => {
    if (!cur.length) return
    splits.push({ from: etDay(cur[0].b.created_at), to: etDay(cur[cur.length - 1].b.created_at), count: cur.length, pages: pages + 1 + Math.ceil(cur.length / 24) })
    cur = []
    pages = 0
  }
  for (const item of items) {
    const day = etDay(item.b.created_at)
    const full = cur.length >= MAX_BRIEFINGS || pages + item.pages > pageBudget
    // Never cut inside a calendar day: ranges are whole days
    if (full && cur.length && etDay(cur[cur.length - 1].b.created_at) !== day) flush()
    cur.push(item)
    pages += item.pages
  }
  flush()
  return splits
}

export function summarize(briefings: ExportBriefing[]): ExportSummary {
  const estimatedPages = estimatePages(briefings.map((b) => ({ contentLength: b.content.length })))
  const days = briefings.map((b) => etDay(b.created_at)).sort()
  let overLimit: string | null = null
  if (briefings.length > MAX_BRIEFINGS) overLimit = `${briefings.length} briefings is more than one export can hold (${MAX_BRIEFINGS}).`
  else if (estimatedPages > MAX_PAGES) overLimit = `About ${estimatedPages} pages is more than one export can hold (${MAX_PAGES}).`
  return {
    count: briefings.length,
    estimatedPages,
    firstDay: days[0] ?? null,
    lastDay: days[days.length - 1] ?? null,
    span: coverSpan(briefings),
    limits: { briefings: MAX_BRIEFINGS, pages: MAX_PAGES },
    overLimit,
    splits: overLimit ? splitByDate(briefings) : [],
  }
}

// Cache key: the profile and channel (the folder), then a hash of everything
// the PDF shows. A new, edited or deleted briefing, another order or range
// label, or a layout change gives a new file.
export function exportPath(profileId: string, channel: { id: string; name: string }, req: ExportRequest, briefings: ExportBriefing[]): string {
  const h = createHash('sha256')
  h.update(JSON.stringify({ v: EXPORT_LAYOUT_VERSION, name: channel.name, label: rangeLabel(req.range), order: req.order }))
  for (const b of briefings) {
    h.update(`\n${b.id}|${b.created_at}|`)
    h.update(createHash('sha256').update(b.content).update(JSON.stringify(b.sources ?? [])).digest('hex'))
  }
  return `${profileId}/${channel.id}/${h.digest('hex').slice(0, 32)}.pdf`
}

export async function cachedExists(path: string): Promise<boolean> {
  const folder = path.slice(0, path.lastIndexOf('/'))
  const name = path.slice(path.lastIndexOf('/') + 1)
  const { data, error } = await supabase.storage.from(EXPORT_BUCKET).list(folder, { search: name, limit: 5 })
  // A failed lookup just means "build it again"; a real storage problem
  // surfaces at upload
  if (error) {
    console.warn(`[export] cache lookup failed (${error.message}), generating`)
    return false
  }
  return (data ?? []).some((f) => f.name === name)
}

export async function storeExport(path: string, pdf: Buffer): Promise<void> {
  const { error } = await supabase.storage.from(EXPORT_BUCKET).upload(path, pdf, { contentType: 'application/pdf', upsert: true })
  if (error) throw new Error(`Could not store the PDF: ${error.message}`)
  // Keep only the newest few exports of this channel
  const folder = path.slice(0, path.lastIndexOf('/'))
  const { data } = await supabase.storage.from(EXPORT_BUCKET).list(folder, { limit: 100, sortBy: { column: 'created_at', order: 'desc' } })
  const stale = (data ?? []).slice(KEEP_PER_CHANNEL).map((f) => `${folder}/${f.name}`).filter((p) => p !== path)
  if (stale.length) await supabase.storage.from(EXPORT_BUCKET).remove(stale)
}

export function downloadName(channelName: string, briefings: ExportBriefing[]): string {
  const days = briefings.map((b) => etDay(b.created_at)).sort()
  const safe = channelName.replace(/[^\p{L}\p{N} &'-]+/gu, '').trim() || 'Channel'
  const span = days.length ? (days[0] === days[days.length - 1] ? days[0] : `${days[0]} to ${days[days.length - 1]}`) : ''
  return `Pulse - ${safe}${span ? ` - ${span}` : ''}.pdf`
}

export async function signedDownloadUrl(path: string, filename: string): Promise<string> {
  const { data, error } = await supabase.storage.from(EXPORT_BUCKET).createSignedUrl(path, SIGNED_URL_TTL_S, { download: filename })
  if (error || !data) throw new Error(`Could not sign the download: ${error?.message ?? 'no URL'}`)
  return data.signedUrl
}

// Channel deleted: its cached exports go too (Storage has no cascade)
export async function removeChannelExports(profileId: string, channelId: string): Promise<void> {
  const folder = `${profileId}/${channelId}`
  const { data } = await supabase.storage.from(EXPORT_BUCKET).list(folder, { limit: 100 })
  const paths = (data ?? []).map((f) => `${folder}/${f.name}`)
  if (paths.length) await supabase.storage.from(EXPORT_BUCKET).remove(paths)
}
