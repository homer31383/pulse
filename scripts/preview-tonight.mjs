// Preview which channels tonight's cron will generate, using the same
// per-channel anchor + interval logic as /api/cron/scheduled-briefings.
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'
const env = Object.fromEntries(
  readFileSync('D:/AI/Claude/Pulse/.env.local', 'utf8').split('\n').filter((l) => l.includes('='))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()])
)
const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)

const TZ = 'America/New_York'
const key = (d) => new Date(d).toLocaleDateString('en-CA', { timeZone: TZ })
const dayDiff = (from, to) =>
  Math.round((new Date(`${key(to)}T00:00:00Z`) - new Date(`${key(from)}T00:00:00Z`)) / 86_400_000)

const { data: settingsRows } = await supabase.from('settings').select('*').eq('schedule_enabled', true)
for (const settings of settingsRows ?? []) {
  const profileId = settings.id
  const { data: channelData } = await supabase.from('channels').select('*').eq('profile_id', profileId).order('position')
  let channels = channelData ?? []
  const sel = settings.schedule_channel_ids ?? []
  if (sel.length > 0) channels = channels.filter((c) => sel.includes(c.id))

  const profileInterval = settings.schedule_interval_days ?? 1
  const profileOutput = (settings.schedule_output ?? 'briefings') === 'briefings' ? 'briefing' : settings.schedule_output

  const lookback = new Date(Date.now() - 45 * 24 * 3600 * 1000).toISOString()
  const [ba, da] = await Promise.all([
    supabase.from('briefings').select('channel_id, created_at').in('channel_id', channels.map((c) => c.id))
      .eq('scheduled', true).gte('created_at', lookback).order('created_at', { ascending: false }),
    supabase.from('digests').select('channel_ids, created_at').eq('profile_id', profileId)
      .eq('scheduled', true).gte('created_at', lookback).order('created_at', { ascending: false }),
  ])
  const lastBriefing = new Map()
  for (const r of ba.data ?? []) if (!lastBriefing.has(r.channel_id)) lastBriefing.set(r.channel_id, r.created_at)
  const lastDigest = new Map()
  for (const r of da.data ?? []) for (const cid of r.channel_ids ?? []) if (!lastDigest.has(cid)) lastDigest.set(cid, r.created_at)

  // Tonight's run = next 05:00 UTC (1 AM ET)
  const tonight = new Date()
  tonight.setUTCHours(5, 0, 0, 0)
  if (tonight < new Date()) tonight.setUTCDate(tonight.getUTCDate() + 1)

  const isDue = (anchor, interval) => {
    if (!anchor) return { due: true, why: 'no anchor — first scheduled run' }
    const d = dayDiff(anchor, tonight)
    if (d === 0) return { due: true, why: 'run day (dedupe decides)' }
    if (d < interval) return { due: false, why: `${d}/${interval} days since ${key(anchor)}` }
    return { due: true, why: `${d}d since ${key(anchor)} >= ${interval}` }
  }

  console.log(`Tonight = ET day ${key(tonight)} · profile ...${profileId.slice(-4)} · ${channels.length} channels\n`)
  for (const c of channels) {
    const out = c.schedule_output ?? profileOutput
    const interval = c.schedule_interval_days ?? profileInterval
    const parts = []
    if (out === 'briefing' || out === 'both') {
      const r = isDue(lastBriefing.get(c.id), interval)
      parts.push(`briefing: ${r.due ? 'RUNS' : 'skips'} (${r.why})`)
    }
    if (out === 'digest' || out === 'both') {
      const r = isDue(lastDigest.get(c.id), interval)
      parts.push(`digest: ${r.due ? 'IN DIGEST' : 'skips'} (${r.why})`)
    }
    console.log(`${c.name.padEnd(42)} [${out}, every ${interval}d]  ${parts.join(' · ')}`)
  }
}
