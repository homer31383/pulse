import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'
const env = Object.fromEntries(
  readFileSync('D:/AI/Claude/Pulse/.env.local', 'utf8').split('\n').filter((l) => l.includes('='))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()])
)
const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)

const since = new Date(Date.now() - 14 * 24 * 3600 * 1000).toISOString()
const { data: usage } = await supabase.from('usage_logs')
  .select('call_type, channel_id, channel_name, cost_usd, cache_creation_tokens, cache_read_tokens, web_search_count, created_at')
  .in('call_type', ['briefing', 'digest']).gte('created_at', since).order('created_at')
const inst = (usage ?? []).filter(r => (r.web_search_count ?? 0) > 0 || (r.cache_creation_tokens ?? 0) > 0 || (r.cache_read_tokens ?? 0) > 0)
console.log('instrumented rows:')
for (const r of inst) console.log(` ${r.created_at}  ${r.call_type}  ${r.channel_name ?? '—'}  $${Number(r.cost_usd).toFixed(3)}`)

const { data: digs } = await supabase.from('digests')
  .select('created_at, channel_ids, channel_names').gte('created_at', since).order('created_at')
console.log('\ndigest rows (channel counts):')
for (const d of digs ?? []) console.log(` ${d.created_at}  channels=${(d.channel_ids ?? []).length}  [${(d.channel_names ?? []).join(', ')}]`)

const b = inst.filter(r => r.call_type === 'briefing').map(r => Number(r.cost_usd))
const dg = inst.filter(r => r.call_type === 'digest').map(r => Number(r.cost_usd))
const mean = a => a.reduce((x, y) => x + y, 0) / a.length
console.log(`\nbriefing mean: $${mean(b).toFixed(3)} (n=${b.length})`)
console.log(`digest mean: $${mean(dg).toFixed(3)} (n=${dg.length})`)
