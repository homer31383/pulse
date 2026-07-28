import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'
const env = Object.fromEntries(
  readFileSync('D:/AI/Claude/Pulse/.env.local', 'utf8').split('\n').filter((l) => l.includes('='))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()])
)
const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)

const { data: briefs } = await supabase.from('briefings')
  .select('content, created_at, channel_id')
  .eq('scheduled', true)
  .gte('created_at', '2026-07-28T04:00:00Z')
  .order('created_at')
console.log('=== scheduled briefings 7/28 — full content ===')
for (const b of briefs ?? []) {
  console.log(`\n--- ${b.created_at} (${b.content.length} chars) ---`)
  console.log(JSON.stringify(b.content))
}

const { data: digs } = await supabase.from('digests')
  .select('content, channel_names, created_at')
  .eq('scheduled', true)
  .gte('created_at', '2026-07-28T04:00:00Z')
console.log('\n=== scheduled digest 7/28 ===')
for (const d of digs ?? []) {
  console.log(`${d.created_at}  ${d.content.length} chars  channels=[${(d.channel_names ?? []).join(', ')}]`)
  console.log('first 400 chars:', d.content.slice(0, 400))
}
