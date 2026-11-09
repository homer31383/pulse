// Full-text search over one channel's history: server-only, READ ONLY.
//
// Searches the stored content of the channel's briefings and of the
// profile's digests whose channel_ids include the channel. Content is
// cleaned the way the reader and the PDF see it (pre-headline narration
// stripped), then reduced to plain text (link targets, image URLs, HTML tags
// and Markdown marks removed) so a URL never matches and a snippet reads as
// prose. In a digest that covers several channels only this channel's own
// story is searched when the section parser can find it; otherwise the
// whole digest is searched and the hit says so.
//
// SQL does a case-insensitive ilike prefilter (the query escaped, so % and _
// are literal); the match itself, counts and snippets are computed here.
// Nothing here writes: no read_at, no queue, no seen stamps, no model call.

import { supabase } from './supabase'
import { ownedChannel } from './channel-export'
import { parsePressSections, stripPreHeadingNarration, type PressSection } from './press-sections'
import {
  buildSearchRegex,
  FULLTEXT_RESULT_CAP,
  normalizeFullTextQuery,
  strongNorm,
  type FullTextHit,
  type FullTextResponse,
  type FullTextSnippet,
} from './channel-history-types'

const MAX_ROWS = 2000
const SNIPPET_CHARS = 160
const SNIPPET_LEAD = 60

// This channel's story inside a digest: a ## section titled with the
// channel name, or with the name followed by a separator and a subtitle
// ("E & RWA Outlook: Real-World Asset Tokenization"). Exact titles win.
export function findChannelStory(sections: PressSection[], channelName: string): PressSection | null {
  const want = strongNorm(channelName)
  if (!want) return null
  const titled = sections.filter((s) => s.title)
  const exact = titled.find((s) => strongNorm(s.title!) === want)
  if (exact) return exact
  return (
    titled.find((s) => {
      const head = s.title!.split(/\s+[-\u2013\u2014|]\s+|[:\u2013\u2014|(]/)[0]
      return strongNorm(head) === want
    }) ?? null
  )
}

// Markdown to the plain text a reader sees, whitespace collapsed.
// Underscores inside words (snake_case) are kept, so "_" can be searched.
export function toSearchText(md: string): string {
  return md
    .replace(/```[^\n]*\n?/g, ' ')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/<https?:\/\/[^>\s]+>/g, ' ')
    .replace(/<\/?[a-zA-Z][^>]*>/g, '')
    .replace(/^[ \t]*#{1,6}[ \t]+/gm, '')
    .replace(/^[ \t]*>[ \t]?/gm, '')
    .replace(/^[ \t]*(?:[-*+]|\d+[.)])[ \t]+/gm, '')
    .replace(/^[ \t]*[-*_]{3,}[ \t]*$/gm, ' ')
    .replace(/^[ \t|:-]+$/gm, ' ')
    .replace(/\|/g, ' ')
    .replace(/\*+/g, '')
    .replace(/`+/g, '')
    .replace(/(?<![\p{L}\p{N}])_+|_+(?![\p{L}\p{N}])/gu, '')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim()
}

function snippetAt(text: string, index: number, length: number): FullTextSnippet {
  let start = Math.max(0, index - SNIPPET_LEAD)
  let end = Math.min(text.length, index + length + Math.max(20, SNIPPET_CHARS - SNIPPET_LEAD - length))
  // Don't start or end inside a word
  if (start > 0) {
    const sp = text.indexOf(' ', start)
    if (sp !== -1 && sp < index) start = sp + 1
  }
  if (end < text.length) {
    const sp = text.lastIndexOf(' ', end)
    if (sp > index + length) end = sp
  }
  return {
    before: text.slice(start, index),
    match: text.slice(index, index + length),
    after: text.slice(index + length, end),
    lead: start > 0,
    trail: end < text.length,
  }
}

export function matchIn(text: string, re: RegExp): { count: number; snippet: FullTextSnippet } | null {
  re.lastIndex = 0
  let first: RegExpExecArray | null = null
  let count = 0
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (!first) first = m
    count++
    if (m[0].length === 0) re.lastIndex++
  }
  if (!first) return null
  return { count, snippet: snippetAt(text, first.index, first[0].length) }
}

// ilike pattern for the prefilter: \ % _ escaped (Postgres LIKE's default
// escape is backslash), so they match literally. Only used for single-token
// ASCII queries: a phrase can span Markdown marks or line breaks in the raw
// text, and non-ASCII case folding may differ between Postgres and JS, so
// those fetch the channel's rows unfiltered (a few hundred KB at most).
// PostgREST reads * as %, which only widens the prefilter; the match below
// is the authority either way.
export function likePattern(q: string): string | null {
  if (!/^[\x21-\x7e]+$/.test(q)) return null
  return `%${q.replace(/[\\%_]/g, '\\$&')}%`
}

export async function searchChannelHistory(
  profileId: string,
  channelId: string,
  rawQuery: string,
  whole: boolean,
): Promise<FullTextResponse | null> {
  const started = Date.now()
  const channel = await ownedChannel(profileId, channelId)
  if (!channel) return null
  const query = normalizeFullTextQuery(rawQuery)
  const pattern = likePattern(query)

  let bq = supabase.from('briefings').select('id, created_at, content').eq('channel_id', channel.id)
  let dq = supabase
    .from('digests')
    .select('id, created_at, content, channel_ids')
    .eq('profile_id', profileId)
    .contains('channel_ids', [channel.id])
  if (pattern) {
    bq = bq.ilike('content', pattern)
    dq = dq.ilike('content', pattern)
  }
  const [bRes, dRes, chRes] = await Promise.all([
    bq.order('created_at', { ascending: false }).limit(MAX_ROWS),
    dq.order('created_at', { ascending: false }).limit(MAX_ROWS),
    // Channel names, so a digest's channel stories are never read as asides
    supabase.from('channels').select('name').eq('profile_id', profileId),
  ])
  if (bRes.error) throw new Error(bRes.error.message)
  if (dRes.error) throw new Error(dRes.error.message)
  const channelNames = (chRes.data ?? []).map((c) => c.name as string)

  const re = buildSearchRegex(query, whole)
  const found: (FullTextHit & { createdAt: string })[] = []

  for (const b of bRes.data ?? []) {
    const text = toSearchText(stripPreHeadingNarration(b.content ?? '').content)
    const m = matchIn(text, re)
    if (m) found.push({ kind: 'briefing', id: b.id, createdAt: b.created_at, matches: m.count, scope: 'briefing', snippet: m.snippet })
  }

  for (const d of dRes.data ?? []) {
    const content = stripPreHeadingNarration(d.content ?? '').content
    const covers = Array.isArray(d.channel_ids) ? d.channel_ids.length : 1
    const parsed = parsePressSections(content, { neverAside: channelNames })
    const story = findChannelStory(parsed.sections, channel.name)
    // A single-channel digest is all this channel's, story or not
    const scope: FullTextHit['scope'] = story || covers <= 1 ? 'story' : 'whole'
    const text = toSearchText(story ? `${story.title}\n${story.body}` : content)
    const m = matchIn(text, re)
    if (m) found.push({ kind: 'digest', id: d.id, createdAt: d.created_at, matches: m.count, scope, snippet: m.snippet })
  }

  found.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  const hits: FullTextHit[] = found
    .slice(0, FULLTEXT_RESULT_CAP)
    .map((h) => ({ kind: h.kind, id: h.id, matches: h.matches, scope: h.scope, snippet: h.snippet }))
  return { query, whole, total: found.length, capped: found.length > FULLTEXT_RESULT_CAP, hits, tookMs: Date.now() - started }
}
