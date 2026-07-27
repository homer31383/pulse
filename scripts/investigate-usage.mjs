import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'

const env = Object.fromEntries(
  readFileSync('D:/AI/Claude/Pulse/.env.local', 'utf8')
    .split('\n')
    .filter((l) => l.includes('='))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()])
)

const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)

// 1. Usage logs 7/23 → 7/27 (briefing + digest calls), to compare mornings
const { data: logs, error: e1 } = await supabase
  .from('usage_logs')
  .select('created_at, call_type, channel_name, model, input_tokens, output_tokens, cost_usd')
  .gte('created_at', '2026-07-23T00:00:00Z')
  .in('call_type', ['briefing', 'digest'])
  .order('created_at', { ascending: true })
if (e1) console.error('usage_logs error:', e1.message)

console.log('=== usage_logs (briefing/digest) since 7/23, grouped by UTC day+hour ===')
const byHour = new Map()
for (const l of logs ?? []) {
  const key = l.created_at.slice(0, 13)
  if (!byHour.has(key)) byHour.set(key, [])
  byHour.get(key).push(l)
}
for (const [hour, rows] of byHour) {
  const inp = rows.reduce((s, r) => s + r.input_tokens, 0)
  const out = rows.reduce((s, r) => s + r.output_tokens, 0)
  const cost = rows.reduce((s, r) => s + Number(r.cost_usd), 0)
  console.log(`${hour}:00  calls=${rows.length}  in=${inp.toLocaleString()}  out=${out.toLocaleString()}  cost=$${cost.toFixed(2)}`)
}

console.log('\n=== Per-call detail, last 24h (incl. cache/search columns if migrated) ===')
const dayAgo = new Date(Date.now() - 24 * 3600 * 1000).toISOString()
const { data: recent } = await supabase
  .from('usage_logs')
  .select('*')
  .gte('created_at', dayAgo)
  .in('call_type', ['briefing', 'digest'])
  .order('created_at', { ascending: true })
for (const l of recent ?? []) {
  const extra = 'cache_creation_tokens' in l
    ? ` cacheW=${String(l.cache_creation_tokens ?? 0).padStart(8)} cacheR=${String(l.cache_read_tokens ?? 0).padStart(8)} searches=${l.web_search_count ?? 0}`
    : ''
  console.log(
    `${l.created_at}  ${l.call_type.padEnd(8)} ${String(l.channel_name ?? '—').padEnd(30)} ${l.model.padEnd(18)} in=${String(l.input_tokens).padStart(8)} out=${String(l.output_tokens).padStart(6)}${extra} $${Number(l.cost_usd).toFixed(3)}`
  )
}

console.log('\n=== Per-call detail for 7/25 morning (baseline, pre-upgrade run) ===')
for (const l of (logs ?? []).filter((l) => l.created_at >= '2026-07-25T04:00:00Z' && l.created_at < '2026-07-25T12:00:00Z')) {
  console.log(
    `${l.created_at}  ${l.call_type.padEnd(8)} ${String(l.channel_name ?? '—').padEnd(30)} ${l.model.padEnd(18)} in=${String(l.input_tokens).padStart(8)} out=${String(l.output_tokens).padStart(6)} $${Number(l.cost_usd).toFixed(3)}`
  )
}

// 2. Scheduled briefings/digests around 7/26 — duplicates per channel?
const { data: briefs, error: e2 } = await supabase
  .from('briefings')
  .select('id, channel_id, model, scheduled, created_at')
  .gte('created_at', '2026-07-25T12:00:00Z')
  .lte('created_at', '2026-07-26T12:00:00Z')
  .order('created_at', { ascending: true })
if (e2) console.error('briefings error:', e2.message)

const { data: chans } = await supabase.from('channels').select('id, name')
const nameOf = new Map((chans ?? []).map((c) => [c.id, c.name]))

console.log('\n=== briefings rows 7/25 12:00Z → 7/26 12:00Z ===')
for (const b of briefs ?? []) {
  console.log(`${b.created_at}  scheduled=${String(b.scheduled).padEnd(5)}  ${b.model.padEnd(18)}  ${nameOf.get(b.channel_id) ?? b.channel_id}`)
}

const counts = new Map()
for (const b of (briefs ?? []).filter((b) => b.scheduled)) {
  const n = nameOf.get(b.channel_id) ?? b.channel_id
  counts.set(n, (counts.get(n) ?? 0) + 1)
}
console.log('\n=== scheduled-briefing count per channel in that window ===')
for (const [n, c] of counts) console.log(`${String(c).padStart(2)}x  ${n}`)

const { data: digs } = await supabase
  .from('digests')
  .select('id, scheduled, model, created_at, profile_id')
  .gte('created_at', '2026-07-25T12:00:00Z')
  .lte('created_at', '2026-07-26T12:00:00Z')
console.log('\n=== digests in window ===')
for (const d of digs ?? []) console.log(`${d.created_at}  scheduled=${d.scheduled}  ${d.model}  profile=${d.profile_id.slice(-4)}`)
