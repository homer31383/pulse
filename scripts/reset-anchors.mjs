// Reset schedule anchors: flip scheduled=false on all past scheduled
// briefings/digests for the profile so every channel counts as a first
// run tonight. Content stays in the archive untouched.
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'
const env = Object.fromEntries(
  readFileSync('D:/AI/Claude/Pulse/.env.local', 'utf8').split('\n').filter((l) => l.includes('='))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()])
)
const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)

const PROFILE = '00000000-0000-0000-0000-000000000001'
const { data: chans } = await supabase.from('channels').select('id, name').eq('profile_id', PROFILE)
const ids = (chans ?? []).map((c) => c.id)

const { data: briefs, error: e1 } = await supabase
  .from('briefings')
  .update({ scheduled: false })
  .in('channel_id', ids)
  .eq('scheduled', true)
  .select('id, channel_id, created_at')
if (e1) { console.error(e1.message); process.exit(1) }
console.log(`Un-flagged ${briefs?.length ?? 0} scheduled briefings:`)
const nameOf = new Map((chans ?? []).map((c) => [c.id, c.name]))
for (const b of briefs ?? []) console.log(`  ${b.created_at}  ${nameOf.get(b.channel_id)}`)

const { data: digs, error: e2 } = await supabase
  .from('digests')
  .update({ scheduled: false })
  .eq('profile_id', PROFILE)
  .eq('scheduled', true)
  .select('id, created_at')
if (e2) { console.error(e2.message); process.exit(1) }
console.log(`Un-flagged ${digs?.length ?? 0} scheduled digests:`)
for (const d of digs ?? []) console.log(`  ${d.created_at}`)
