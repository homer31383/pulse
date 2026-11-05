// Channel history index — server-only, READ ONLY.
//
// Builds the list behind /channels/[id]/history: every briefing of the
// channel plus every digest whose channel_ids include it, newest first, each
// reduced to what a row needs (date, kind, headline, excerpt, read state).
// The full content never reaches the client; the rows link to /read/... .
// Nothing here writes: no read_at, no queue, no seen stamps, no model call.

import { supabase } from './supabase'
import { ownedChannel } from './channel-export'
import { parsePressSections, stripPreHeadingNarration } from './press-sections'
import { excerptFor, firstProse, normName, truncate } from './recap'
import { contentsTitles, parseArticle } from './pdf/briefing-blocks'
import type { ChannelHistoryEntry } from './channel-history-types'

// Upper bound per kind; far above today's largest channel (32 entries).
const MAX_ROWS = 2000

export async function fetchChannelHistory(
  profileId: string,
  channelId: string,
): Promise<{ channel: { id: string; name: string }; entries: ChannelHistoryEntry[] } | null> {
  // Same ownership rule as the export routes: the channel must belong to the
  // cookie profile, otherwise the caller answers 404.
  const channel = await ownedChannel(profileId, channelId)
  if (!channel) return null

  const [briefingsRes, digestsRes, channelsRes] = await Promise.all([
    supabase
      .from('briefings')
      .select('id, created_at, read_at, content')
      .eq('channel_id', channel.id)
      .order('created_at', { ascending: false })
      .limit(MAX_ROWS),
    supabase
      .from('digests')
      .select('id, created_at, read_at, content, channel_ids')
      .eq('profile_id', profileId)
      .contains('channel_ids', [channel.id])
      .order('created_at', { ascending: false })
      .limit(MAX_ROWS),
    // Every channel name of the profile, so a digest's channel stories are
    // never mistaken for analyst-note asides (same rule as the recap).
    supabase.from('channels').select('name').eq('profile_id', profileId),
  ])
  if (briefingsRes.error) throw new Error(briefingsRes.error.message)
  if (digestsRes.error) throw new Error(digestsRes.error.message)
  const channelNames = (channelsRes.data ?? []).map((c) => c.name as string)

  const entries: ChannelHistoryEntry[] = []

  // A briefing's headline is often the channel's masthead line, the same
  // every day ("Classic Movies - Daily Film Class"), so rows use the PDF
  // contents title (the film, the first takeaway) and fall back to it.
  const briefings = briefingsRes.data ?? []
  const titles = contentsTitles(briefings.map((b) => parseArticle(b.content ?? '')), channel.name)
  briefings.forEach((b, i) => {
    const parsed = parsePressSections(stripPreHeadingNarration(b.content ?? '').content, { neverAside: channelNames })
    entries.push({
      kind: 'briefing',
      id: b.id,
      createdAt: b.created_at,
      read: !!b.read_at,
      headline: titles[i] || parsed.headline?.trim() || `${channel.name} · Briefing`,
      excerpt: excerptFor(parsed.sections),
      coversChannels: 1,
    })
  })

  for (const d of digestsRes.data ?? []) {
    const parsed = parsePressSections(stripPreHeadingNarration(d.content ?? '').content, { neverAside: channelNames })
    // Excerpt from this channel's own story in the digest when there is one
    // (heading casing drifts, so match case-insensitively), else the digest's.
    const story = parsed.sections.find((s) => s.title && !s.isAside && normName(s.title) === normName(channel.name))
    const storyProse = story ? firstProse(story.body) : null
    entries.push({
      kind: 'digest',
      id: d.id,
      createdAt: d.created_at,
      read: !!d.read_at,
      headline: parsed.headline?.trim() || 'Morning Digest',
      excerpt: storyProse ? truncate(storyProse) : excerptFor(parsed.sections),
      coversChannels: Array.isArray(d.channel_ids) ? d.channel_ids.length : 1,
    })
  }

  entries.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  return { channel, entries }
}
