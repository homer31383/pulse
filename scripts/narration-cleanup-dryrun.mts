// DRY RUN, read-only against the database: the stored briefings and digests
// that still open with the model's pre-heading research narration ("I have
// great material now. Let me write the briefing."), found with the same
// stripPreHeadingNarration() the generator and the PDF export use.
//
// 1. Backs up every affected row, in full, to a JSON file outside the repo
//    (D:\AI\Claude\Pulse-backups\narration-<timestamp>.json), then reads the
//    file back and checks every id and content survived before going on.
// 2. Prints before and after for 5 of the affected rows (4 briefings from
//    different channels, preferring one with a heading glued to the
//    narration, and 1 digest).
//
// With --report, steps 1 and 2 are skipped (no backup file is written, so an
// earlier backup stays the only one) and it prints instead: one sample's
// full removed text and the start of what follows it, one line per affected
// row sorted by removed length, and the full removed text of every row that
// looks like it caught real content (over 400 chars, or a list or table line).
//
// It never writes to Supabase: the only calls are selects. There is no
// apply mode; the cleanup itself is a separate step.
//
// Run from the repo root: npx tsx scripts/narration-cleanup-dryrun.mts [--report]
import { mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs'
import { join } from 'node:path'
import { serviceClient } from './_supabase.mjs'
import { stripPreHeadingNarration } from '../lib/press-sections'
// Rows the cleanup leaves alone (with why): still backed up, marked in the
// report, never sampled as "after"
import { NARRATION_SKIP } from './narration-cleanup-skip.mts'

const BACKUP_DIR = 'D:/AI/Claude/Pulse-backups'
const SAMPLE_BRIEFINGS = 4
const SAMPLE_DIGESTS = 1
const PREVIEW_CHARS = 240

const env = Object.fromEntries(
  readFileSync('.env.local', 'utf8')
    .split(/\r?\n/)
    .map((l) => /^([A-Z0-9_]+)=(.*)$/.exec(l.trim()))
    .filter((m): m is RegExpExecArray => m !== null)
    .map((m) => [m[1], m[2].replace(/^["']|["']$/g, '')]),
)
const sb = serviceClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)

type Row = Record<string, unknown> & { id: string; content: string; created_at: string }

// Every row of a table, in pages (PostgREST caps a response at 1,000)
async function allRows(table: 'briefings' | 'digests', select: string): Promise<Row[]> {
  const out: Row[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb.from(table).select(select).order('created_at').order('id').range(from, from + 999)
    if (error) throw new Error(`${table}: ${error.message}`)
    out.push(...((data ?? []) as unknown as Row[]))
    if (!data || data.length < 1000) return out
  }
}

const briefings = await allRows('briefings', '*, channels(name, profile_id)')
const digests = await allRows('digests', '*')

function affected(rows: Row[]) {
  return rows
    .map((row) => ({ row, result: stripPreHeadingNarration(row.content) }))
    .filter((x) => x.result.stripped)
}
const hitB = affected(briefings)
const hitD = affected(digests)

const channelOf = (r: Row) => {
  const c = r.channels as { name: string; profile_id: string } | { name: string; profile_id: string }[] | null
  const one = Array.isArray(c) ? c[0] : c
  return one ? `${one.name}${one.profile_id.endsWith('2') ? ' (Krista)' : ''}` : '(no channel)'
}

if (process.argv.includes('--report')) {
  report()
  process.exit(0)
}

// 1. Backup: the full rows as stored (the joined channel name is kept for
// reading the file; it is not a column of briefings)
mkdirSync(BACKUP_DIR, { recursive: true })
const stamp = new Date().toISOString().replace(/[:.]/g, '-')
const file = join(BACKUP_DIR, `narration-${stamp}.json`)
const backup = {
  created_at: new Date().toISOString(),
  project: new URL(env.NEXT_PUBLIC_SUPABASE_URL).host.split('.')[0],
  note: 'Full rows of briefings and digests whose content starts with pre-heading narration, taken before any cleanup. Restore a row by writing its content back.',
  briefings: hitB.map((x) => x.row),
  digests: hitD.map((x) => x.row),
}
writeFileSync(`${file}.tmp`, JSON.stringify(backup, null, 2))
renameSync(`${file}.tmp`, file)

const check = JSON.parse(readFileSync(file, 'utf8')) as typeof backup
const same = (a: Row[], b: Row[]) => a.length === b.length && a.every((r, i) => r.id === b[i].id && r.content === b[i].content)
if (!same(check.briefings, backup.briefings) || !same(check.digests, backup.digests)) {
  throw new Error(`Backup ${file} does not match what was read; stopping`)
}
console.log(`Backup written and verified: ${file}`)
console.log(`  ${hitB.length} of ${briefings.length} briefings, ${hitD.length} of ${digests.length} digests\n`)

// 2. Samples
// A heading on the same line as the narration ("...the briefing.# Title")
const glued = (x: (typeof hitB)[number]) => !/\n\s*$/.test(x.result.stripped)

const picked: { kind: string; label: string; x: (typeof hitB)[number] }[] = []
const seen = new Set<string>()
for (const x of [...hitB.filter(glued), ...hitB]) {
  if (NARRATION_SKIP.has(x.row.id)) continue
  const ch = channelOf(x.row)
  if (picked.length >= SAMPLE_BRIEFINGS) break
  if (seen.has(ch)) continue
  seen.add(ch)
  picked.push({ kind: 'briefing', label: ch, x })
}
for (const x of hitD.slice(0, SAMPLE_DIGESTS)) {
  const names = (x.row.channel_names as string[] | null) ?? []
  picked.push({ kind: 'digest', label: names.join(', ') || '(digest)', x })
}

const show = (s: string) => {
  const cut = s.length > PREVIEW_CHARS ? `${s.slice(0, PREVIEW_CHARS)}[...]` : s
  return cut.split('\n').map((l) => `    | ${l}`).join('\n')
}
picked.forEach(({ kind, label, x }, i) => {
  console.log(`=== ${i + 1}. ${kind} ${x.row.id} · ${label} · ${x.row.created_at.slice(0, 10)}${glued(x) ? ' · heading glued to narration' : ''}`)
  console.log(`  removed (${x.result.stripped.length} chars):`)
  console.log(show(x.result.stripped))
  console.log('  before:')
  console.log(show(x.row.content))
  console.log('  after:')
  console.log(show(x.result.content))
  console.log(`  length ${x.row.content.length} -> ${x.result.content.length}\n`)
})
console.log('Dry run only: nothing was written to the database.')

function report() {
  const REVIEW_SAMPLE = 'f908a10c-c00b-4d81-8b11-01af64e21b5d'
  const LONG = 400
  // A removed line that starts like a list item or table row
  const LISTY = /^[ \t]*(?:[-*|]|\d+\.)/m
  const all = [
    ...hitB.map((x) => ({ kind: 'briefing', label: channelOf(x.row), ...x })),
    ...hitD.map((x) => ({ kind: 'digest', label: ((x.row.channel_names as string[] | null) ?? []).join(', ') || '(digest)', ...x })),
  ]
  const block = (s: string) => s.split('\n').map((l) => `    | ${l}`).join('\n')

  // 1. Where the cut falls on the review sample
  const s = all.find((x) => x.row.id === REVIEW_SAMPLE)
  console.log(`=== Sample ${REVIEW_SAMPLE}`)
  if (!s) console.log('  not among the affected rows')
  else {
    console.log(`  ${s.kind} · ${s.label} · ${s.row.created_at.slice(0, 10)}`)
    console.log(`  full removed text (${s.result.stripped.length} chars):`)
    console.log(block(s.result.stripped))
    console.log('  last 40 removed chars, escaped: ' + JSON.stringify(s.result.stripped.slice(-40)))
    console.log('  first 150 chars of after:')
    console.log(block(s.result.content.slice(0, 150)))
    console.log('  first 40 after chars, escaped:  ' + JSON.stringify(s.result.content.slice(0, 40)))
    console.log(`  removed + after === stored content: ${s.result.stripped + s.result.content === s.row.content}`)
  }

  // 2. Every affected row, longest removal first
  const sorted = [...all].sort((a, b) => b.result.stripped.length - a.result.stripped.length || a.row.created_at.localeCompare(b.row.created_at))
  console.log(`\n=== All affected rows (${hitB.length} briefings, ${hitD.length} digests), removed length descending`)
  for (const x of sorted) {
    const skip = NARRATION_SKIP.get(x.row.id)
    console.log(`${String(x.result.stripped.length).padStart(5)}  ${x.kind.padEnd(8)}  ${x.row.id}  ${x.row.created_at.slice(0, 10)}  ${x.label}${skip ? `  [SKIP: ${skip}]` : ''}`)
  }
  console.log(`  in scope: ${all.filter((x) => !NARRATION_SKIP.has(x.row.id)).length}; skipped by id: ${all.filter((x) => NARRATION_SKIP.has(x.row.id)).length}`)

  // 3. Rows that may have caught a real paragraph, list or table
  const suspect = sorted.filter((x) => x.result.stripped.length > LONG || LISTY.test(x.result.stripped))
  console.log(`\n=== Rows to check: removed text over ${LONG} chars or with a list/table line (${suspect.length})`)
  for (const x of suspect) {
    const why = [x.result.stripped.length > LONG ? `${x.result.stripped.length} chars` : '', LISTY.test(x.result.stripped) ? 'list/table line' : ''].filter(Boolean).join(', ')
    console.log(`\n--- ${x.kind} ${x.row.id} · ${x.label} · ${x.row.created_at.slice(0, 10)} · ${why}`)
    console.log(block(x.result.stripped))
  }

  // 4. Totals
  const lengths = all.map((x) => x.result.stripped.length)
  const max = sorted[0]
  console.log(`\n=== Totals`)
  console.log(`  rows: ${all.length}; removed length under ${LONG}: ${lengths.filter((n) => n < LONG).length}; ${LONG} or more: ${lengths.filter((n) => n >= LONG).length}`)
  if (max) console.log(`  max: ${max.result.stripped.length} chars (${max.kind} ${max.row.id}, ${max.label}, ${max.row.created_at.slice(0, 10)})`)
  console.log('\nReport only: nothing was written to the database or to disk.')
}
