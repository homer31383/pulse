// {{COVERAGE_WINDOW}} (Ads Worth Watching): the window is the channel's
// interval in Eastern calendar days ending today. Run:
// npx tsx --test lib/coverage-window.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { applyCoverageWindow, briefingSearchCap } from './coverage-window'

const T = 'Intro.\n{{COVERAGE_WINDOW}}\nOutro.'
const at = (iso: string, days = 14) => applyCoverageWindow(T, new Date(iso), days)

test('instructions without the token come back unchanged', () => {
  const s = 'No token here. {{OTHER}}'
  assert.equal(applyCoverageWindow(s, new Date('2026-11-25T12:00:00Z'), 14), s)
})

test('14 days ending today, last week of November adds the month line', () => {
  const out = at('2026-11-25T17:00:00Z')
  assert.match(out, /Coverage window: November 12 to November 25, 2026 \(14 days, Eastern time\)/)
  assert.match(out, /Never repeat a pick from the previous briefing\./)
  assert.match(out, /last week of November: add one line to the closing note/)
  assert.ok(out.startsWith('Intro.\n') && out.endsWith('\nOutro.'))
})

test('next run tiles with no overlap and no month line mid-month', () => {
  const out = at('2026-12-09T06:30:00Z')
  assert.match(out, /Coverage window: November 26 to December 9, 2026/)
  assert.doesNotMatch(out, /last week/)
})

test('a window across the new year names both years', () => {
  assert.match(at('2027-01-05T06:30:00Z'), /Coverage window: December 23, 2026 to January 5, 2027/)
})

test('Eastern time decides the day: 23:30 ET on Nov 30 is still Nov 30', () => {
  const out = at('2026-12-01T04:30:00Z')
  assert.match(out, /November 17 to November 30, 2026/)
  assert.match(out, /last week of November/)
})

test('last-week line starts 7 days before month end (Feb 2027 has 28 days)', () => {
  assert.doesNotMatch(at('2027-02-21T17:00:00Z'), /last week/)
  assert.match(at('2027-02-22T17:00:00Z'), /last week of February/)
})

test('search cap: null or out of range means the default 6', () => {
  assert.equal(briefingSearchCap(null), 6)
  assert.equal(briefingSearchCap(undefined), 6)
  assert.equal(briefingSearchCap(10), 10)
  assert.equal(briefingSearchCap(0), 6)
  assert.equal(briefingSearchCap(25), 6)
})
