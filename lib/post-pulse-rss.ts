// Post Pulse research — RSS sources (spec §5). Server-only (uses fetch;
// no secrets). Sources are department-agnostic at fetch time; items are
// routed to departments during classification.
//
// Feed availability was checked on 2026-09-14: CG Channel and VP Land
// publish feeds; SideFX, Foundry, and superrendersfarm expose no RSS on
// their current sites, and ActionVFX answers automated requests with 429.
// Those four stay in the list so their domains count as KNOWN sources for
// the auto-publish rule, and the web-search pass is told to prefer them.

export interface PpRssSource {
  key: string
  name: string
  feedUrl: string | null
  domains: string[]
  note?: string
}

export const PP_RSS_SOURCES: PpRssSource[] = [
  { key: 'cgchannel', name: 'CG Channel', feedUrl: 'https://www.cgchannel.com/feed/', domains: ['cgchannel.com'] },
  {
    key: 'sidefx',
    name: 'SideFX news',
    feedUrl: null,
    domains: ['sidefx.com'],
    note: 'No RSS feed found on sidefx.com (Sept 2026); covered by web search.',
  },
  {
    key: 'foundry',
    name: 'Foundry blog',
    feedUrl: null,
    domains: ['foundry.com'],
    note: 'No RSS feed found on foundry.com (Sept 2026); covered by web search.',
  },
  {
    key: 'actionvfx',
    name: 'ActionVFX blog',
    feedUrl: 'https://www.actionvfx.com/blog/feed',
    domains: ['actionvfx.com'],
    note: 'Feed URL returned 429 to automated clients (Sept 2026); fetched opportunistically.',
  },
  {
    key: 'superrendersfarm',
    name: 'superrendersfarm',
    feedUrl: null,
    domains: ['superrendersfarm.com'],
    note: 'No RSS feed found (Sept 2026); covered by web search.',
  },
  { key: 'vpland', name: 'VP Land', feedUrl: 'https://www.vp-land.com/feed', domains: ['vp-land.com'] },
]

export const PP_KNOWN_DOMAINS = PP_RSS_SOURCES.flatMap((s) => s.domains)

export function isKnownSourceUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase()
    return PP_KNOWN_DOMAINS.some((d) => host === d || host.endsWith(`.${d}`))
  } catch {
    return false
  }
}

export interface PpRssItem {
  source: string
  sourceName: string
  title: string
  link: string
  published: string | null
  summary: string
}

// ── Minimal RSS 2.0 / Atom parser (no dependency) ───────────────────────

function decodeEntities(s: string): string {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&amp;/g, '&')
}

function stripTags(s: string): string {
  return decodeEntities(decodeEntities(s).replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim()
}

function tag(block: string, name: string): string | null {
  const m = block.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`, 'i'))
  return m ? m[1].trim() : null
}

function atomLink(block: string): string | null {
  const links = block.match(/<link\b[^>]*>/gi) ?? []
  const pick =
    links.find((l) => /rel=["']alternate["']/i.test(l)) ?? links.find((l) => !/rel=/i.test(l)) ?? links[0]
  const href = pick?.match(/href=["']([^"']+)["']/i)
  return href ? decodeEntities(href[1]) : null
}

export function parseFeed(xml: string, source: PpRssSource): PpRssItem[] {
  const items: PpRssItem[] = []
  const blocks = xml.match(/<item\b[\s\S]*?<\/item>/gi) ?? xml.match(/<entry\b[\s\S]*?<\/entry>/gi) ?? []
  for (const block of blocks) {
    const title = stripTags(tag(block, 'title') ?? '')
    const rssLink = tag(block, 'link')
    const link = (rssLink && !/^</.test(rssLink) ? decodeEntities(rssLink) : null) ?? atomLink(block)
    if (!title || !link) continue
    const dateRaw = tag(block, 'pubDate') ?? tag(block, 'published') ?? tag(block, 'updated') ?? tag(block, 'dc:date')
    const published = dateRaw && !Number.isNaN(Date.parse(dateRaw)) ? new Date(dateRaw).toISOString() : null
    const body = tag(block, 'content:encoded') ?? tag(block, 'description') ?? tag(block, 'summary') ?? tag(block, 'content') ?? ''
    items.push({
      source: source.key,
      sourceName: source.name,
      title,
      link: link.trim(),
      published,
      summary: stripTags(body).slice(0, 600),
    })
  }
  return items
}

export interface RssFetchResult {
  items: PpRssItem[]
  errors: { source: string; error: string }[]
  fetchedSources: number
}

// Fetches every source that has a feed, in parallel, keeping items
// published on/after sinceIso (undated items are kept). Per-source
// failures are reported, never thrown — a dead feed must not stop a run.
export async function fetchRssItems(opts: { sinceIso: string; timeoutMs?: number }): Promise<RssFetchResult> {
  const since = Date.parse(opts.sinceIso)
  const timeoutMs = opts.timeoutMs ?? 15_000
  const errors: RssFetchResult['errors'] = []
  const items: PpRssItem[] = []
  const withFeeds = PP_RSS_SOURCES.filter((s) => s.feedUrl)

  await Promise.all(
    withFeeds.map(async (source) => {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), timeoutMs)
      try {
        const res = await fetch(source.feedUrl!, {
          signal: controller.signal,
          headers: {
            'User-Agent': 'Mozilla/5.0 (compatible; PulseResearch/1.0; +https://mypulse-sepia.vercel.app)',
            Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.5',
          },
          cache: 'no-store',
        })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const xml = await res.text()
        if (!/<(rss|feed|rdf:RDF)\b/i.test(xml)) throw new Error('Response is not an RSS/Atom document')
        for (const item of parseFeed(xml, source)) {
          if (item.published && Date.parse(item.published) < since) continue
          items.push(item)
        }
      } catch (err) {
        errors.push({ source: source.name, error: err instanceof Error ? err.message : String(err) })
      } finally {
        clearTimeout(timer)
      }
    })
  )

  // Newest first, stable across sources
  items.sort((a, b) => (b.published ?? '').localeCompare(a.published ?? ''))
  return { items, errors, fetchedSources: withFeeds.length }
}
