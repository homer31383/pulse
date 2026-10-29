// Stored briefing markdown -> a small block tree the PDF layout understands.
// Remark (the same parser react-markdown uses in the reading view) tokenizes;
// the mapping to blocks, and what is dropped, is ours. Pure: no I/O.
import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkGfm from 'remark-gfm'
import type { Root, RootContent, PhrasingContent, Table } from 'mdast'
import { parsePressSections, stripPreHeadingNarration } from '@/lib/press-sections'

export interface Inline {
  text: string
  bold?: boolean
  italic?: boolean
  code?: boolean
  href?: string
}

export type Block =
  | { type: 'heading'; depth: number; inlines: Inline[] }
  | { type: 'paragraph'; inlines: Inline[] }
  | { type: 'list'; ordered: boolean; start: number; items: Block[][] }
  | { type: 'blockquote'; children: Block[] }
  | { type: 'rule' }
  | { type: 'table'; rows: Inline[][][] } // rows[0] is the header row

export interface ArticleSection {
  title: Inline[] | null
  isAside: boolean
  blocks: Block[]
}

export interface Article {
  headline: Inline[] | null
  sections: ArticleSection[]
}

// What the export changed or could not carry over, counted per kind so the
// route can report it ("12 emoji removed").
export type RenderNotes = Map<string, number>

export function note(notes: RenderNotes | undefined, key: string, n = 1) {
  if (!notes) return
  notes.set(key, (notes.get(key) ?? 0) + n)
}

// Emoji have no glyphs in a print font. Pictographs, their variation
// selectors and joiners, regional-indicator flags and keycaps are removed.
const EMOJI = /(?:\p{Extended_Pictographic}|[\u{1F1E6}-\u{1F1FF}]|\u{20E3})[\u{FE0F}\u{200D}]*/gu
const EMOJI_LEFTOVER = /[\u{FE0F}\u{200D}]/gu

// CJK has no glyphs in the embedded fonts either (a CJK font would add
// megabytes for a handful of original film titles). Removed with the
// separator it leaves behind: "(花樣年華, 2000)" becomes "(2000)".
const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\u3000-\u303F\uFF00-\uFFEF]+/gu

export function stripEmoji(text: string, notes?: RenderNotes): string {
  let count = 0
  let out = text.replace(EMOJI, () => { count += 1; return '' }).replace(EMOJI_LEFTOVER, '')
  if (count) note(notes, 'emoji removed', count)
  const cjk = out.match(CJK)
  if (cjk) {
    note(notes, `CJK text removed (no font): ${cjk.join(' ')}`)
    out = out.replace(CJK, '\u0000').replace(/\(\u0000[,;]?\s*/g, '(').replace(/[,;]?\s*\u0000\)/g, ')').replace(/\(\)/g, '').replace(/\u0000/g, '')
  }
  return out
}

const processor = unified().use(remarkParse).use(remarkGfm)

function parseMd(md: string): Root {
  return processor.parse(md) as Root
}

function phrasing(nodes: PhrasingContent[], notes: RenderNotes | undefined, style: Omit<Inline, 'text'> = {}): Inline[] {
  const out: Inline[] = []
  for (const node of nodes) {
    switch (node.type) {
      case 'text':
        out.push({ ...style, text: stripEmoji(node.value.replace(/\s*\n\s*/g, ' '), notes) })
        break
      case 'strong':
        out.push(...phrasing(node.children, notes, { ...style, bold: true }))
        break
      case 'emphasis':
        out.push(...phrasing(node.children, notes, { ...style, italic: true }))
        break
      case 'delete':
        note(notes, 'strikethrough shown as plain text')
        out.push(...phrasing(node.children, notes, style))
        break
      case 'inlineCode':
        out.push({ ...style, code: true, text: node.value })
        break
      case 'link':
        out.push(...phrasing(node.children, notes, { ...style, href: safeHref(node.url) }))
        break
      case 'image':
        // Stored "images" point at web pages as often as at image files, and
        // the export never fetches anything: shown as a link with its alt text
        note(notes, 'images shown as links')
        out.push({ ...style, italic: true, text: `Image: ${stripEmoji(node.alt || node.url, notes)}`, href: safeHref(node.url) })
        break
      case 'break':
        out.push({ ...style, text: '\n' })
        break
      case 'html':
        // <cite index="..."> wrappers from the search tool: tags go, text stays
        if (/^<\/?cite\b/i.test(node.value)) note(notes, '<cite> tags removed (text kept)')
        else note(notes, `inline HTML removed: ${node.value.slice(0, 40)}`)
        break
      case 'footnoteReference':
        note(notes, 'footnote references removed')
        break
      default:
        // linkReference / imageReference: keep any text inside
        if ('children' in node && Array.isArray(node.children)) out.push(...phrasing(node.children as PhrasingContent[], notes, style))
        else note(notes, `unsupported inline "${node.type}" removed`)
    }
  }
  return out.filter((i) => i.text !== '')
}

function safeHref(url: string): string | undefined {
  return /^(https?:|mailto:)/i.test(url) ? url : undefined
}

function tableRows(node: Table, notes: RenderNotes | undefined): Inline[][][] {
  return node.children.map((row) => row.children.map((cell) => phrasing(cell.children, notes)))
}

function blocks(nodes: RootContent[], notes: RenderNotes | undefined): Block[] {
  const out: Block[] = []
  for (const node of nodes) {
    switch (node.type) {
      case 'heading':
        out.push({ type: 'heading', depth: node.depth, inlines: trimLeading(phrasing(node.children, notes)) })
        break
      case 'paragraph': {
        // A paragraph that is only an image becomes its own link line
        const inlines = phrasing(node.children, notes)
        if (inlines.some((i) => i.text.trim())) out.push({ type: 'paragraph', inlines: trimLeading(inlines) })
        break
      }
      case 'list':
        out.push({
          type: 'list',
          ordered: !!node.ordered,
          start: node.start ?? 1,
          items: node.children.map((li) => blocks(li.children, notes)),
        })
        break
      case 'blockquote':
        out.push({ type: 'blockquote', children: blocks(node.children, notes) })
        break
      case 'thematicBreak':
        out.push({ type: 'rule' })
        break
      case 'table':
        out.push({ type: 'table', rows: tableRows(node, notes) })
        break
      case 'code':
        note(notes, 'code blocks shown as plain paragraphs')
        out.push({ type: 'paragraph', inlines: [{ text: node.value, code: true }] })
        break
      case 'html': {
        const text = node.value.replace(/<[^>]+>/g, '').trim()
        note(notes, /<\/?cite\b/i.test(node.value) ? '<cite> tags removed (text kept)' : 'HTML blocks reduced to their text')
        if (text) out.push({ type: 'paragraph', inlines: [{ text: stripEmoji(text, notes) }] })
        break
      }
      case 'definition':
        break
      default:
        note(notes, `unsupported block "${node.type}" removed`)
    }
  }
  return out
}

// Removing a leading emoji leaves "  Classic Movies"
function trimLeading(inlines: Inline[]): Inline[] {
  const out = inlines.map((i) => ({ ...i }))
  while (out.length && !out[0].text.trim()) out.shift()
  if (out.length) out[0].text = out[0].text.replace(/^\s+/, '')
  return out
}

export function inlineMarkdown(md: string, notes?: RenderNotes): Inline[] {
  const root = parseMd(md)
  const first = root.children[0]
  if (first && first.type === 'paragraph') return trimLeading(phrasing(first.children, notes))
  return trimLeading([{ text: stripEmoji(md, notes) }])
}

export function plainText(inlines: Inline[] | null): string {
  return (inlines ?? []).map((i) => i.text).join('').replace(/\s+/g, ' ').trim()
}

// The article as the reading view structures it (lib/press-sections), with
// the model's pre-headline research narration dropped, as at persist time.
export function parseArticle(content: string, notes?: RenderNotes): Article {
  const { content: md, stripped } = stripPreHeadingNarration(content)
  if (stripped) note(notes, 'pre-headline research narration removed')
  const { headline, sections } = parsePressSections(md)
  return {
    headline: headline ? inlineMarkdown(headline, notes) : null,
    sections: sections.map((s) => ({
      title: s.title ? inlineMarkdown(s.title, notes) : null,
      isAside: s.isAside,
      blocks: dropTrailingRules(blocks(parseMd(s.body).children, notes)),
    })),
  }
}

// A "---" closing a section sits right above the next section's label rule
function dropTrailingRules(list: Block[]): Block[] {
  let end = list.length
  while (end > 0 && list[end - 1].type === 'rule') end--
  return list.slice(0, end)
}

// Contents-page title candidates, in reading order: the headline, other
// "#" headlines (a film class's film), story sub-headlines inside a section
// ("###" and below), and the bold lead of each highlight in an analyst note
// (Key Takeaways). Section titles ("##") are left out: they name a recurring
// department ("Exhibitions: New York in Detail"), not the day's story.
export function titleCandidates(article: Article): string[] {
  const out: string[] = []
  if (article.headline) out.push(plainText(article.headline))
  for (const s of article.sections) {
    for (const b of s.blocks) {
      if (b.type === 'heading' && (b.depth === 1 || b.depth >= 3)) out.push(plainText(b.inlines))
      if (s.isAside && b.type === 'list') {
        for (const item of b.items) {
          const lead = boldLead(item)
          if (lead) out.push(lead)
        }
      }
    }
  }
  return out.map(cleanTitle).filter(Boolean)
}

// "**Venice Biennale enters its final stretch.** The 61st..." gives the bold part
function boldLead(item: Block[]): string | null {
  const first = item[0]
  if (!first || first.type !== 'paragraph') return null
  const lead: string[] = []
  for (const i of first.inlines) {
    if (!i.bold) break
    lead.push(i.text)
  }
  const text = lead.join('').trim()
  return text.length >= 12 ? text : null
}

function cleanTitle(t: string): string {
  const s = t.replace(/\s+/g, ' ').trim().replace(/[\s.:;,\u2014\u2013-]+$/, '')
  return s.length > 120 ? `${s.slice(0, 117).trimEnd()}...` : s
}

const DATE_WORDS = /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday|january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec|special edition|edition|week of)\b/gi

// The heading with the date taken out, for spotting the repeated masthead
// line ("Art & Design Briefing - <date>") across an export
function genericKey(heading: string): string {
  return heading.toLowerCase().replace(/&/g, ' and ').replace(DATE_WORDS, '').replace(/[\d\s.,:;·|\-\u2013\u2014()*_]+/g, ' ').trim()
}

// One contents title per article. A briefing's first heading is often the
// channel's masthead line, the same every day ("Classic Movies - Daily Film
// Class") or just the date; the contents page then uses the first story or
// highlight headline instead (the film, the first Key Takeaway). A candidate
// is generic when it repeats in more than half the export (at least 3), is
// the channel's own name with at most a suffix ("Classic Movies - Special
// Edition", "Art & Design Briefing"), or is only a date. null means nothing
// useful was found: the contents page shows the date alone.
export function contentsTitles(articles: Article[], channelName = ''): (string | null)[] {
  const channelKey = genericKey(channelName)
  const candidates = articles.map(titleCandidates)
  const freq = new Map<string, number>()
  for (const list of candidates) for (const key of new Set(list.map(genericKey))) freq.set(key, (freq.get(key) ?? 0) + 1)
  const generic = (h: string) => {
    const key = genericKey(h)
    if (!key) return true // date only
    if (channelKey && key.startsWith(channelKey)) return true
    const n = freq.get(key) ?? 0
    return articles.length >= 3 && n >= 3 && n > articles.length / 2
  }
  return candidates.map((list) => list.find((h) => !generic(h)) ?? null)
}
