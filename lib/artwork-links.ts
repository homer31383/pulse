// "Image" search links next to artwork headings in art channels' briefings.
// Client-safe. Derived at render time from the stored markdown: nothing is
// stored, fetched, or sent anywhere until the reader taps the link.
//
// Classic Art briefings title the featured work as a heading in the form
//   # Artist, *Title*, year        (most briefings)
//   # Artist, *Title* (year)       (the two earliest)
// with the medium and location on bold lines below. Anything else gets no
// link: a heading that doesn't parse cleanly is skipped, never guessed at.

// Channels whose briefings get the links: channel names (case-insensitive)
// or channel ids. Add 'Art and design' or 'Classic Movies' here later.
export const ARTWORK_LINK_CHANNELS: readonly string[] = ['Classic Art']

// {query} is replaced by the URL-encoded "title artist".
export const IMAGE_SEARCH_URL_TEMPLATE = 'https://www.google.com/search?tbm=isch&q={query}'

export interface Artwork {
  title: string
  artist: string
}

export function artworkLinksEnabled(channel: { id?: string | null; name?: string | null }): boolean {
  const id = channel.id?.trim().toLowerCase()
  const name = channel.name?.trim().toLowerCase()
  return ARTWORK_LINK_CHANNELS.some((entry) => {
    const e = entry.trim().toLowerCase()
    return e === id || e === name
  })
}

const MAX_ARTIST_LENGTH = 80
const MAX_ARTIST_WORDS = 8
const MAX_TITLE_LENGTH = 200
// An artist we can't name is not something to search for
const UNKNOWN_ARTIST = /^(unknown|anonymous|unidentified|artist unknown)\b/i

// "Artist, " then the title in italics (*…* or _…_) or double quotes.
const HEADING_RE = /^([^*_",“”]+?),\s+(?:\*([^*]+)\*|_([^_]+)_|"([^"]+)"|“([^”]+)”)(.*)$/u

// Heading text as markdown (the `#` marks are optional), e.g.
// "Jan van Eyck, *The Arnolfini Portrait*, 1434". Null unless both a title
// and an artist come out cleanly.
export function parseArtworkHeading(text: string): Artwork | null {
  // Drop the heading marks and any leading emoji or symbols
  const s = text.trim().replace(/^#+\s*/, '').replace(/^[^\p{L}\p{N}]+/u, '').trim()
  const m = HEADING_RE.exec(s)
  if (!m) return null

  const artist = m[1].replace(/\s+/g, ' ').trim()
  const title = (m[2] ?? m[3] ?? m[4] ?? m[5] ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^["“'‘]+|["”'’]+$/g, '')
    .replace(/[,;:]+$/, '')
    .trim()
  const rest = m[6]

  // After the title: nothing, a date (", 1434"), a parenthesis, or a "·" list
  if (rest.trim() && !/^\s*[,(·]/.test(rest)) return null

  if (!title || title.length > MAX_TITLE_LENGTH) return null
  if (!/^\p{L}/u.test(artist)) return null
  if (artist.length > MAX_ARTIST_LENGTH || artist.split(' ').length > MAX_ARTIST_WORDS) return null
  // A digit, link or markup in the artist slot means this isn't a name
  if (/[\d\[\]#:()]/.test(artist)) return null
  if (UNKNOWN_ARTIST.test(artist)) return null

  return { title, artist }
}

export function imageSearchUrl(artwork: Artwork): string {
  return IMAGE_SEARCH_URL_TEMPLATE.replace('{query}', encodeURIComponent(`${artwork.title} ${artwork.artist}`))
}
