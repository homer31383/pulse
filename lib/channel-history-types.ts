// Client-safe shapes and helpers for the channel history page.

export interface ChannelHistoryEntry {
  kind: 'briefing' | 'digest'
  id: string
  createdAt: string
  read: boolean
  headline: string
  excerpt: string
  coversChannels: number        // digests: length of channel_ids; briefings: 1
}

// Reading-view origin: /read/{kind}/{id}?from=channel:<uuid> makes the back
// arrow return to /channels/<uuid>/history.
export const CHANNEL_FROM_PREFIX = 'channel:'
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function channelFromParam(channelId: string): string {
  return `from=${CHANNEL_FROM_PREFIX}${channelId}`
}

export function channelIdFromParam(from: string | undefined): string | null {
  if (!from?.startsWith(CHANNEL_FROM_PREFIX)) return null
  const id = from.slice(CHANNEL_FROM_PREFIX.length)
  return UUID_RE.test(id) ? id : null
}

// The page's filter / search / "load more" state, saved when a row is opened
// and restored (with the scroll position) when the page mounts again, since
// both the reading view's back arrow (a push) and browser Back remount it.
export const HISTORY_SNAPSHOT_KEY = 'pulse-channel-history'
export const HISTORY_SNAPSHOT_TTL_MS = 60 * 60 * 1000

export function clearHistorySnapshot() {
  try { sessionStorage.removeItem(HISTORY_SNAPSHOT_KEY) } catch { /* storage unavailable */ }
}

// ── Full-text search (GET /api/channels/[id]/history-search) ────────────────

export const FULLTEXT_MIN_CHARS = 2
export const FULLTEXT_MAX_CHARS = 100
export const FULLTEXT_RESULT_CAP = 200

// Lower case, every run of non-letters/digits to one space. Digest story
// headings drift in punctuation and emoji ("E & RWA Outlook: Real-World ...").
export function strongNorm(s: string): string {
  return s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
}

// Whitespace runs collapse to one space, so "usd  pipeline" = "usd pipeline".
export function normalizeFullTextQuery(q: string): string {
  return q.replace(/\s+/g, ' ').trim()
}

// The refusal shown under the box, or null when the query can be sent.
export function fullTextQueryError(q: string): string | null {
  const n = normalizeFullTextQuery(q)
  if (n.length === 0) return 'Type a word to search for.'
  if (n.length < FULLTEXT_MIN_CHARS) return `Type at least ${FULLTEXT_MIN_CHARS} characters.`
  if (n.length > FULLTEXT_MAX_CHARS) return `Keep it under ${FULLTEXT_MAX_CHARS} characters.`
  return null
}

// The query as a literal pattern: every regex metacharacter is escaped, so
// "%", "_", "." or "(" match themselves. Case-insensitive. Whole word: no
// letter, digit or underscore directly before or after the match, so
// "retime" no longer finds "retimed" or "retiming".
export function buildSearchRegex(q: string, whole: boolean): RegExp {
  const esc = normalizeFullTextQuery(q).replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, '\\s+')
  const body = whole ? `(?<![\\p{L}\\p{N}_])${esc}(?![\\p{L}\\p{N}_])` : esc
  return new RegExp(body, 'giu')
}

export interface FullTextSnippet {
  before: string
  match: string
  after: string
  lead: boolean   // text was cut before `before` (show an ellipsis)
  trail: boolean  // text was cut after `after`
}

export interface FullTextHit {
  kind: 'briefing' | 'digest'
  id: string
  matches: number
  // briefing: the whole briefing. story: only this channel's story inside a
  // digest (or a digest that covers only this channel). whole: a digest
  // covering several channels whose story for this one could not be
  // isolated, so the whole digest was searched (the row says so).
  scope: 'briefing' | 'story' | 'whole'
  snippet: FullTextSnippet
}

export interface FullTextResponse {
  query: string
  whole: boolean
  total: number        // matching entries before the cap
  capped: boolean      // total > FULLTEXT_RESULT_CAP; hits holds the newest 200
  hits: FullTextHit[]  // newest first
  tookMs: number
}

// Reading-view link parameters: the query (and the story to look in) so the
// reader can highlight the first match. The reader ignores them when absent
// or malformed.
export function readerHighlightParams(q: string, whole: boolean, story: string | null): string {
  let s = `q=${encodeURIComponent(normalizeFullTextQuery(q))}`
  if (whole) s += '&w=1'
  if (story) s += `&story=${encodeURIComponent(story)}`
  return s
}
