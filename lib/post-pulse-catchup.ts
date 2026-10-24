// Post-Pulse "While you were away" panel — server-only, COMPILE ONLY.
//
// Reads briefings/digests that already exist (Post-Pulse channels, i.e.
// recap_group = 'post_pulse') created after the profile's
// post_pulse_last_seen, through the weekly recap's fetch + compile, so a
// digest that spans Pulse and Post-Pulse only contributes its Post-Pulse
// stories. Like lib/recap.ts it imports nothing from lib/generation.ts and
// never calls the Anthropic client: rendering the page can't generate. The
// on-demand summary lives in lib/post-pulse-catchup-summary.ts.
//
// "New since last visit" (created_at > last_seen) and "unread" (read_at IS
// NULL) are separate: a new item can already be read (read elsewhere, or a
// live generation, which is born read), and older unread items are not new —
// they only show as the count-only footer line.
//
// The Post-Pulse review queue (pp_queue, pending proposals) is a different
// kind of thing: a to-do list, not a feed. fetchReviewQueue lists EVERY
// actionable pending item regardless of last_seen ("new" is only a tag), so
// "Mark all as seen" never hides one; an item leaves only when it is
// accepted or rejected (on /post-pulse/queue or the panel's own buttons,
// which call the same PATCH route). Flagged notes are only counted. pp_queue is shared across profiles (the pp_*
// dataset is not profile-scoped), so there is no profile filter; only the
// "new" tag is per profile.

import { createHash } from 'crypto'
import { supabase } from './supabase'
import { compileRecap, fetchRecapInputs, normName, type RecapInputs } from './recap'
import { parsePressSections } from './press-sections'
import { stripMarkdown } from './speech'
import { calculateCost } from './cost'
import { resolveModel } from './anthropic'
import { fetchPendingQueue, fetchPostPulseDataset } from './post-pulse'
import {
  PP_DEPARTMENT_EDITABLE_FIELDS,
  PP_PIPELINE_STAGES,
  PP_QUEUE_SOURCES,
  PP_TOOL_EDITABLE_FIELDS,
  type PpDataset,
  type PpQueueItem,
} from './post-pulse-types'
import { findNameCollision, validateStoredProposal } from './post-pulse-proposals'
import type {
  Catchup,
  CatchupChannel,
  CatchupEstimate,
  CatchupFooterLine,
  CatchupReview,
  CatchupReviewItem,
  CatchupSummary,
} from './post-pulse-catchup-types'

export const CATCHUP_FIRST_VISIT_DAYS = 7
export const CATCHUP_LONG_ABSENCE_DAYS = 14
export const CATCHUP_CAP = 25                 // list cap after a long absence, and the summary's item cap
export const CATCHUP_SUMMARY_PER_ITEM_CHARS = 6_000
export const CATCHUP_SUMMARY_TOTAL_CHARS = 40_000
export const CATCHUP_SUMMARY_MAX_TOKENS = 4_000
const CATCHUP_SUMMARY_TYPICAL_OUTPUT = 1_500 // low effort: thinking + a ~300-word note
const ET = 'America/New_York'
const DAY_MS = 86_400_000

const MODEL_LABELS: Record<string, string> = {
  'claude-sonnet-5': 'Sonnet 5',
  'claude-opus-4-8': 'Opus 4.8',
}

export const CATCHUP_SUMMARY_SYSTEM =
  `You write a short catch-up note for a reader returning to Post-Pulse, their feed of ` +
  `post-production and VFX technology briefings. You are given only the items published ` +
  `since their last visit, oldest first. Use nothing but that text: no outside knowledge, ` +
  `no speculation about things the items don't say.\n\n` +
  `Write it like a short briefing note, in Markdown, under about 300 words:\n` +
  `- Open with one or two sentences on what changed overall.\n` +
  `- "## What matters most": the two to four developments most worth knowing, each one or ` +
  `two sentences, naming the channel it came from.\n` +
  `- "## Updates and contradictions": where a later item updates, corrects, or contradicts an ` +
  `earlier one, say which and how. Leave this section out if there are none.\n` +
  `No headline, no preamble, no sign-off.`

// ── Settings row ─────────────────────────────────────────────────────────────

interface CatchupSettings {
  lastSeen: Date | null
  collapsed: boolean
  cached: (CatchupSummary & { itemKey: string }) | null
  model: string
}

export async function fetchCatchupSettings(profileId: string): Promise<CatchupSettings> {
  const { data, error } = await supabase
    .from('settings')
    .select('model, post_pulse_last_seen, post_pulse_catchup_collapsed, post_pulse_catchup_summary')
    .eq('id', profileId)
    .maybeSingle()
  if (error) {
    if (/post_pulse_/.test(error.message)) {
      throw new Error(`settings is missing the catch-up columns: run supabase/migrations/034_post_pulse_catchup.sql (${error.message})`)
    }
    throw new Error(`settings: ${error.message}`)
  }
  const raw = data?.post_pulse_catchup_summary as
    | { item_key?: string; content?: string; model?: string; cost_usd?: number; created_at?: string }
    | null
    | undefined
  return {
    lastSeen: data?.post_pulse_last_seen ? new Date(data.post_pulse_last_seen) : null,
    collapsed: !!data?.post_pulse_catchup_collapsed,
    cached:
      raw?.item_key && raw.content
        ? {
            itemKey: raw.item_key,
            content: raw.content,
            model: raw.model ?? '',
            costUsd: raw.cost_usd ?? 0,
            createdAt: raw.created_at ?? '',
          }
        : null,
    model: resolveModel(data?.model),
  }
}

// ── Compile ──────────────────────────────────────────────────────────────────

interface Item {
  kind: 'briefing' | 'digest'
  id: string
  key: string
  createdAt: string
  unread: boolean
}

export interface CatchupCompiled {
  inputs: RecapInputs
  channels: CatchupChannel[]
  items: Item[]              // distinct, newest first
  summaryItems: Item[]       // the newest CATCHUP_CAP: what the summary reads and the cache key covers
  itemKey: string
  postPulseChannelIds: string[]
}

function etDayKey(d: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: ET, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d)
}

function rowDateLabel(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { timeZone: ET, weekday: 'short', month: 'short', day: 'numeric' })
}

// "since Tuesday": calendar days in ET, so "yesterday" means the ET date.
export function sinceLabel(since: Date, now: Date, firstVisit: boolean): string {
  if (firstVisit) return `in the last ${CATCHUP_FIRST_VISIT_DAYS} days`
  const days = Math.round(
    (Date.parse(etDayKey(now)) - Date.parse(etDayKey(since))) / DAY_MS,
  )
  if (days <= 0) {
    return `since ${since.toLocaleTimeString('en-US', { timeZone: ET, hour: 'numeric', minute: '2-digit' })}`
  }
  if (days === 1) return 'since yesterday'
  if (days < 7) return `since ${since.toLocaleDateString('en-US', { timeZone: ET, weekday: 'long' })}`
  return `since ${since.toLocaleDateString('en-US', { timeZone: ET, month: 'short', day: 'numeric' })}`
}

export function catchupItemKey(items: { key: string }[]): string {
  return createHash('sha256').update(items.map((i) => i.key).sort().join('|')).digest('hex').slice(0, 32)
}

export async function compileCatchup(
  profileId: string,
  range: { since: Date; until: Date },
  longAbsence: boolean,
): Promise<CatchupCompiled> {
  const inputs = await fetchRecapInputs(profileId, range, { group: 'post_pulse' })
  const recap = compileRecap(inputs, '')
  const section = recap.sections.find((s) => s.group === 'post_pulse')

  // Distinct items from what was actually filed under Post-Pulse channels: a
  // digest whose only Post-Pulse story didn't match contributes nothing.
  const byKey = new Map<string, Item>()
  for (const ch of section?.channels ?? []) {
    for (const e of ch.entries) {
      const key = `${e.kind}:${e.id}`
      if (!byKey.has(key)) byKey.set(key, { kind: e.kind, id: e.id, key, createdAt: e.createdAt, unread: !e.readAt })
    }
  }
  const items = [...byKey.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  const summaryItems = items.slice(0, CATCHUP_CAP)
  const visible = new Set((longAbsence ? items.slice(0, CATCHUP_CAP) : items).map((i) => i.key))

  const channels: CatchupChannel[] = (section?.channels ?? []).map((ch) => ({
    id: ch.id,
    name: ch.name,
    entries: ch.entries.map((e) => {
      const key = `${e.kind}:${e.id}`
      return {
        kind: e.kind,
        id: e.id,
        key,
        headline: e.headline,
        excerpt: e.excerpt,
        createdAt: e.createdAt,
        dateLabel: rowDateLabel(e.createdAt),
        scheduled: e.scheduled,
        unread: !e.readAt,
        older: !visible.has(key),
      }
    }),
  }))

  return {
    inputs,
    channels,
    items,
    summaryItems,
    itemKey: catchupItemKey(summaryItems),
    postPulseChannelIds: inputs.channels.filter((c) => c.recap_group === 'post_pulse').map((c) => c.id),
  }
}

// ── Footer counters (count-only lines) ───────────────────────────────────────
// Each returns a line or null. Research runs / pending queue proposals since
// last_seen would be one more entry here.

type Counter = (ctx: { profileId: string; since: Date; ppChannelIds: string[] }) => Promise<CatchupFooterLine | null>

const olderUnread: Counter = async ({ profileId, since, ppChannelIds }) => {
  if (ppChannelIds.length === 0) return null
  const cutoff = since.toISOString()
  const [b, d] = await Promise.all([
    supabase
      .from('briefings')
      .select('id', { count: 'exact', head: true })
      .in('channel_id', ppChannelIds)
      .is('read_at', null)
      .lte('created_at', cutoff),
    supabase
      .from('digests')
      .select('id', { count: 'exact', head: true })
      .eq('profile_id', profileId)
      .overlaps('channel_ids', ppChannelIds)
      .is('read_at', null)
      .lte('created_at', cutoff),
  ])
  if (b.error || d.error) {
    console.warn(`[catchup] older-unread count failed: ${b.error?.message ?? d.error?.message}`)
    return null
  }
  const n = (b.count ?? 0) + (d.count ?? 0)
  if (n === 0) return null
  return { key: 'older-unread', text: `Plus ${n} older unread`, href: '/briefing-history', linkLabel: 'Archive' }
}

const CATCHUP_COUNTERS: Counter[] = [olderUnread]

// ── Review queue (sibling of the counters: it needs rows) ────────────────────

const REVIEW_NOTE_CHARS = 180
const TIER_WORDS: Record<string, string> = { automated: 'automated', assisted: 'AI-assisted', artist_led: 'artist-led' }
const FIELD_WORDS: Record<string, string> = {
  host_app: 'host app',
  replacement_tool_id: 'replacement',
  doc_anchor: 'doc anchor',
  source_urls: 'sources',
  department_id: 'department',
  overview_doc: 'overview doc',
  comparison_attributes: 'comparison attributes',
  pipeline_stage: 'pipeline stage',
  pipeline_substage: 'pipeline substage',
}

function listWords(items: string[]): string {
  if (items.length <= 1) return items.join('')
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`
}

function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null)
}

// What accepting would do, from the item's own fields and the current row —
// mirroring acceptQueueItem: only editable fields apply, unchanged values are
// skipped, and an `attributes` proposal REPLACES the whole map (keys it
// leaves out are removed, so the line names them).
function describeEffect(item: PpQueueItem, dataset: PpDataset): string {
  const c = item.proposed_changes
  const deptName = (id: unknown) => dataset.departments.find((d) => d.id === id)?.name

  if (item.target_type === 'department') {
    if (!item.proposed_department_id) {
      const stage = PP_PIPELINE_STAGES.find((s) => s.value === c.pipeline_stage)?.label
      return `Adds a new department${typeof c.name === 'string' ? ` "${c.name}"` : ''}${stage ? ` to ${stage}` : ''}`
    }
    const current = dataset.departments.find((d) => d.id === item.proposed_department_id)
    if (!current) return 'Updates a department that no longer exists'
    const row = current as unknown as Record<string, unknown>
    const fields = PP_DEPARTMENT_EDITABLE_FIELDS.filter((f) => f in c && !same(row[f], c[f]))
    if (fields.length === 0) return `No changes to ${current.name}`
    if (fields.length === 1 && fields[0] === 'overview_doc') return `Replaces the ${current.name} overview doc`
    return `Changes ${listWords(fields.map((f) => FIELD_WORDS[f] ?? f))} on ${current.name}`
  }

  if (!item.proposed_tool_id) {
    const dept = deptName(c.department_id) ?? dataset.departments.find((d) => d.slug === c.department_slug)?.name
    const tier = typeof c.tier === 'string' ? TIER_WORDS[c.tier] ?? c.tier : null
    return `Adds a new tool${dept ? ` to ${dept}` : ''}${tier ? `, ${tier} tier` : ''}`
  }
  const tool = dataset.tools.find((t) => t.id === item.proposed_tool_id)
  if (!tool) return 'Updates a tool that no longer exists'
  const row = tool as unknown as Record<string, unknown>
  const fields = PP_TOOL_EDITABLE_FIELDS.filter((f) => f in c && !same(row[f], c[f]))
  if (fields.length === 0) return `Marks ${tool.name} verified; no field changes`
  const parts: string[] = []
  const plain = fields
    .filter((f) => f !== 'attributes')
    .map((f) => (f === 'department_id' ? `department to ${deptName(c.department_id) ?? 'another'}` : FIELD_WORDS[f] ?? f))
  if (plain.length) parts.push(`changes ${listWords(plain)}`)
  if (fields.includes('attributes') && c.attributes && typeof c.attributes === 'object') {
    const before = tool.attributes ?? {}
    const after = c.attributes as Record<string, unknown>
    const added = Object.keys(after).filter((k) => !(k in before))
    const changed = Object.keys(after).filter((k) => k in before && !same(before[k], after[k]))
    const removed = Object.keys(before).filter((k) => !(k in after))
    const bits = [
      added.length ? `adds ${listWords(added)}` : '',
      changed.length ? `changes ${listWords(changed)}` : '',
      removed.length ? `removes ${listWords(removed)}` : '',
    ].filter(Boolean)
    parts.push(`attributes: ${bits.join('; ') || 'same values, reordered'}`)
  }
  const line = `${parts.join('; ')} on ${tool.name}`
  return line.charAt(0).toUpperCase() + line.slice(1)
}

// The part of accept that destroys something, for the confirm's warning:
// an `attributes` proposal replaces the whole map (keys it omits are gone),
// and a department overview_doc is replaced wholesale. Both stay in
// pp_changelog, but nothing restores them.
function describeRemoval(item: PpQueueItem, dataset: PpDataset): string | null {
  const c = item.proposed_changes
  if (item.target_type === 'department') {
    const current = item.proposed_department_id ? dataset.departments.find((d) => d.id === item.proposed_department_id) : undefined
    if (!current || typeof c.overview_doc !== 'string' || same(current.overview_doc, c.overview_doc)) return null
    const before = (current.overview_doc ?? '').length
    return before ? `Replaces the whole ${current.name} overview doc (${before.toLocaleString()} → ${c.overview_doc.length.toLocaleString()} chars)` : null
  }
  const tool = item.proposed_tool_id ? dataset.tools.find((t) => t.id === item.proposed_tool_id) : undefined
  if (!tool || !c.attributes || typeof c.attributes !== 'object') return null
  const after = c.attributes as Record<string, unknown>
  const removed = Object.keys(tool.attributes ?? {}).filter((k) => !(k in after))
  if (!removed.length) return null
  return `Removes ${listWords(removed)} from ${tool.name}'s attributes`
}

export async function fetchReviewQueue(since: Date): Promise<CatchupReview> {
  const [items, dataset] = await Promise.all([fetchPendingQueue(), fetchPostPulseDataset()])
  const deptById = new Map(dataset.departments.map((d) => [d.id, d.name]))
  const deptBySlug = new Map(dataset.departments.map((d) => [d.slug, d.name]))
  const toolById = new Map(dataset.tools.map((t) => [t.id, t]))
  const sinceIso = since.toISOString()

  let needsResolving = 0
  const rows: CatchupReviewItem[] = []
  for (const item of items) {
    // The same validator acceptQueueItem runs first: anything it would refuse
    // by design (flagged notes, malformed rows) is resolved in chat, not here.
    if (!validateStoredProposal(item).ok) {
      needsResolving++
      continue
    }
    const c = item.proposed_changes
    const name = typeof c.name === 'string' && c.name ? c.name : null
    const isDept = item.target_type === 'department'
    const tool = !isDept && item.proposed_tool_id ? toolById.get(item.proposed_tool_id) : undefined
    const dept = isDept && item.proposed_department_id ? deptById.get(item.proposed_department_id) : undefined
    // Same wording as QueueClient's row titles.
    const title = isDept
      ? dept
        ? `Update department ${dept}`
        : item.proposed_department_id
          ? 'Update to a department that no longer exists'
          : `New department${name ? `: ${name}` : ''}`
      : tool
        ? `Update ${tool.name}`
        : item.proposed_tool_id
          ? 'Update to a tool that no longer exists'
          : `New tool${name ? `: ${name}` : ''}`
    const department = isDept
      ? null
      : (typeof c.department_id === 'string' && deptById.get(c.department_id)) ||
        (typeof c.department_slug === 'string' && deptBySlug.get(c.department_slug)) ||
        (tool && deptById.get(tool.department_id)) ||
        null
    // Accept refuses these (422 / 404); say so up front. The server's own
    // message is still what shows if accept is tried anyway.
    const collision = !isDept && !item.proposed_tool_id && name ? findNameCollision(name, dataset) : null
    const blocked = collision
      ? `Already tracked as ${collision.tool.name} in ${collision.departmentName}; accept will be refused`
      : (item.proposed_tool_id && !tool) || (item.proposed_department_id && !dept)
        ? 'Its target no longer exists; accept will be refused'
        : null
    const note = typeof c.note === 'string' ? stripMarkdown(c.note).replace(/\s+/g, ' ').trim() : ''
    rows.push({
      id: item.id,
      title,
      department,
      sourceLabel: PP_QUEUE_SOURCES[item.source] ?? item.source,
      frontier: item.source === 'frontier',
      effect: describeEffect(item, dataset),
      warning: describeRemoval(item, dataset),
      blocked,
      note: note.length > REVIEW_NOTE_CHARS ? note.slice(0, REVIEW_NOTE_CHARS).replace(/\s+\S*$/, '') + '…' : note,
      createdAt: item.created_at,
      dateLabel: rowDateLabel(item.created_at),
      isNew: item.created_at > sinceIso,
      href: `/post-pulse/queue#q-${item.id}`,
    })
  }
  // New since last_seen first, then the rest; newest first within each.
  rows.sort((a, b) => Number(b.isNew) - Number(a.isNew) || b.createdAt.localeCompare(a.createdAt))
  return { items: rows, newCount: rows.filter((r) => r.isNew).length, needsResolving }
}

// ── Summary input (pure; also used for the pre-run estimate) ─────────────────

// The text the summary reads: the newest CATCHUP_CAP items, oldest first,
// each capped so a long absence can't become an expensive call. A digest
// contributes only its Post-Pulse stories.
export function buildSummaryInput(compiled: CatchupCompiled): string {
  const { inputs, summaryItems, postPulseChannelIds } = compiled
  if (summaryItems.length === 0) return ''
  const perItem = Math.min(CATCHUP_SUMMARY_PER_ITEM_CHARS, Math.floor(CATCHUP_SUMMARY_TOTAL_CHARS / summaryItems.length))
  const channelName = new Map(inputs.channels.map((c) => [c.id, c.name]))
  const ppNames = new Set(postPulseChannelIds.map((id) => normName(channelName.get(id) ?? '')))
  const allNames = inputs.channels.map((c) => c.name)
  const cap = (t: string) => (t.length > perItem ? t.slice(0, perItem) + '\n[…truncated]' : t)

  const blocks: string[] = []
  for (const item of [...summaryItems].reverse()) {
    const date = rowDateLabel(item.createdAt)
    if (item.kind === 'briefing') {
      const b = inputs.briefings.find((x) => x.id === item.id)
      if (!b) continue
      blocks.push(`=== ${channelName.get(b.channel_id) ?? 'Briefing'} · briefing · ${date} ===\n${cap(b.content.trim())}`)
    } else {
      const d = inputs.digests.find((x) => x.id === item.id)
      if (!d) continue
      const parsed = parsePressSections(d.content, { neverAside: allNames })
      const stories = parsed.sections.filter((s) => s.title && !s.isAside && ppNames.has(normName(s.title)))
      // compileRecap's fallback: no recognisable stories → the digest was
      // filed under its channels whole, so summarise it whole.
      const text = stories.length
        ? stories.map((s) => `## ${s.title}\n${s.body}`).join('\n\n')
        : d.content.trim()
      const names = stories.length ? stories.map((s) => s.title).join(', ') : (d.channel_names ?? []).join(', ')
      blocks.push(`=== Digest (${names}) · ${date} ===\n${cap(text)}`)
    }
  }
  return blocks.join('\n\n')
}

export function estimateSummary(model: string, items: number, inputChars: number): CatchupEstimate {
  const inputTokens = Math.ceil((CATCHUP_SUMMARY_SYSTEM.length + inputChars) / 4) + 50
  return {
    model,
    modelLabel: MODEL_LABELS[model] ?? model,
    items,
    inputChars,
    typicalUsd: calculateCost(model, inputTokens, CATCHUP_SUMMARY_TYPICAL_OUTPUT),
    maxUsd: calculateCost(model, inputTokens, CATCHUP_SUMMARY_MAX_TOKENS),
  }
}

// ── The panel's data ─────────────────────────────────────────────────────────

export function catchupRange(lastSeen: Date | null, now: Date): { since: Date; until: Date; firstVisit: boolean; longAbsence: boolean } {
  const firstVisit = !lastSeen
  const since = lastSeen ?? new Date(now.getTime() - CATCHUP_FIRST_VISIT_DAYS * DAY_MS)
  return {
    since,
    until: now,
    firstVisit,
    longAbsence: !!lastSeen && now.getTime() - lastSeen.getTime() > CATCHUP_LONG_ABSENCE_DAYS * DAY_MS,
  }
}

export async function fetchCatchup(profileId: string, now = new Date()): Promise<Catchup> {
  const settings = await fetchCatchupSettings(profileId)
  const range = catchupRange(settings.lastSeen, now)
  const compiled = await compileCatchup(profileId, range, range.longAbsence)

  const [footerLines, review] = await Promise.all([
    Promise.all(
      CATCHUP_COUNTERS.map((c) => c({ profileId, since: range.since, ppChannelIds: compiled.postPulseChannelIds })),
    ),
    // The review section is optional for the rest of the panel: if pp_queue
    // can't be read, the briefings still show.
    fetchReviewQueue(range.since).catch((err): CatchupReview => {
      console.warn(`[catchup] review queue skipped: ${err instanceof Error ? err.message : String(err)}`)
      return { items: [], newCount: 0, needsResolving: 0 }
    }),
  ])
  const footer = footerLines.filter((l): l is CatchupFooterLine => !!l)

  const cached = settings.cached?.itemKey === compiled.itemKey ? settings.cached : null
  const input = compiled.items.length ? buildSummaryInput(compiled) : ''

  return {
    snapshotAt: now.toISOString(),
    since: range.since.toISOString(),
    firstVisit: range.firstVisit,
    longAbsence: range.longAbsence,
    sinceLabel: sinceLabel(range.since, now, range.firstVisit),
    newCount: compiled.items.length,
    unreadCount: compiled.items.filter((i) => i.unread).length,
    olderCount: range.longAbsence ? Math.max(0, compiled.items.length - CATCHUP_CAP) : 0,
    channels: compiled.channels,
    footer,
    review,
    collapsed: settings.collapsed,
    summary: cached ? { content: cached.content, model: cached.model, costUsd: cached.costUsd, createdAt: cached.createdAt } : null,
    estimate: input ? estimateSummary(settings.model, compiled.summaryItems.length, input.length) : null,
  }
}
