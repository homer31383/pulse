import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'
const env = Object.fromEntries(
  readFileSync('D:/AI/Claude/Pulse/.env.local', 'utf8').split('\n').filter((l) => l.includes('='))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()])
)
const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)

console.log('now:', new Date().toISOString())

const hourAgo = new Date(Date.now() - 90 * 60 * 1000).toISOString()
const { data: usage } = await supabase.from('usage_logs')
  .select('*').gte('created_at', hourAgo).order('created_at', { ascending: true })
console.log('\nusage_logs last 90 min (all call types):')
for (const l of usage ?? []) {
  console.log(` ${l.created_at}  ${l.call_type}  ${l.channel_name ?? '—'}  in=${l.input_tokens} out=${l.output_tokens} cacheW=${l.cache_creation_tokens} cacheR=${l.cache_read_tokens} searches=${l.web_search_count} $${Number(l.cost_usd).toFixed(3)}`)
}

const { data: stub } = await supabase.from('briefings')
  .select('content, sources, created_at')
  .eq('created_at', '2026-07-27T15:59:07.917217+00:00')
  .single()
if (stub) {
  console.log(`\n15:59 Cephalopod stub — ${stub.content.length} chars, ${(stub.sources ?? []).length} sources`)
  console.log('--- first 300 chars ---')
  console.log(stub.content.slice(0, 300))
  console.log('--- last 300 chars ---')
  console.log(stub.content.slice(-300))
}
