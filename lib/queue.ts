// Server-only: the Listen Queue (migration 019). Never import in 'use client'.
import { supabase } from '@/lib/supabase'
import { SPEECH_SCRIPT_VERSION, buildSpeechScript } from '@/lib/speechScript'
import { ELEVENLABS_DEFAULT_MODEL, ELEVENLABS_DEFAULT_VOICE_ID, estimateTtsCost } from '@/lib/elevenlabs'
import type { ListenQueueItem, QueueCostSummary, TtsProvider } from '@/lib/types'

export type QueueKind = 'briefing' | 'digest'
export type QueueSource = 'scheduled' | 'live' | 'manual'

const PLAYED_RETENTION_DAYS = 30

interface QueueRow {
  id: string
  profile_id: string
  kind: QueueKind
  item_id: string
  position: number
  source: QueueSource
  added_at: string
  played_at: string | null
  progress_sentence: number
  progress_seconds: number
  last_played_at: string | null
}

async function nextPosition(profileId: string): Promise<number> {
  const { data } = await supabase
    .from('listen_queue')
    .select('position')
    .eq('profile_id', profileId)
    .order('position', { ascending: false })
    .limit(1)
  return ((data?.[0]?.position as number | undefined) ?? 0) + 1
}

// Add an item (idempotent). A previously played item is re-queued at the
// end with its progress reset — that's how history items come back.
export async function enqueue(
  profileId: string, kind: QueueKind, itemId: string, source: QueueSource,
): Promise<QueueRow | null> {
  const { data: existing } = await supabase
    .from('listen_queue')
    .select('*')
    .eq('profile_id', profileId)
    .eq('kind', kind)
    .eq('item_id', itemId)
    .maybeSingle()
  if (existing && !existing.played_at) return existing as QueueRow

  const position = await nextPosition(profileId)
  if (existing) {
    const { data } = await supabase
      .from('listen_queue')
      .update({ position, played_at: null, progress_sentence: 0, progress_seconds: 0, last_played_at: null, source, added_at: new Date().toISOString() })
      .eq('id', existing.id)
      .select('*')
      .single()
    return (data as QueueRow | null) ?? null
  }
  const { data, error } = await supabase
    .from('listen_queue')
    .insert({ profile_id: profileId, kind, item_id: itemId, position, source })
    .select('*')
    .single()
  if (error) {
    // Race with a parallel enqueue of the same item — the unique index wins
    if (/duplicate|unique/i.test(error.message)) return null
    throw new Error(error.message)
  }
  return data as QueueRow
}

export async function removeFromQueue(profileId: string, queueId: string): Promise<void> {
  await supabase.from('listen_queue').delete().eq('id', queueId).eq('profile_id', profileId)
}

// Storage-style cleanup hook for the delete routes / retention sweep
export async function removeQueueItemsFor(kind: QueueKind, itemIds: string[]): Promise<void> {
  if (itemIds.length === 0) return
  await supabase.from('listen_queue').delete().eq('kind', kind).in('item_id', itemIds)
}

export async function reorderQueue(profileId: string, orderedIds: string[]): Promise<void> {
  // Positions restart at 1 in the given order; anything not listed keeps a
  // higher position than the listed set so it trails.
  await Promise.all(
    orderedIds.map((id, i) =>
      supabase.from('listen_queue').update({ position: i + 1 }).eq('id', id).eq('profile_id', profileId),
    ),
  )
}

export async function updateQueueItem(
  profileId: string,
  queueId: string,
  patch: { progress_sentence?: number; progress_seconds?: number; played?: boolean },
): Promise<QueueRow | null> {
  const update: Record<string, unknown> = {}
  if (patch.progress_sentence !== undefined) update.progress_sentence = Math.max(0, Math.floor(patch.progress_sentence))
  if (patch.progress_seconds !== undefined) update.progress_seconds = Math.max(0, patch.progress_seconds)
  if (patch.played === true) {
    update.played_at = new Date().toISOString()
    update.progress_sentence = 0
    update.progress_seconds = 0
  }
  if (patch.played === false) update.played_at = null
  update.last_played_at = new Date().toISOString()
  const { data } = await supabase
    .from('listen_queue')
    .update(update)
    .eq('id', queueId)
    .eq('profile_id', profileId)
    .select('*')
    .single()
  return (data as QueueRow | null) ?? null
}

// A scheduled batch arrives in completion order (generation runs in
// parallel). After the run, put its unplayed items in edition order: digest
// first (the front page), then briefings by channel position — after any
// older unplayed items already waiting.
export async function sortBatch(profileId: string, sinceIso: string): Promise<void> {
  const { data } = await supabase
    .from('listen_queue')
    .select('*')
    .eq('profile_id', profileId)
    .is('played_at', null)
    .order('position', { ascending: true })
  const rows = (data ?? []) as QueueRow[]
  const older = rows.filter((r) => r.added_at < sinceIso)
  const batch = rows.filter((r) => r.added_at >= sinceIso)
  if (batch.length < 2) return

  const briefingIds = batch.filter((r) => r.kind === 'briefing').map((r) => r.item_id)
  const { data: briefings } = briefingIds.length
    ? await supabase.from('briefings').select('id, channel_id, channels(position)').in('id', briefingIds)
    : { data: [] }
  const channelPos = new Map<string, number>()
  for (const b of (briefings ?? []) as { id: string; channels: { position?: number } | { position?: number }[] | null }[]) {
    const c = Array.isArray(b.channels) ? b.channels[0] : b.channels
    channelPos.set(b.id, c?.position ?? 9999)
  }
  batch.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'digest' ? -1 : 1
    return (channelPos.get(a.item_id) ?? 9999) - (channelPos.get(b.item_id) ?? 9999)
  })
  await reorderQueue(profileId, [...older, ...batch].map((r) => r.id))
}

async function prunePlayed(profileId: string): Promise<void> {
  const cutoff = new Date(Date.now() - PLAYED_RETENTION_DAYS * 86_400_000).toISOString()
  await supabase.from('listen_queue').delete().eq('profile_id', profileId).not('played_at', 'is', null).lt('played_at', cutoff)
}

// ── Listing (with titles, lengths, cache state) ──────────────────────────────

interface ItemMeta {
  title: string
  subtitle: string | null
  created_at: string
  content: string
  channel_id: string | null
  channelNames: string[]
}

async function loadMeta(rows: QueueRow[]): Promise<Map<string, ItemMeta>> {
  const meta = new Map<string, ItemMeta>()
  const bIds = rows.filter((r) => r.kind === 'briefing').map((r) => r.item_id)
  const dIds = rows.filter((r) => r.kind === 'digest').map((r) => r.item_id)
  const [b, d] = await Promise.all([
    bIds.length ? supabase.from('briefings').select('id, content, created_at, channel_id, channels(name)').in('id', bIds) : Promise.resolve({ data: [] }),
    dIds.length ? supabase.from('digests').select('id, content, created_at, channel_names').in('id', dIds) : Promise.resolve({ data: [] }),
  ])
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const row of (b.data ?? []) as any[]) {
    const c = Array.isArray(row.channels) ? row.channels[0] : row.channels
    meta.set(`briefing:${row.id}`, { title: c?.name ?? 'Briefing', subtitle: null, created_at: row.created_at, content: row.content ?? '', channel_id: row.channel_id, channelNames: [] })
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const row of (d.data ?? []) as any[]) {
    const names = (row.channel_names ?? []) as string[]
    meta.set(`digest:${row.id}`, { title: 'Morning Digest', subtitle: names.join(', ') || null, created_at: row.created_at, content: row.content ?? '', channel_id: null, channelNames: names })
  }
  return meta
}

export async function listQueue(profileId: string, tts: { provider: TtsProvider; voiceId: string | null }): Promise<{
  items: ListenQueueItem[]
  cost: QueueCostSummary
}> {
  await prunePlayed(profileId)
  const { data } = await supabase
    .from('listen_queue')
    .select('*')
    .eq('profile_id', profileId)
    .order('position', { ascending: true })
  const rows = (data ?? []) as QueueRow[]
  const meta = await loadMeta(rows)

  // Drop rows whose briefing/digest no longer exists (deleted out-of-band)
  const live = rows.filter((r) => meta.has(`${r.kind}:${r.item_id}`))
  const orphanIds = rows.filter((r) => !meta.has(`${r.kind}:${r.item_id}`)).map((r) => r.id)
  if (orphanIds.length) await supabase.from('listen_queue').delete().in('id', orphanIds)

  const voiceId = tts.voiceId ?? ELEVENLABS_DEFAULT_VOICE_ID
  const cachedKeys = new Set<string>()
  if (tts.provider === 'elevenlabs' && live.length) {
    const { data: cached } = await supabase
      .from('tts_audio')
      .select('kind, item_id')
      .eq('voice_id', voiceId)
      .eq('model_id', ELEVENLABS_DEFAULT_MODEL)
      .eq('script_version', SPEECH_SCRIPT_VERSION)
      .in('item_id', live.map((r) => r.item_id))
    for (const c of (cached ?? []) as { kind: string; item_id: string }[]) cachedKeys.add(`${c.kind}:${c.item_id}`)
  }

  const items: ListenQueueItem[] = live.map((r) => {
    const m = meta.get(`${r.kind}:${r.item_id}`)!
    const plain = buildSpeechScript(m.content, r.kind, { channelNames: m.channelNames }).text
    const words = plain.split(/\s+/).filter(Boolean).length
    return {
      id: r.id,
      kind: r.kind,
      item_id: r.item_id,
      position: r.position,
      source: r.source,
      added_at: r.added_at,
      played_at: r.played_at,
      progress_sentence: r.progress_sentence,
      progress_seconds: Number(r.progress_seconds) || 0,
      last_played_at: r.last_played_at,
      title: m.title,
      subtitle: m.subtitle,
      created_at: m.created_at,
      channel_id: m.channel_id,
      chars: plain.length,
      minutes: Math.max(1, Math.round(words / 200)),
      cached: cachedKeys.has(`${r.kind}:${r.item_id}`),
    }
  })

  const unplayed = items.filter((i) => !i.played_at)
  const uncached = unplayed.filter((i) => !i.cached)
  const uncachedChars = uncached.reduce((n, i) => n + i.chars, 0)
  const cost: QueueCostSummary = {
    provider: tts.provider,
    unplayed: unplayed.length,
    chars: unplayed.reduce((n, i) => n + i.chars, 0),
    minutes: unplayed.reduce((n, i) => n + i.minutes, 0),
    cachedCount: unplayed.length - uncached.length,
    uncachedChars,
    estimatedCost: tts.provider === 'elevenlabs' ? estimateTtsCost(uncachedChars) : 0,
  }
  return { items, cost }
}

export async function getQueueItemContent(profileId: string, queueId: string): Promise<{
  queueId: string; kind: QueueKind; itemId: string; title: string; content: string; channelNames: string[]
} | null> {
  const { data } = await supabase.from('listen_queue').select('*').eq('id', queueId).eq('profile_id', profileId).maybeSingle()
  if (!data) return null
  const row = data as QueueRow
  const meta = await loadMeta([row])
  const m = meta.get(`${row.kind}:${row.item_id}`)
  if (!m) return null
  return { queueId: row.id, kind: row.kind, itemId: row.item_id, title: m.title, content: m.content, channelNames: m.channelNames }
}
