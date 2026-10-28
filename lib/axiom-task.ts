// Server-only: tells Axiom (the household task app) that a scheduled cron run
// left new briefings/digests in the listen queue. One request per run, never
// per channel. Contract: Axiom's POST /api/inbound/pulse-task (zod strictObject:
// dedupeKey 1-200, title 1-300, notes ≤4000, url https ≤2048, dueDate
// YYYY-MM-DD; any extra field → 400). 201 = created, 200 = existing dedupeKey.
//
// Best effort: a failure or timeout is caught and logged in one line (never
// the secret) and never fails the cron run; it adds at most the timeout.
import { createHash } from 'node:crypto'

const TIME_ZONE = 'America/New_York'
const LISTEN_URL = 'https://mypulse-sepia.vercel.app/listen'
const TIMEOUT_MS = 5_000
const TITLE_MAX = 300
const DEDUPE_PREFIX = 'pulse-cron'

export interface SavedRunItem {
  kind: 'briefing' | 'digest'
  id: string
  channelNames: string[]   // a briefing's channel; a digest's channels
}

export interface PulseTaskPayload {
  dedupeKey: string
  title: string
  notes: string
  url: string
  dueDate: string
}

export function etDate(now: Date = new Date()): string {
  // en-CA formats as YYYY-MM-DD
  return new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE }).format(now)
}

// "A", "A and B", "A, B and C", "A, B and 4 more"
export function joinNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? ''
  if (names.length <= 3) return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
  return `${names.slice(0, 2).join(', ')} and ${names.length - 2} more`
}

function plural(n: number, word: string) {
  return `${n} ${word}${n === 1 ? '' : 's'}`
}

// Null when nothing was saved (the run sends nothing). `keyPrefix` exists for
// tests (Axiom's convention is a `test-` dedupeKey for throwaway rows).
export function buildPulseTaskPayload(items: SavedRunItem[], now: Date = new Date(), keyPrefix = ''): PulseTaskPayload | null {
  if (items.length === 0) return null

  // Channel names in run order, each once (a channel can have a briefing and
  // be part of the digest)
  const names: string[] = []
  for (const item of items) for (const n of item.channelNames) {
    const name = n.trim()
    if (name && !names.includes(name)) names.push(name)
  }

  const prefix = 'Pulse: '
  const suffix = ' ready to read'
  let joined = joinNames(names) || 'new content'
  const room = TITLE_MAX - prefix.length - suffix.length
  if (joined.length > room) joined = `${joined.slice(0, room - 1).trimEnd()}…`

  const briefings = items.filter((i) => i.kind === 'briefing').length
  const digests = items.length - briefings
  const day = etDate(now)
  const idHash = createHash('sha256').update([...items.map((i) => `${i.kind}:${i.id}`)].sort().join('\n')).digest('hex').slice(0, 24)

  return {
    dedupeKey: `${keyPrefix}${DEDUPE_PREFIX}:${day}:${idHash}`,
    title: `${prefix}${joined}${suffix}`,
    notes: `${plural(items.length, 'new item')} in the listen queue.\n${plural(briefings, 'briefing')}, ${plural(digests, 'digest')}`,
    url: LISTEN_URL,
    dueDate: day,
  }
}

// A run's saved items: fulfilled generations that persisted a row (an id).
// Failed generations, and ones that returned without saving, are left out.
export function savedItemsFromRun(
  tasks: Array<{ kind: SavedRunItem['kind']; channelNames: string[] }>,
  settled: Array<PromiseSettledResult<{ id?: string }>>,
): SavedRunItem[] {
  const saved: SavedRunItem[] = []
  settled.forEach((res, i) => {
    if (res.status === 'fulfilled' && res.value?.id) saved.push({ kind: tasks[i].kind, id: res.value.id, channelNames: tasks[i].channelNames })
  })
  // Edition order for the title: digest first, then briefings (the cron builds
  // its work list in channel-position order)
  return [...saved.filter((i) => i.kind === 'digest'), ...saved.filter((i) => i.kind === 'briefing')]
}

// What a scheduled run sends: null when the profile turned it off (settings
// axiom_task_enabled, migration 035; missing = on) or nothing was saved.
export function runTaskPayload(settings: { axiom_task_enabled?: boolean | null }, saved: SavedRunItem[], now: Date = new Date(), keyPrefix = ''): PulseTaskPayload | null {
  if (settings.axiom_task_enabled === false) return null
  return buildPulseTaskPayload(saved, now, keyPrefix)
}

export type AxiomTaskOutcome = 'created' | 'existing' | 'skipped' | 'failed'

// One request, no retries. Resolves (never throws) within ~timeoutMs, which is
// capped at TIMEOUT_MS; the cron passes less when its time budget is nearly
// spent, and under a second left skips the request rather than start one the
// platform would kill mid-flight.
export async function sendAxiomTask(payload: PulseTaskPayload | null, context: string, timeoutMs = TIMEOUT_MS): Promise<AxiomTaskOutcome> {
  if (!payload) return 'skipped'
  const limitMs = Math.min(TIMEOUT_MS, timeoutMs)
  if (limitMs < 1_000) {
    console.warn(`[axiom-task] ${context}: no time left in the run — no task`)
    return 'skipped'
  }
  const url = process.env.AXIOM_INBOUND_URL
  const secret = process.env.PULSE_INBOUND_SECRET
  if (!url || !secret) {
    console.log(`[axiom-task] ${context}: AXIOM_INBOUND_URL or PULSE_INBOUND_SECRET not set — skipped`)
    return 'skipped'
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), limitMs)
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${secret}` },
      body: JSON.stringify(payload),
      signal: controller.signal,
    })
    if (res.status === 201 || res.status === 200) {
      const outcome = res.status === 201 ? 'created' : 'existing'
      console.log(`[axiom-task] ${context}: ${outcome} (${res.status})`)
      return outcome
    }
    console.warn(`[axiom-task] ${context}: Axiom answered ${res.status} — no task`)
    return 'failed'
  } catch (err) {
    const why = controller.signal.aborted ? `timed out after ${limitMs / 1000}s` : (err as Error).message
    console.warn(`[axiom-task] ${context}: request failed (${why}) — no task`)
    return 'failed'
  } finally {
    clearTimeout(timer)
  }
}
