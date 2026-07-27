// Poll usage_logs until a briefing/digest row newer than start time appears,
// then print it with full cost columns and exit.
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'

const env = Object.fromEntries(
  readFileSync('D:/AI/Claude/Pulse/.env.local', 'utf8')
    .split('\n')
    .filter((l) => l.includes('='))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()])
)
const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)

const since = new Date(Date.now() - 10 * 60 * 1000).toISOString()
const deadline = Date.now() + 8 * 60 * 1000

while (Date.now() < deadline) {
  const { data, error } = await supabase
    .from('usage_logs')
    .select('*')
    .gte('created_at', since)
    .in('call_type', ['briefing', 'digest'])
    .order('created_at', { ascending: true })
  if (error) {
    console.error('query error:', error.message)
  } else if ((data ?? []).length > 0) {
    for (const l of data) {
      console.log(`${l.created_at}  ${l.call_type}  ${l.channel_name ?? '—'}  ${l.model}`)
      console.log(`  input=${l.input_tokens}  output=${l.output_tokens}`)
      console.log(`  cache_creation=${l.cache_creation_tokens ?? 'COLUMN MISSING'}  cache_read=${l.cache_read_tokens ?? 'COLUMN MISSING'}  searches=${l.web_search_count ?? 'COLUMN MISSING'}`)
      console.log(`  cost_usd=$${Number(l.cost_usd).toFixed(3)}`)
    }
    process.exit(0)
  }
  await new Promise((r) => setTimeout(r, 10_000))
}
console.log('Timed out after 8 minutes — no new briefing/digest usage row appeared.')
process.exit(1)
