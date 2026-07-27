import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'

const env = Object.fromEntries(
  readFileSync('D:/AI/Claude/Pulse/.env.local', 'utf8')
    .split('\n')
    .filter((l) => l.includes('='))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()])
)
const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)

const { data: settings } = await supabase
  .from('settings')
  .select('id, schedule_enabled, schedule_time, schedule_output, schedule_channel_ids')
  .eq('schedule_enabled', true)

for (const s of settings ?? []) {
  console.log(`profile ...${s.id.slice(-4)}: schedule_time=${s.schedule_time} output=${s.schedule_output} channels=${(s.schedule_channel_ids ?? []).length || 'all'}`)

  const { data: chans } = await supabase.from('channels').select('id').eq('profile_id', s.id)
  const ids = (chans ?? []).map((c) => c.id)

  const [b, d] = await Promise.all([
    supabase.from('briefings').select('created_at').in('channel_id', ids).eq('scheduled', true)
      .order('created_at', { ascending: false }).limit(1),
    supabase.from('digests').select('created_at').eq('profile_id', s.id).eq('scheduled', true)
      .order('created_at', { ascending: false }).limit(1),
  ])
  const lastBriefing = b.data?.[0]?.created_at ?? null
  const lastDigest = d.data?.[0]?.created_at ?? null
  const anchor = [lastBriefing, lastDigest].filter(Boolean).sort().pop() ?? null
  console.log(`  newest scheduled briefing: ${lastBriefing}`)
  console.log(`  newest scheduled digest:   ${lastDigest}`)
  console.log(`  anchor (max of both):      ${anchor}`)

  if (anchor) {
    const key = (dt) => new Date(dt).toLocaleDateString('en-CA', { timeZone: 'America/New_York' })
    const anchorDay = key(anchor)
    const dayMs = 86_400_000
    const a = new Date(`${anchorDay}T00:00:00Z`).getTime()
    for (const probe of ['2026-07-28T05:00:00Z', '2026-07-29T05:00:00Z', '2026-08-01T05:00:00Z', '2026-08-02T05:00:00Z']) {
      const daysSince = Math.round((new Date(`${key(probe)}T00:00:00Z`).getTime() - a) / dayMs)
      const fires = !(daysSince > 0 && daysSince < 7)
      console.log(`  cron at ${probe} (ET day ${key(probe)}): daysSince=${daysSince} vs interval 7 -> ${fires ? 'FIRES' : 'skips'}`)
    }
  }
}
