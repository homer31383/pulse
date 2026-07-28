import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'
const env = Object.fromEntries(
  readFileSync('D:/AI/Claude/Pulse/.env.local', 'utf8').split('\n').filter((l) => l.includes('='))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()])
)
const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)

console.log('now:', new Date().toISOString())

const twoHoursAgo = new Date(Date.now() - 2 * 3600 * 1000).toISOString()
const { data: usage } = await supabase.from('usage_logs')
  .select('*').gte('created_at', twoHoursAgo).order('created_at')
console.log('\n=== usage_logs last 2h ===')
for (const l of usage ?? []) {
  console.log(` ${l.created_at}  ${l.call_type}  ${String(l.channel_name ?? '—').padEnd(20)} in=${l.input_tokens} out=${l.output_tokens} cacheW=${l.cache_creation_tokens} cacheR=${l.cache_read_tokens} searches=${l.web_search_count} $${Number(l.cost_usd).toFixed(3)}`)
}

const { data: chans } = await supabase.from('channels').select('id, name')
const nameOf = new Map((chans ?? []).map((c) => [c.id, c.name]))
const { data: briefs } = await supabase.from('briefings')
  .select('id, channel_id, content, sources, created_at')
  .gte('created_at', twoHoursAgo).order('created_at')
console.log('\n=== briefings last 2h ===')
for (const b of briefs ?? []) {
  const name = nameOf.get(b.channel_id)
  console.log(`\n${b.created_at}  ${name}  content=${b.content.length} chars  sources=${(b.sources ?? []).length}`)
  if (b.content.length < 600) console.log('  content:', JSON.stringify(b.content))
  if (name === 'Cephalopod Corner') {
    console.log('  first 10 source domains:', (b.sources ?? []).slice(0, 10).map((s) => { try { return new URL(s.url).hostname } catch { return s.url } }).join(', '))
  }
}

// Previous Cephalopod runs for source-quality comparison
const cephId = [...nameOf.entries()].find(([, n]) => n === 'Cephalopod Corner')?.[0]
if (cephId) {
  const { data: prior } = await supabase.from('briefings')
    .select('created_at, sources, content')
    .eq('channel_id', cephId)
    .lt('created_at', twoHoursAgo)
    .order('created_at', { ascending: false })
    .limit(2)
  console.log('\n=== prior Cephalopod runs — source domains ===')
  for (const b of prior ?? []) {
    console.log(`${b.created_at}  (${b.content.length} chars):`, (b.sources ?? []).slice(0, 10).map((s) => { try { return new URL(s.url).hostname } catch { return s.url } }).join(', '))
  }
}
