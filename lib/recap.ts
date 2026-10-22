// Weekly Recap Email — server-only.
//
// COMPILE ONLY, NEVER GENERATE. This module reads briefings/digests that
// already exist in the database (created in the last 7 days, scheduled or
// on demand), files them under two sections by the channel's recap_group,
// renders email-safe broadsheet HTML, and sends it over SMTP. It imports
// nothing from lib/generation.ts and never calls the Anthropic client. A
// channel that produced nothing in the window simply does not appear.

import nodemailer from 'nodemailer'
import { supabase } from './supabase'
import { parsePressSections } from './press-sections'
import { stripMarkdown } from './speech'
import type { RecapGroup } from './types'

export const RECAP_WINDOW_DAYS = 7
const EXCERPT_CHARS = 280
const ET = 'America/New_York'

export const DEFAULT_BASE_URL = 'https://mypulse-sepia.vercel.app'
export function recapBaseUrl(): string {
  return (process.env.PULSE_BASE_URL ?? DEFAULT_BASE_URL).replace(/\/$/, '')
}

// ── Shapes ───────────────────────────────────────────────────────────────────

export interface RecapChannelRow {
  id: string
  name: string
  position: number
  recap_group?: RecapGroup | null
}
export interface RecapBriefingRow {
  id: string
  channel_id: string
  content: string
  scheduled?: boolean | null
  created_at: string
}
export interface RecapDigestRow {
  id: string
  content: string
  channel_ids: string[]
  channel_names: string[]
  scheduled?: boolean | null
  created_at: string
}

export interface RecapInputs {
  channels: RecapChannelRow[]
  briefings: RecapBriefingRow[]
  digests: RecapDigestRow[]
  windowStart: Date
  windowEnd: Date
}

export interface RecapEntry {
  kind: 'briefing' | 'digest'
  id: string
  headline: string
  excerpt: string
  createdAt: string
  scheduled: boolean
  url: string
}
export interface RecapChannel {
  id: string
  name: string
  position: number
  entries: RecapEntry[]
}
export interface RecapSection {
  group: RecapGroup
  label: string
  channels: RecapChannel[]
}
export interface WeeklyRecap {
  windowStart: string
  windowEnd: string
  sections: RecapSection[]          // only non-empty sections, Pulse first
  briefingCount: number
  digestCount: number               // a digest counts once even when split across channels
  unplacedDigestStories: string[]   // digest section titles that matched no channel (logged, not emailed)
}

export const RECAP_GROUP_LABELS: Record<RecapGroup, string> = {
  pulse: 'Pulse',
  post_pulse: 'Post-Pulse',
}
const SECTION_ORDER: RecapGroup[] = ['pulse', 'post_pulse']

// ── Database reads (the only I/O besides SMTP) ───────────────────────────────

export async function fetchRecapInputs(profileId: string, now = new Date()): Promise<RecapInputs> {
  const windowEnd = now
  const windowStart = new Date(now.getTime() - RECAP_WINDOW_DAYS * 86_400_000)
  const cutoff = windowStart.toISOString()

  const { data: channels, error: chErr } = await supabase
    .from('channels')
    .select('*')
    .eq('profile_id', profileId)
    .order('position', { ascending: true })
  if (chErr) throw new Error(`channels: ${chErr.message}`)

  const channelIds = (channels ?? []).map((c) => c.id as string)

  const [{ data: briefings, error: bErr }, { data: digests, error: dErr }] = await Promise.all([
    channelIds.length
      ? supabase
          .from('briefings')
          .select('id, channel_id, content, scheduled, created_at')
          .in('channel_id', channelIds)
          .gte('created_at', cutoff)
          .order('created_at', { ascending: false })
      : Promise.resolve({ data: [] as RecapBriefingRow[], error: null }),
    supabase
      .from('digests')
      .select('id, content, channel_ids, channel_names, scheduled, created_at')
      .eq('profile_id', profileId)
      .gte('created_at', cutoff)
      .order('created_at', { ascending: false }),
  ])
  if (bErr) throw new Error(`briefings: ${bErr.message}`)
  if (dErr) throw new Error(`digests: ${dErr.message}`)

  return {
    channels: (channels ?? []) as RecapChannelRow[],
    briefings: (briefings ?? []) as RecapBriefingRow[],
    digests: (digests ?? []) as RecapDigestRow[],
    windowStart,
    windowEnd,
  }
}

// ── Compilation (pure) ───────────────────────────────────────────────────────

function normName(s: string): string {
  return s.toLowerCase().replace(/\s+/g, ' ').trim()
}

function truncate(text: string, max = EXCERPT_CHARS): string {
  const t = text.replace(/\s+/g, ' ').trim()
  if (t.length <= max) return t
  const cut = t.slice(0, max)
  const atWord = cut.lastIndexOf(' ')
  return (atWord > max * 0.6 ? cut.slice(0, atWord) : cut).replace(/[,;:.\-–—]+$/, '') + '…'
}

// First meaningful line of a markdown body: the first bullet or paragraph.
function firstProse(body: string): string | null {
  for (const block of body.split(/\n\s*\n/)) {
    const line = block
      .split('\n')
      .map((l) => l.trim())
      .find((l) => l && !/^#{1,6}\s/.test(l) && !/^[-*_]{3,}$/.test(l))
    if (!line) continue
    const plain = stripMarkdown(line)
    if (plain) return plain
  }
  return null
}

// Excerpt rule: the first Key Takeaways bullet, else the first paragraph.
function excerptFor(sections: ReturnType<typeof parsePressSections>['sections']): string {
  const aside = sections.find((s) => s.isAside)
  const fromAside = aside ? firstProse(aside.body) : null
  if (fromAside) return truncate(fromAside)
  for (const s of sections) {
    const p = firstProse(s.body)
    if (p) return truncate(p)
  }
  return ''
}

export function compileRecap(inputs: RecapInputs, baseUrl = recapBaseUrl()): WeeklyRecap {
  const byId = new Map<string, RecapChannel & { group: RecapGroup }>()
  const byName = new Map<string, string>()
  for (const c of inputs.channels) {
    byId.set(c.id, { id: c.id, name: c.name, position: c.position, entries: [], group: c.recap_group ?? 'pulse' })
    byName.set(normName(c.name), c.id)
  }
  const channelNames = inputs.channels.map((c) => c.name)

  for (const b of inputs.briefings) {
    const ch = byId.get(b.channel_id)
    if (!ch) continue
    const parsed = parsePressSections(b.content, { neverAside: channelNames })
    ch.entries.push({
      kind: 'briefing',
      id: b.id,
      headline: parsed.headline?.trim() || `${ch.name} · Briefing`,
      excerpt: excerptFor(parsed.sections),
      createdAt: b.created_at,
      scheduled: !!b.scheduled,
      url: `${baseUrl}/read/briefing/${b.id}`,
    })
  }

  // A digest spans channels (and often both sections): split it into its
  // channel stories and file each under its own channel. The headline
  // matching is case-insensitive because the model's heading casing drifts
  // from the channel name ("AI in CG Pipelines" vs "AI in cg pipelines").
  const unplaced: string[] = []
  for (const d of inputs.digests) {
    const parsed = parsePressSections(d.content, { neverAside: channelNames })
    let placed = 0
    for (const s of parsed.sections) {
      if (!s.title || s.isAside) continue
      const id = byName.get(normName(s.title))
      const ch = id ? byId.get(id) : undefined
      if (!ch) { unplaced.push(s.title); continue }
      const prose = firstProse(s.body)
      ch.entries.push({
        kind: 'digest',
        id: d.id,
        headline: `${ch.name} · Digest`,
        excerpt: prose ? truncate(prose) : '',
        createdAt: d.created_at,
        scheduled: !!d.scheduled,
        url: `${baseUrl}/read/digest/${d.id}`,
      })
      placed++
    }
    // A digest with no recognisable stories is still real content: file it
    // under each of its channels by id so it isn't silently dropped.
    if (placed === 0) {
      for (const cid of d.channel_ids ?? []) {
        const ch = byId.get(cid)
        if (!ch) continue
        ch.entries.push({
          kind: 'digest',
          id: d.id,
          headline: `${ch.name} · Digest`,
          excerpt: excerptFor(parsed.sections),
          createdAt: d.created_at,
          scheduled: !!d.scheduled,
          url: `${baseUrl}/read/digest/${d.id}`,
        })
      }
    }
  }

  const sections: RecapSection[] = SECTION_ORDER.map((group) => ({
    group,
    label: RECAP_GROUP_LABELS[group],
    channels: [...byId.values()]
      .filter((c) => c.group === group && c.entries.length > 0)
      .sort((a, b) => a.position - b.position)
      .map(({ id, name, position, entries }) => ({
        id,
        name,
        position,
        entries: [...entries].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
      })),
  })).filter((s) => s.channels.length > 0)

  return {
    windowStart: inputs.windowStart.toISOString(),
    windowEnd: inputs.windowEnd.toISOString(),
    sections,
    briefingCount: inputs.briefings.filter((b) => byId.has(b.channel_id)).length,
    digestCount: inputs.digests.length,
    unplacedDigestStories: unplaced,
  }
}

export function recapIsEmpty(recap: WeeklyRecap): boolean {
  return recap.sections.length === 0
}

// ── Formatting helpers ───────────────────────────────────────────────────────

function fmtDate(iso: string, opts: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat('en-US', { timeZone: ET, ...opts }).format(new Date(iso))
}
export function recapDateline(recap: WeeklyRecap): string {
  const start = fmtDate(recap.windowStart, { month: 'short', day: 'numeric' })
  const end = fmtDate(recap.windowEnd, { month: 'short', day: 'numeric', year: 'numeric' })
  return `${start} – ${end}`
}
export function recapCountLine(recap: WeeklyRecap): string {
  const parts: string[] = []
  if (recap.briefingCount) parts.push(`${recap.briefingCount} briefing${recap.briefingCount === 1 ? '' : 's'}`)
  if (recap.digestCount) parts.push(`${recap.digestCount} digest${recap.digestCount === 1 ? '' : 's'}`)
  return parts.join(', ')
}
export function recapSubject(recap: WeeklyRecap): string {
  return `Pulse Weekly Recap · ${recapDateline(recap)}`
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

// ── HTML (email-safe: tables, inline styles, no web fonts) ───────────────────

const C = {
  paper: '#F0ECF4',
  sheet: '#F6F3F8',
  ink: '#2C2522',
  body: '#48404A',
  muted: '#7A7070',
  faint: '#9A9098',
  accent: '#6B5CA5',
  hair: '#D9D2DE',
}
const SERIF = "Georgia, 'Times New Roman', Times, serif"
const SANS = "-apple-system, 'Segoe UI', Helvetica, Arial, sans-serif"

export function renderRecapHtml(recap: WeeklyRecap, baseUrl = recapBaseUrl()): string {
  const label = (text: string, extra = '') =>
    `<span style="font-family:${SANS};font-size:10px;letter-spacing:0.18em;text-transform:uppercase;color:${C.accent};${extra}">${esc(text)}</span>`

  const sectionsHtml = recap.sections
    .map((section) => {
      const channelsHtml = section.channels
        .map((ch) => {
          const entriesHtml = ch.entries
            .map((e) => {
              const when = fmtDate(e.createdAt, { weekday: 'short', month: 'short', day: 'numeric' })
              const how = e.scheduled ? 'scheduled' : 'on demand'
              const kindWord = e.kind === 'digest' ? 'digest' : 'briefing'
              return `
              <tr><td style="padding:14px 0 16px 0;border-bottom:1px solid ${C.hair};">
                <a href="${esc(e.url)}" style="font-family:${SERIF};font-size:18px;line-height:1.3;color:${C.ink};text-decoration:none;font-weight:bold;">${esc(e.headline)}</a>
                <div style="font-family:${SANS};font-size:11px;color:${C.faint};margin:5px 0 8px 0;">${esc(when)} &nbsp;·&nbsp; ${esc(how)}</div>
                ${e.excerpt ? `<div style="font-family:${SERIF};font-size:15px;line-height:1.55;color:${C.body};">${esc(e.excerpt)}</div>` : ''}
                <div style="margin-top:8px;"><a href="${esc(e.url)}" style="font-family:${SANS};font-size:12px;color:${C.accent};text-decoration:none;">Read the full ${kindWord} &rarr;</a></div>
              </td></tr>`
            })
            .join('')
          return `
          <tr><td style="padding:22px 0 0 0;">
            <div style="padding-bottom:4px;border-bottom:1px solid ${C.hair};">${label(ch.name, `color:${C.muted};`)}</div>
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${entriesHtml}</table>
          </td></tr>`
        })
        .join('')
      return `
      <tr><td style="padding:34px 0 0 0;">
        <div style="border-top:3px double ${C.accent};padding-top:10px;">
          ${label(`${section.channels.length} channel${section.channels.length === 1 ? '' : 's'}`)}
          <div style="font-family:${SERIF};font-size:24px;color:${C.ink};margin-top:2px;">${esc(section.label)}</div>
        </div>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${channelsHtml}</table>
      </td></tr>`
    })
    .join('')

  const counts = recapCountLine(recap)
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<title>${esc(recapSubject(recap))}</title>
</head>
<body style="margin:0;padding:0;background:${C.paper};">
<div style="display:none;max-height:0;overflow:hidden;font-size:1px;line-height:1px;color:${C.paper};">${esc(counts ? `${counts} from the past week.` : 'Your week in Pulse.')}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${C.paper};">
<tr><td align="center" style="padding:28px 16px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;">
  <tr><td style="padding:0 0 10px 0;border-bottom:1px solid ${C.ink};text-align:center;">
    <div style="font-family:${SERIF};font-size:44px;letter-spacing:0.22em;color:${C.ink};line-height:1;">PULSE</div>
    <div style="font-family:${SANS};font-size:10px;letter-spacing:0.22em;text-transform:uppercase;color:${C.accent};margin-top:8px;">Weekly Recap</div>
  </td></tr>
  <tr><td style="padding:8px 0;border-bottom:1px solid ${C.hair};text-align:center;">
    <span style="font-family:${SANS};font-size:11px;color:${C.muted};letter-spacing:0.06em;">${esc(recapDateline(recap))}${counts ? ` &nbsp;·&nbsp; ${esc(counts)}` : ''}</span>
  </td></tr>
  ${sectionsHtml}
  <tr><td style="padding:36px 0 0 0;">
    <div style="border-top:1px solid ${C.hair};padding-top:12px;font-family:${SANS};font-size:11px;line-height:1.6;color:${C.faint};">
      This recap compiles what Pulse generated in the past ${RECAP_WINDOW_DAYS} days. Nothing was generated for this email.
      <br><a href="${esc(baseUrl)}/briefing-history" style="color:${C.accent};text-decoration:none;">The Archive</a>
      &nbsp;·&nbsp; <a href="${esc(baseUrl)}/settings" style="color:${C.accent};text-decoration:none;">Recap settings</a>
    </div>
  </td></tr>
</table>
</td></tr>
</table>
</body>
</html>`
}

export function renderRecapText(recap: WeeklyRecap, baseUrl = recapBaseUrl()): string {
  const out: string[] = []
  out.push('PULSE — WEEKLY RECAP')
  const counts = recapCountLine(recap)
  out.push(`${recapDateline(recap)}${counts ? ` · ${counts}` : ''}`)
  out.push('')
  for (const section of recap.sections) {
    out.push(`== ${section.label.toUpperCase()} ==`)
    for (const ch of section.channels) {
      out.push('')
      out.push(ch.name)
      out.push('-'.repeat(Math.min(ch.name.length, 60)))
      for (const e of ch.entries) {
        const when = fmtDate(e.createdAt, { weekday: 'short', month: 'short', day: 'numeric' })
        out.push(`* ${e.headline}`)
        out.push(`  ${when} · ${e.scheduled ? 'scheduled' : 'on demand'}`)
        if (e.excerpt) out.push(`  ${e.excerpt}`)
        out.push(`  ${e.url}`)
      }
    }
    out.push('')
  }
  out.push(`This recap compiles what Pulse generated in the past ${RECAP_WINDOW_DAYS} days. Nothing was generated for this email.`)
  out.push(`The Archive: ${baseUrl}/briefing-history`)
  return out.join('\n')
}

// ── Sending (IONOS SMTP via Nodemailer) ──────────────────────────────────────

export function smtpConfigured(): boolean {
  return !!(process.env.SMTP_USER && process.env.SMTP_PASS)
}

export async function sendRecapEmail(args: { to: string; subject: string; html: string; text: string }): Promise<{ messageId: string }> {
  const user = process.env.SMTP_USER
  const pass = process.env.SMTP_PASS
  if (!user || !pass) throw new Error('SMTP not configured: set SMTP_USER and SMTP_PASS')
  const host = process.env.SMTP_HOST ?? 'smtp.ionos.com'
  const port = parseInt(process.env.SMTP_PORT ?? '587', 10)
  const from = process.env.RECAP_FROM ?? `Pulse <${user}>`

  const transport = nodemailer.createTransport({
    host,
    port,
    secure: port === 465,          // 465 = implicit TLS; 587 = STARTTLS
    auth: { user, pass },
  })
  const info = await transport.sendMail({ from, to: args.to, subject: args.subject, html: args.html, text: args.text })
  return { messageId: info.messageId }
}

// ── One-shot: compile for a profile and send if there is anything ────────────

export interface RecapRunResult {
  status: 'sent' | 'empty' | 'no_recipient'
  to?: string
  messageId?: string
  briefingCount: number
  digestCount: number
  sections: string[]
}

export async function compileAndSendRecap(profileId: string, recipient: string | null, now = new Date()): Promise<RecapRunResult> {
  const inputs = await fetchRecapInputs(profileId, now)
  const recap = compileRecap(inputs)
  if (recap.unplacedDigestStories.length) {
    console.warn(`[recap] digest stories matched no channel: ${recap.unplacedDigestStories.join(', ')}`)
  }
  const base = { briefingCount: recap.briefingCount, digestCount: recap.digestCount, sections: recap.sections.map((s) => s.label) }
  if (recapIsEmpty(recap)) return { status: 'empty', ...base }
  if (!recipient) return { status: 'no_recipient', ...base }
  const { messageId } = await sendRecapEmail({
    to: recipient,
    subject: recapSubject(recap),
    html: renderRecapHtml(recap),
    text: renderRecapText(recap),
  })
  return { status: 'sent', to: recipient, messageId, ...base }
}

// ── Scheduling helpers (Eastern Time, hourly cron) ───────────────────────────

export function etWeekdayAndHour(now = new Date()): { weekday: number; hour: number } {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: ET, weekday: 'short', hour: '2-digit', hour12: false }).formatToParts(now)
  const wd = parts.find((p) => p.type === 'weekday')?.value ?? 'Sun'
  const hour = parseInt(parts.find((p) => p.type === 'hour')?.value ?? '0', 10) % 24
  const weekday = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(wd)
  return { weekday: weekday < 0 ? 0 : weekday, hour }
}

// Hours elapsed since the most recent occurrence of (day, hour) in ET.
export function hoursSinceRecapSlot(recapDay: number, recapTime: string, now = new Date()): number {
  const { weekday, hour } = etWeekdayAndHour(now)
  const slotHour = parseInt((recapTime ?? '07:00').split(':')[0], 10) || 0
  return ((weekday * 24 + hour) - (recapDay * 24 + slotHour) + 168) % 168
}
