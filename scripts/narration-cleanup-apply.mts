// Removes the model's pre-heading research narration from stored briefings
// and digests, from a backup written by narration-cleanup-dryrun.mts. Only
// the content column of the rows in that backup changes; read_at, the listen
// queue, usage logs, the audio cache and every other column and table are
// never touched.
//
//   npx tsx scripts/narration-cleanup-apply.mts                 plan only, writes nothing
//   npx tsx scripts/narration-cleanup-apply.mts --confirm       clean the rows
//   npx tsx scripts/narration-cleanup-apply.mts --restore       plan a restore, writes nothing
//   npx tsx scripts/narration-cleanup-apply.mts --restore --confirm
//   --backup <path> picks another backup file
//
// Apply: for each backed-up row not in the skip list, the cleaned content is
// stripPreHeadingNarration(backup content). A row is written only when its
// current content still equals the backup's; a row edited since the backup is
// skipped and reported, as is one already clean or deleted.
// Restore: writes the backup's original content back, only where the current
// content equals the cleaned version (so a row changed after the cleanup is
// left alone). The cleaned version is recomputed with today's stripper, so
// restore before changing stripPreHeadingNarration again.
//
// Rows go in batches of 10: each batch re-reads its rows' current content
// right before writing.
import { readFileSync } from 'node:fs'
import { serviceClient } from './_supabase.mjs'
import { stripPreHeadingNarration } from '../lib/press-sections'
import { NARRATION_SKIP } from './narration-cleanup-skip.mts'

const DEFAULT_BACKUP = 'D:/AI/Claude/Pulse-backups/narration-2026-10-29T02-51-51-637Z.json'
const BATCH = 10

const args = process.argv.slice(2)
const confirm = args.includes('--confirm')
const restore = args.includes('--restore')
const backupAt = args.indexOf('--backup')
const backupPath = backupAt >= 0 ? args[backupAt + 1] : DEFAULT_BACKUP
const unknown = args.filter((a, i) => !['--confirm', '--restore', '--backup'].includes(a) && !(backupAt >= 0 && i === backupAt + 1))
if (unknown.length || !backupPath) {
  console.error(`Unknown arguments: ${unknown.join(' ') || '(missing --backup path)'}`)
  process.exit(1)
}

const env = Object.fromEntries(
  readFileSync('.env.local', 'utf8')
    .split(/\r?\n/)
    .map((l) => /^([A-Z0-9_]+)=(.*)$/.exec(l.trim()))
    .filter((m): m is RegExpExecArray => m !== null)
    .map((m) => [m[1], m[2].replace(/^["']|["']$/g, '')]),
)
const project = new URL(env.NEXT_PUBLIC_SUPABASE_URL).host.split('.')[0]
const sb = serviceClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)

type Table = 'briefings' | 'digests'
interface BackupRow { id: string; content: string; created_at: string }
const backup = JSON.parse(readFileSync(backupPath, 'utf8')) as { project: string; briefings: BackupRow[]; digests: BackupRow[] }
if (backup.project !== project) {
  console.error(`Backup is for project ${backup.project}, .env.local points at ${project}; stopping`)
  process.exit(1)
}
const rows = [
  ...backup.briefings.map((r) => ({ table: 'briefings' as Table, r })),
  ...backup.digests.map((r) => ({ table: 'digests' as Table, r })),
]
if (new Set(rows.map((x) => x.r.id)).size !== rows.length) {
  console.error('Backup has duplicate ids; stopping')
  process.exit(1)
}

type Outcome = 'write' | 'skip-list' | 'edited' | 'already' | 'missing' | 'not-affected' | 'failed'
const counts = new Map<Outcome, string[]>()
const tally = (o: Outcome, id: string) => counts.set(o, [...(counts.get(o) ?? []), id])

console.log(`${restore ? 'RESTORE' : 'APPLY'}${confirm ? '' : ' (plan only, nothing is written; add --confirm to write)'}`)
console.log(`backup ${backupPath}: ${backup.briefings.length} briefings, ${backup.digests.length} digests, project ${project}\n`)

for (let i = 0; i < rows.length; i += BATCH) {
  const batch = rows.slice(i, i + BATCH)
  // Current content, re-read right before this batch is written
  const current = new Map<string, string>()
  for (const table of ['briefings', 'digests'] as const) {
    const ids = batch.filter((x) => x.table === table).map((x) => x.r.id)
    if (!ids.length) continue
    const { data, error } = await sb.from(table).select('id, content').in('id', ids)
    if (error) throw new Error(`${table}: ${error.message}`)
    for (const d of data ?? []) current.set(d.id, d.content)
  }

  const writes: { table: Table; id: string; content: string; label: string }[] = []
  for (const { table, r } of batch) {
    const label = `${table.slice(0, -1)} ${r.id} ${r.created_at.slice(0, 10)}`
    const skip = NARRATION_SKIP.get(r.id)
    if (skip) { tally('skip-list', r.id); console.log(`skip     ${label}: in the skip list (${skip})`); continue }
    const { content: cleaned, stripped } = stripPreHeadingNarration(r.content)
    if (!stripped) { tally('not-affected', r.id); console.log(`skip     ${label}: the stripper no longer removes anything`); continue }
    const now = current.get(r.id)
    if (now === undefined) { tally('missing', r.id); console.log(`skip     ${label}: row no longer exists`); continue }
    const [from, to] = restore ? [cleaned, r.content] : [r.content, cleaned]
    if (now === to) { tally('already', r.id); console.log(`skip     ${label}: already ${restore ? 'restored' : 'clean'}`); continue }
    if (now !== from) {
      tally('edited', r.id)
      console.log(`skip     ${label}: current content matches neither the ${restore ? 'cleaned' : 'backed-up'} version (edited since); left alone`)
      continue
    }
    writes.push({ table, id: r.id, content: to, label: `${label}: ${now.length} -> ${to.length} chars` })
  }

  if (!confirm) {
    for (const w of writes) { tally('write', w.id); console.log(`would    ${w.label}`) }
    continue
  }
  const results = await Promise.all(writes.map(async (w) => {
    // content only; nothing else on the row changes
    const { data, error } = await sb.from(w.table).update({ content: w.content }).eq('id', w.id).select('id')
    return { w, ok: !error && data?.length === 1, error: error?.message ?? (data?.length === 1 ? '' : 'no row updated') }
  }))
  for (const { w, ok, error } of results) {
    tally(ok ? 'write' : 'failed', w.id)
    console.log(`${ok ? 'changed ' : 'FAILED  '} ${w.label}${ok ? '' : ` (${error})`}`)
  }
}

const n = (o: Outcome) => counts.get(o)?.length ?? 0
console.log(`\nSummary (${restore ? 'restore' : 'apply'}${confirm ? '' : ', plan only'}):`)
console.log(`  ${confirm ? 'written' : 'would write'}: ${n('write')}`)
console.log(`  skipped, in the skip list: ${n('skip-list')}`)
console.log(`  skipped, edited since: ${n('edited')}${n('edited') ? `  ${counts.get('edited')!.join(', ')}` : ''}`)
console.log(`  skipped, already ${restore ? 'restored' : 'clean'}: ${n('already')}`)
console.log(`  skipped, row deleted: ${n('missing')}`)
console.log(`  skipped, nothing to remove now: ${n('not-affected')}`)
if (n('failed')) console.log(`  FAILED: ${n('failed')}  ${counts.get('failed')!.join(', ')}`)
if (!confirm) console.log('\nNothing was written. Re-run with --confirm to write.')
process.exit(n('failed') ? 1 : 0)
