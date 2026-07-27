import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'

const env = Object.fromEntries(
  readFileSync('D:/AI/Claude/Pulse/.env.local', 'utf8')
    .split('\n')
    .filter((l) => l.includes('='))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()])
)
const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)

const { data: chans } = await supabase.from('channels').select('id, name')
const nameOf = new Map((chans ?? []).map((c) => [c.id, c.name]))

const today = new Date().toISOString().slice(0, 10)
for (const [label, from, to] of [
  ['7/25 run (opus-4-6)', '2026-07-25T04:00:00Z', '2026-07-25T06:00:00Z'],
  ['7/26 run (sonnet-5)', '2026-07-26T04:00:00Z', '2026-07-26T06:00:00Z'],
  [`${today} run (latest)`, `${today}T04:00:00Z`, `${today}T06:00:00Z`],
]) {
  const { data } = await supabase
    .from('briefings')
    .select('channel_id, sources, content, created_at')
    .eq('scheduled', true)
    .gte('created_at', from)
    .lte('created_at', to)
    .order('created_at', { ascending: true })
  console.log(`\n=== ${label} — sources per briefing ===`)
  let totalSources = 0
  for (const b of data ?? []) {
    const n = Array.isArray(b.sources) ? b.sources.length : 0
    totalSources += n
    console.log(`${String(n).padStart(3)} sources  content=${String(b.content.length).padStart(6)} chars  ${nameOf.get(b.channel_id)}`)
  }
  console.log(`Total sources: ${totalSources}`)
}
