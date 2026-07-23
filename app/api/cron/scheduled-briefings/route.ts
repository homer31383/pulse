import { NextRequest } from 'next/server'
import { supabase } from '@/lib/supabase'
import { generateChannelBriefing, generateProfileDigest } from '@/lib/generation'
import type { Channel } from '@/lib/types'

// Web-search generation for several channels can take minutes
export const maxDuration = 300
export const dynamic = 'force-dynamic'

// How far back to look when deciding a profile's scheduled run already happened
const DEDUPE_WINDOW_MS = 20 * 60 * 60 * 1000

function currentHourInET(): number {
  const hour = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hour: '2-digit',
    hour12: false,
  }).format(new Date())
  return parseInt(hour, 10) % 24
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
    status: 'generated' | 'skipped' | 'error'
    detail: string
  }> = []

  for (const settings of scheduledSettings ?? []) {
    const profileId: string = settings.id
    const scheduledHour = parseInt((settings.schedule_time ?? '06:00').split(':')[0], 10)

    if (scheduledHour !== etHour) {
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
        results.push({ profileId, status: 'skipped', detail: 'No channels to generate' })
        continue
      }

      // ── Idempotency: skip if this profile's scheduled run already happened ──
      const since = new Date(Date.now() - DEDUPE_WINDOW_MS).toISOString()
      const [existingBriefings, existingDigests] = await Promise.all([
        supabase
          .from('briefings')
          .select('id')
          .in('channel_id', channels.map((c) => c.id))
          .eq('scheduled', true)
          .gte('created_at', since)
          .limit(1),
        supabase
          .from('digests')
          .select('id')
          .eq('profile_id', profileId)
          .eq('scheduled', true)
          .gte('created_at', since)
          .limit(1),
      ])
      if (existingBriefings.data?.length || existingDigests.data?.length) {
        results.push({ profileId, status: 'skipped', detail: 'Already generated in this window' })
        continue
      }

      // ── Generate ───────────────────────────────────────────────────────
      const output: string = settings.schedule_output ?? 'briefings'
      const generated: string[] = []
      const failures: string[] = []

      if (output === 'briefings' || output === 'both') {
        for (const channel of channels) {
          try {
            await generateChannelBriefing({ channel, profileId, scheduled: true })
            generated.push(channel.name)
          } catch (err) {
            failures.push(`${channel.name}: ${err instanceof Error ? err.message : 'failed'}`)
          }
        }
      }

      if (output === 'digest' || output === 'both') {
        try {
          await generateProfileDigest({ channels, profileId, scheduled: true })
          generated.push('digest')
        } catch (err) {
          failures.push(`digest: ${err instanceof Error ? err.message : 'failed'}`)
        }
      }

      results.push({
        profileId,
        status: generated.length > 0 ? 'generated' : 'error',
        detail:
          `Generated: ${generated.join(', ') || 'none'}` +
          (failures.length ? ` — failed: ${failures.join('; ')}` : ''),
      })
    } catch (err) {
      results.push({
        profileId,
        status: 'error',
        detail: err instanceof Error ? err.message : 'Unknown error',
      })
    }
  }

  return Response.json({ etHour, checked: scheduledSettings?.length ?? 0, results })
}
