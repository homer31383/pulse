import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'
const env = Object.fromEntries(
  readFileSync('D:/AI/Claude/Pulse/.env.local', 'utf8').split('\n').filter((l) => l.includes('='))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()])
)
const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)

const { data: b } = await supabase.from('briefings')
  .select('id, channel_id, model, created_at, content')
  .order('created_at', { ascending: false }).limit(3)
console.log('latest briefings:')
for (const r of b ?? []) console.log(` ${r.created_at}  ${r.model}  content=${r.content.length} chars  ch=${r.channel_id.slice(0, 8)}`)

const { data: u } = await supabase.from('usage_logs')
  .select('*').order('created_at', { ascending: false }).limit(3)
console.log('latest usage_logs:')
for (const l of u ?? []) console.log(` ${l.created_at}  ${l.call_type}  ${l.channel_name ?? '—'}  in=${l.input_tokens} out=${l.output_tokens} cacheW=${l.cache_creation_tokens} cacheR=${l.cache_read_tokens} searches=${l.web_search_count} $${Number(l.cost_usd).toFixed(3)}`)
