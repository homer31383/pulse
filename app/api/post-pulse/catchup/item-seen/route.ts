import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { supabase } from '@/lib/supabase'

// POST {items: [{kind, id}], seen}: the catch-up panel's per-row "Seen"
// button (seen: true) and its Undo (seen: false). Sets or clears
// briefings/digests.post_pulse_seen_at (migration 037) and nothing else: not
// read_at, the listen queue, post_pulse_last_seen, audio or the weekly recap.
// Every id must belong to the cookie profile (a briefing through its channel,
// a digest through profile_id); one that doesn't refuses the whole request
// and nothing is written.
const DEFAULT_PROFILE_ID = '00000000-0000-0000-0000-000000000001'
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MAX_ITEMS = 50

type Kind = 'briefing' | 'digest'

function parseBody(body: unknown): { items: { kind: Kind; id: string }[]; seen: boolean } | string {
  if (!body || typeof body !== 'object') return 'Body must be a JSON object'
  const { items, seen } = body as { items?: unknown; seen?: unknown }
  if (typeof seen !== 'boolean') return 'seen must be true or false'
  if (!Array.isArray(items) || items.length === 0) return 'items must be a non-empty array'
  if (items.length > MAX_ITEMS) return `At most ${MAX_ITEMS} items per request`
  const out: { kind: Kind; id: string }[] = []
  for (const item of items) {
    const { kind, id } = (item ?? {}) as { kind?: unknown; id?: unknown }
    if (kind !== 'briefing' && kind !== 'digest') return 'Each item needs kind "briefing" or "digest"'
    if (typeof id !== 'string' || !UUID_RE.test(id)) return 'Each item needs a valid id'
    out.push({ kind, id: id.toLowerCase() })
  }
  return { items: out, seen }
}

export async function POST(req: NextRequest) {
  const profileId = (await cookies()).get('profile_id')?.value ?? DEFAULT_PROFILE_ID
  const parsed = parseBody(await req.json().catch(() => null))
  if (typeof parsed === 'string') return NextResponse.json({ error: parsed }, { status: 400 })

  const briefingIds = [...new Set(parsed.items.filter((i) => i.kind === 'briefing').map((i) => i.id))]
  const digestIds = [...new Set(parsed.items.filter((i) => i.kind === 'digest').map((i) => i.id))]

  // Ownership first, for every id, before any write.
  const [ownedBriefings, ownedDigests] = await Promise.all([
    briefingIds.length
      ? supabase.from('briefings').select('id, channels!inner(profile_id)').in('id', briefingIds).eq('channels.profile_id', profileId)
      : Promise.resolve({ data: [] as { id: string }[], error: null }),
    digestIds.length
      ? supabase.from('digests').select('id').in('id', digestIds).eq('profile_id', profileId)
      : Promise.resolve({ data: [] as { id: string }[], error: null }),
  ])
  if (ownedBriefings.error || ownedDigests.error) {
    return NextResponse.json({ error: (ownedBriefings.error ?? ownedDigests.error)!.message }, { status: 500 })
  }
  if ((ownedBriefings.data ?? []).length !== briefingIds.length || (ownedDigests.data ?? []).length !== digestIds.length) {
    return NextResponse.json({ error: 'Item not found' }, { status: 404 })
  }

  const seenAt = parsed.seen ? new Date().toISOString() : null
  const [b, d] = await Promise.all([
    briefingIds.length
      ? supabase.from('briefings').update({ post_pulse_seen_at: seenAt }).in('id', briefingIds).select('id')
      : Promise.resolve({ data: [], error: null }),
    digestIds.length
      ? supabase.from('digests').update({ post_pulse_seen_at: seenAt }).in('id', digestIds).eq('profile_id', profileId).select('id')
      : Promise.resolve({ data: [], error: null }),
  ])
  if (b.error || d.error) return NextResponse.json({ error: (b.error ?? d.error)!.message }, { status: 500 })
  return NextResponse.json({ ok: true, seenAt, updated: (b.data ?? []).length + (d.data ?? []).length })
}
