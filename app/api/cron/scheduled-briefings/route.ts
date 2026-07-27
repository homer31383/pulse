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

      // ── Interval gate: has enough time passed since the last scheduled run? ──
      // Anchored to the most recent scheduled briefing/digest for this profile.
      // daysSince === 0 means today IS a run day (possibly a partial run from an
      // earlier hourly invocation) — fall through so the dedupe pass below
      // completes whatever is missing. The 20h dedupe window still prevents
      // double-firing within the same day.
      const intervalDays: number = settings.schedule_interval_days ?? 1
      if (intervalDays > 1) {
        const [lastBriefing, lastDigest] = await Promise.all([
          supabase
            .from('briefings')
            .select('created_at')
            .in('channel_id', channels.map((c) => c.id))
            .eq('scheduled', true)
            .order('created_at', { ascending: false })
            .limit(1),
          supabase
            .from('digests')
            .select('created_at')
            .eq('profile_id', profileId)
            .eq('scheduled', true)
            .order('created_at', { ascending: false })
            .limit(1),
        ])
        const lastRunIso = [
          lastBriefing.data?.[0]?.created_at,
          lastDigest.data?.[0]?.created_at,
        ].filter(Boolean).sort().pop() as string | undefined

        if (lastRunIso) {
          const daysSince = etDayDiff(new Date(lastRunIso), new Date())
          if (daysSince > 0 && daysSince < intervalDays) {
            results.push({
              profileId,
              status: 'skipped',
              succeeded: [],
              failed: [],
              detail: `Interval not due: ${daysSince} of ${intervalDays} days since last scheduled run`,
            })
            continue
          }
        }
        // No scheduled run on record → due now (first run anchors the cycle).
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
      const output: string = settings.schedule_output ?? 'briefings'
      const tasks: Array<{ label: string; run: () => Promise<unknown> }> = []

      if (output === 'briefings' || output === 'both') {
        for (const channel of channels) {
          if (doneChannelIds.has(channel.id)) continue
          tasks.push({
            label: channel.name,
            run: () => generateChannelBriefing({ channel, profileId, scheduled: true }),
          })
        }
      }
      if ((output === 'digest' || output === 'both') && !digestDone) {
        tasks.push({
          label: 'digest',
          run: () => generateProfileDigest({ channels, profileId, scheduled: true }),
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
