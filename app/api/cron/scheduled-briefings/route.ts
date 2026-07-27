import { NextRequest } from 'next/server'
import { supabase } from '@/lib/supabase'
import { generateChannelBriefing, generateProfileDigest } from '@/lib/generation'
import type { Channel } from '@/lib/types'

// Web-search generation can take minutes; channels run in parallel
export const maxDuration = 300
export const dynamic = 'force-dynamic'

// How far back to look when deciding whether an item was already generated.
// The scheduled flag doubles as a progress tracker: anything missing from
// this window is (re)generated, so a partially timed-out run is completed
// by a later invocation instead of being skipped.
const DEDUPE_WINDOW_MS = 20 * 60 * 60 * 1000

// A profile is eligible at its scheduled hour and for a few hours after,
// so the next hourly cron run picks up whatever an earlier run left behind.
const CATCH_UP_HOURS = 3

function currentHourInET(): number {
  const hour = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hour: '2-digit',
    hour12: false,
  }).format(new Date())
  return parseInt(hour, 10) % 24
}

// Whole calendar days between two instants, in Eastern Time. Calendar-day
// comparison (rather than elapsed milliseconds) means a run at 05:02 doesn't
// push the next eligible run past the scheduled hour N days later.
function etDayDiff(from: Date, to: Date): number {
  const key = (d: Date) => d.toLocaleDateString('en-CA', { timeZone: 'America/New_York' })
  const a = new Date(`${key(from)}T00:00:00Z`).getTime()
  const b = new Date(`${key(to)}T00:00:00Z`).getTime()
  return Math.round((b - a) / 86_400_000)
}

export async function GET(req: NextRequest) {
  // Vercel Cron sends Authorization: Bearer <CRON_SECRET>
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret || req.headers.get('authorization') !== `Bearer ${cronSecret}`) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const etHour = currentHourInET()

  const { data: scheduledSettings, error } = await supabase
    .from('settings')
    .select('*')
    .eq('schedule_enabled', true)

  if (error) {
    return Response.json({ error: error.message }, { status: 500 })
  }

  const results: Array<{
    profileId: string
    status: 'generated' | 'partial' | 'skipped' | 'error'
    succeeded: string[]
    failed: string[]
    detail?: string
  }> = []

  for (const settings of scheduledSettings ?? []) {
    const profileId: string = settings.id
    const scheduledHour = parseInt((settings.schedule_time ?? '06:00').split(':')[0], 10)

    const hoursSinceScheduled = (etHour - scheduledHour + 24) % 24
    if (hoursSinceScheduled > CATCH_UP_HOURS) {
      continue
    }

    try {
      // ── Resolve which channels this schedule covers ────────────────────
      const { data: channelData } = await supabase
        .from('channels')
        .select('*')
        .eq('profile_id', profileId)
        .order('position', { ascending: true })

      let channels = (channelData ?? []) as Channel[]
      const selectedIds: string[] = settings.schedule_channel_ids ?? []
      if (selectedIds.length > 0) {
        channels = channels.filter((c) => selectedIds.includes(c.id))
      }

      if (channels.length === 0) {
        results.push({ profileId, status: 'skipped', succeeded: [], failed: [], detail: 'No channels to generate' })
        continue
      }

      // ── Per-channel due computation ────────────────────────────────────
      // Each channel has its own interval and output type; NULL inherits the
      // profile-level settings. Intervals are anchored per channel: briefings
      // to the channel's newest scheduled briefing, digest participation to
      // the newest scheduled digest that included the channel. daysSince === 0
      // falls through (today is a run day; the dedupe pass below completes a
      // partial run); 0 < daysSince < interval means not due.
      const profileInterval: number = settings.schedule_interval_days ?? 1
      const profileOutputRaw: string = settings.schedule_output ?? 'briefings'
      const profileOutput = profileOutputRaw === 'briefings' ? 'briefing' : profileOutputRaw

      const anchorLookback = new Date(Date.now() - 45 * 24 * 60 * 60 * 1000).toISOString()
      const [briefingAnchors, digestAnchors] = await Promise.all([
        supabase
          .from('briefings')
          .select('channel_id, created_at')
          .in('channel_id', channels.map((c) => c.id))
          .eq('scheduled', true)
          .gte('created_at', anchorLookback)
          .order('created_at', { ascending: false }),
        supabase
          .from('digests')
          .select('channel_ids, created_at')
          .eq('profile_id', profileId)
          .eq('scheduled', true)
          .gte('created_at', anchorLookback)
          .order('created_at', { ascending: false }),
      ])

      const lastBriefingAt = new Map<string, string>()
      for (const row of briefingAnchors.data ?? []) {
        if (!lastBriefingAt.has(row.channel_id)) lastBriefingAt.set(row.channel_id, row.created_at)
      }
      const lastDigestAt = new Map<string, string>()
      for (const row of digestAnchors.data ?? []) {
        for (const cid of (row.channel_ids ?? []) as string[]) {
          if (!lastDigestAt.has(cid)) lastDigestAt.set(cid, row.created_at)
        }
      }

      function isDue(anchorIso: string | undefined, intervalDays: number): boolean {
        if (!anchorIso) return true // never scheduled → due now (first run anchors the cycle)
        const daysSince = etDayDiff(new Date(anchorIso), new Date())
        return !(daysSince > 0 && daysSince < intervalDays)
      }

      const effectiveOutput = (c: Channel) => c.schedule_output ?? profileOutput
      const effectiveInterval = (c: Channel) => c.schedule_interval_days ?? profileInterval

      const briefingChannels = channels.filter((c) => {
        const out = effectiveOutput(c)
        return (out === 'briefing' || out === 'both') && isDue(lastBriefingAt.get(c.id), effectiveInterval(c))
      })
      // Thin days are fine: the digest covers exactly the digest-output
      // channels due today. No digest-channels due → no digest generated.
      const digestChannels = channels.filter((c) => {
        const out = effectiveOutput(c)
        return (out === 'digest' || out === 'both') && isDue(lastDigestAt.get(c.id), effectiveInterval(c))
      })

      if (briefingChannels.length === 0 && digestChannels.length === 0) {
        results.push({ profileId, status: 'skipped', succeeded: [], failed: [], detail: 'No channels due today' })
        continue
      }

      // ── What already exists in this window? ────────────────────────────
      const since = new Date(Date.now() - DEDUPE_WINDOW_MS).toISOString()
      const [doneBriefings, doneDigests] = await Promise.all([
        supabase
          .from('briefings')
          .select('channel_id')
          .in('channel_id', channels.map((c) => c.id))
          .eq('scheduled', true)
          .gte('created_at', since),
        supabase
          .from('digests')
          .select('id')
          .eq('profile_id', profileId)
          .eq('scheduled', true)
          .gte('created_at', since)
          .limit(1),
      ])
      const doneChannelIds = new Set((doneBriefings.data ?? []).map((b) => b.channel_id as string))
      const digestDone = (doneDigests.data?.length ?? 0) > 0

      // ── Build the remaining work list ──────────────────────────────────
      const tasks: Array<{ label: string; run: () => Promise<unknown> }> = []

      for (const channel of briefingChannels) {
        if (doneChannelIds.has(channel.id)) continue
        tasks.push({
          label: channel.name,
          run: () => generateChannelBriefing({ channel, profileId, scheduled: true }),
        })
      }
      if (digestChannels.length > 0 && !digestDone) {
        tasks.push({
          label: `digest (${digestChannels.map((c) => c.name).join(', ')})`,
          run: () => generateProfileDigest({ channels: digestChannels, profileId, scheduled: true }),
        })
      }

      if (tasks.length === 0) {
        results.push({ profileId, status: 'skipped', succeeded: [], failed: [], detail: 'Already generated in this window' })
        continue
      }

      // ── Generate everything in parallel; one failure never kills the batch ──
      console.log(
        `[cron] profile ${profileId}: generating ${tasks.length} item(s) in parallel: ${tasks.map((t) => t.label).join(', ')}`
      )
      const settled = await Promise.allSettled(tasks.map((t) => t.run()))

      const succeeded: string[] = []
      const failed: string[] = []
      settled.forEach((res, i) => {
        if (res.status === 'fulfilled') {
          succeeded.push(tasks[i].label)
        } else {
          const msg = res.reason instanceof Error ? res.reason.message : 'failed'
          failed.push(`${tasks[i].label}: ${msg}`)
          console.error(`[cron] profile ${profileId}: "${tasks[i].label}" failed — ${msg}`)
        }
      })
      console.log(
        `[cron] profile ${profileId}: ${succeeded.length}/${tasks.length} generated` +
        (failed.length ? ` (${failed.length} failed — next hourly run will retry within the catch-up window)` : '')
      )

      results.push({
        profileId,
        status: failed.length === 0 ? 'generated' : succeeded.length > 0 ? 'partial' : 'error',
        succeeded,
        failed,
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error'
      console.error(`[cron] profile ${profileId}: run failed — ${msg}`)
      results.push({ profileId, status: 'error', succeeded: [], failed: [], detail: msg })
    }
  }

  return Response.json({ etHour, checked: scheduledSettings?.length ?? 0, results })
}
