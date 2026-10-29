// Server-only: "Channel archive", several channels' briefings exported as one
// PDF or as volumes. Selection, ownership, the volume estimate, the Storage
// cache and pruning. The drawing is lib/pdf/archive-pdf; the single-channel
// export (lib/channel-export) is separate and unchanged. Reads briefings and
// nothing else: no read marks, no queue changes, no model or TTS calls.
// Never import in 'use client' files.
import { createHash } from 'node:crypto'
import { supabase } from '@/lib/supabase'
import {
  EXPORT_BUCKET, EXPORT_LAYOUT_VERSION, MAX_BRIEFINGS, MAX_PAGES,
  etDay, fetchExportBriefings, parseExportRequest, rangeLabel, type ExportRequest,
} from '@/lib/channel-export'
import { estimatePages, type ExportBriefing } from '@/lib/pdf/channel-pdf'
import type { ArchiveChannelInput, ArchiveLayout } from '@/lib/pdf/archive-pdf'

// Briefings one request will lay out. The plan lays out every briefing
// (measured Oct 28 2026: ~80 ms each locally), so this keeps the plan well
// inside maxDuration; volumes that don't fit the rest of the time are left
// for a follow-up request.
export const MAX_ARCHIVE_BRIEFINGS = 1000
export const MAX_ARCHIVE_CHANNELS = 100
// Multi-channel exports kept per profile (the files of the current export
// are always kept)
const KEEP_ARCHIVES = 6

export interface ArchiveRequest extends ExportRequest { channelIds: string[] }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function parseArchiveRequest(input: Record<string, unknown>): ArchiveRequest | string {
  const base = parseExportRequest(input)
  if (typeof base === 'string') return base
  const raw = Array.isArray(input.channels) ? input.channels : String(input.channels ?? '').split(',')
  const ids = [...new Set(raw.map((v) => String(v).trim()).filter(Boolean))]
  if (!ids.length) return 'Pick at least one channel.'
  if (ids.length > MAX_ARCHIVE_CHANNELS) return `At most ${MAX_ARCHIVE_CHANNELS} channels per export`
  if (ids.some((id) => !UUID.test(id))) return 'channels must be channel ids'
  return { ...base, channelIds: ids }
}

export interface ArchiveChannel { id: string; name: string; recap_group: string | null }

// The profile's channels in the order the home screen shows them: the same
// position-ordered query as app/page.tsx (ties keep the order it returns),
// ungrouped channels first, then each group in its own position order
export async function channelsInAppOrder(profileId: string): Promise<ArchiveChannel[]> {
  const [channels, groups] = await Promise.all([
    supabase.from('channels').select('id, name, recap_group, group_id').eq('profile_id', profileId).order('position', { ascending: true }),
    supabase.from('channel_groups').select('id').eq('profile_id', profileId).order('position', { ascending: true }),
  ])
  if (channels.error) throw new Error(channels.error.message)
  if (groups.error) throw new Error(groups.error.message)
  const rows = channels.data ?? []
  const groupIds = new Set((groups.data ?? []).map((g) => g.id))
  const ordered = [
    // A channel whose group no longer exists (home hides it) is listed
    // with the ungrouped ones rather than left out
    ...rows.filter((c) => c.group_id == null || !groupIds.has(c.group_id)),
    ...(groups.data ?? []).flatMap((g) => rows.filter((c) => c.group_id === g.id)),
  ]
  return ordered.map((c) => ({ id: c.id, name: c.name, recap_group: c.recap_group }))
}

// Every requested channel, in app order, only if the cookie's profile owns
// all of them; null refuses the whole request. Ids from the client are
// never used without this check.
export async function ownedChannels(profileId: string, ids: string[]): Promise<ArchiveChannel[] | null> {
  const wanted = new Set(ids)
  const owned = (await channelsInAppOrder(profileId)).filter((c) => wanted.has(c.id))
  return owned.length === wanted.size ? owned : null
}

export async function fetchArchiveInput(channels: ArchiveChannel[], req: ExportRequest): Promise<ArchiveChannelInput[]> {
  const lists = await Promise.all(channels.map((c) => fetchExportBriefings(c.id, req)))
  return channels.map((c, i) => ({ id: c.id, name: c.name, briefings: lists[i] }))
}

export interface ArchiveSummary {
  count: number
  estimatedPages: number
  estimatedVolumes: number
  channels: { id: string; name: string; count: number; estimatedPages: number }[]
  empty: string[] // selected channels with nothing in the range (left out)
  firstDay: string | null
  lastDay: string | null
  tooMany: string | null
  limits: { briefings: number; pages: number }
}

// Before any layout: the single-channel estimate per channel, packed the way
// the planner packs real pages. The exact plan comes back from POST.
export function summarizeArchive(input: ArchiveChannelInput[]): ArchiveSummary {
  const withBriefings = input.filter((c) => c.briefings.length)
  const channels = input.map((c) => ({
    id: c.id, name: c.name, count: c.briefings.length,
    estimatedPages: c.briefings.length ? estimatePages(c.briefings.map((b) => ({ contentLength: b.content.length }))) : 0,
  }))
  const count = channels.reduce((s, c) => s + c.count, 0)
  // A channel's block (divider + its contents + briefings) is its own
  // estimate with the divider in place of the cover
  const blocks = channels.filter((c) => c.count).map((c) => ({ pages: c.estimatedPages, count: c.count }))
  let volumes = 0
  let pages = 0
  let briefings = 0
  let entries = 0
  const room = (p: number, b: number, e: number) => 1 + Math.ceil((e || 1) / 20) + p <= MAX_PAGES && b <= MAX_BRIEFINGS
  for (const b of blocks) {
    if (entries && room(pages + b.pages, briefings + b.count, entries + 1)) { pages += b.pages; briefings += b.count; entries += 1; continue }
    if (room(b.pages, b.count, 1)) { volumes += 1; pages = b.pages; briefings = b.count; entries = 1; continue }
    // Too big alone: cut into volume-sized parts
    const parts = Math.max(Math.ceil(b.pages / (MAX_PAGES - 3)), Math.ceil(b.count / MAX_BRIEFINGS))
    volumes += parts
    pages = b.pages - (parts - 1) * (MAX_PAGES - 3)
    briefings = b.count - (parts - 1) * Math.floor(b.count / parts)
    entries = 1
  }
  // Each volume adds a cover and a contents page
  const estimatedPages = blocks.length ? blocks.reduce((s, b) => s + b.pages, 0) + 2 * volumes : 0
  const days = withBriefings.flatMap((c) => c.briefings.map((b) => etDay(b.created_at))).sort()
  return {
    count,
    estimatedPages,
    estimatedVolumes: volumes,
    channels,
    empty: channels.filter((c) => !c.count).map((c) => c.name),
    firstDay: days[0] ?? null,
    lastDay: days[days.length - 1] ?? null,
    tooMany: count > MAX_ARCHIVE_BRIEFINGS
      ? `${count} briefings is more than one archive export can take (${MAX_ARCHIVE_BRIEFINGS}). Pick fewer channels or a shorter date range.`
      : null,
    limits: { briefings: MAX_BRIEFINGS, pages: MAX_PAGES },
  }
}

function briefingHash(b: ExportBriefing): string {
  return createHash('sha256').update(b.content).update(JSON.stringify(b.sources ?? [])).digest('hex')
}

// Cache key of one volume: everything its pages show. Stored at the profile
// folder's top level, apart from the single-channel exports' channel folders.
export function archiveVolumePath(profileId: string, layout: ArchiveLayout, index: number, req: ExportRequest): string {
  const h = createHash('sha256')
  h.update(JSON.stringify({
    v: EXPORT_LAYOUT_VERSION, kind: 'archive', label: rangeLabel(req.range), order: req.order,
    volume: index, volumes: layout.volumes.length,
  }))
  for (const p of layout.volumes[index].parts) {
    const ch = layout.channels[p.channel]
    h.update(`\n#${ch.id}|${ch.name}|${p.part}/${p.parts}|${ch.briefings.length}`)
    for (const b of ch.briefings.slice(p.from, p.to)) h.update(`\n${b.id}|${b.created_at}|${briefingHash(b)}`)
  }
  return `${profileId}/${h.digest('hex').slice(0, 32)}.pdf`
}

export function archiveDownloadName(layout: ArchiveLayout, index: number): string {
  const v = layout.volumes[index]
  const days = v.parts.flatMap((p) => layout.channels[p.channel].briefings.slice(p.from, p.to).map((b) => etDay(b.created_at))).sort()
  const span = days.length ? (days[0] === days[days.length - 1] ? days[0] : `${days[0]} to ${days[days.length - 1]}`) : ''
  const vol = layout.volumes.length > 1 ? ` vol ${index + 1} of ${layout.volumes.length}` : ''
  return `Pulse archive${vol}${span ? ` - ${span}` : ''}.pdf`
}

// Upload, then keep the newest few archive files of this profile. The
// current export's files are never pruned, even when older (reused).
export async function storeArchive(path: string, pdf: Buffer, keep: string[]): Promise<void> {
  const { error } = await supabase.storage.from(EXPORT_BUCKET).upload(path, pdf, { contentType: 'application/pdf', upsert: true })
  if (error) throw new Error(`Could not store the PDF: ${error.message}`)
  await pruneArchives(path.slice(0, path.indexOf('/')), [...keep, path])
}

async function pruneArchives(profileId: string, keep: string[]): Promise<void> {
  const { data } = await supabase.storage.from(EXPORT_BUCKET).list(profileId, { limit: 1000, sortBy: { column: 'created_at', order: 'desc' } })
  // Files only: the channel folders below are the single-channel cache
  const files = (data ?? []).filter((f) => f.id && f.name.endsWith('.pdf')).map((f) => `${profileId}/${f.name}`)
  const stale = files.slice(KEEP_ARCHIVES).filter((p) => !keep.includes(p))
  if (stale.length) await supabase.storage.from(EXPORT_BUCKET).remove(stale)
}

// A deleted channel's content may sit in any archive file of the profile;
// those go too (they are rebuilt on the next export)
export async function removeProfileArchives(profileId: string): Promise<void> {
  const { data } = await supabase.storage.from(EXPORT_BUCKET).list(profileId, { limit: 1000 })
  const files = (data ?? []).filter((f) => f.id && f.name.endsWith('.pdf')).map((f) => `${profileId}/${f.name}`)
  if (files.length) await supabase.storage.from(EXPORT_BUCKET).remove(files)
}
