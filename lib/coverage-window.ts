// Pure helpers for channel briefings (no database or API client), so they
// can be tested on their own: the per-channel search cap (migration 040)
// and the {{COVERAGE_WINDOW}} placeholder. Tests: lib/coverage-window.test.ts

export const DEFAULT_BRIEFING_SEARCHES = 6

// channels.max_searches (migration 040): null or missing = the default 6.
export function briefingSearchCap(value: number | null | undefined): number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 20 ? value : DEFAULT_BRIEFING_SEARCHES
}

export const COVERAGE_WINDOW_TOKEN = '{{COVERAGE_WINDOW}}'

const ET = 'America/New_York'

// Today's calendar date in Eastern time as y/m/d numbers.
function etDateParts(now: Date): { y: number; m: number; d: number } {
  const [y, m, d] = now.toLocaleDateString('en-CA', { timeZone: ET }).split('-').map(Number)
  return { y, m, d }
}

function formatDay(dt: Date, withYear: boolean): string {
  return dt.toLocaleDateString('en-US', { timeZone: 'UTC', month: 'long', day: 'numeric', ...(withYear ? { year: 'numeric' } : {}) })
}

// The {{COVERAGE_WINDOW}} placeholder: replaced with the window this run
// covers, the intervalDays Eastern calendar days ending today, so runs that
// many days apart tile without overlap. Instructions without the token are
// returned unchanged (every channel but the ones that opt in).
export function applyCoverageWindow(instructions: string, now: Date, intervalDays: number): string {
  if (!instructions.includes(COVERAGE_WINDOW_TOKEN)) return instructions
  const days = Math.max(1, Math.round(intervalDays))
  const { y, m, d } = etDateParts(now)
  const end = new Date(Date.UTC(y, m - 1, d))
  const start = new Date(Date.UTC(y, m - 1, d - (days - 1)))
  const sameYear = start.getUTCFullYear() === end.getUTCFullYear()
  const range = `${formatDay(start, !sameYear)} to ${formatDay(end, true)}`
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate()
  const monthName = end.toLocaleDateString('en-US', { timeZone: 'UTC', month: 'long' })
  const lines = [
    `Coverage window: ${range} (${days} ${days === 1 ? 'day' : 'days'}, Eastern time). Only cover work released, launched, awarded or reported in this window.`,
    'Never repeat a pick from the previous briefing.',
  ]
  if (d > daysInMonth - 7) {
    lines.push(`This run falls in the last week of ${monthName}: add one line to the closing note naming which picks look strongest for the month so far.`)
  }
  return instructions.split(COVERAGE_WINDOW_TOKEN).join(lines.join('\n'))
}
