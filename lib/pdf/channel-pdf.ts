// Server-only: lays out and draws a channel's briefings as one PDF with
// pdfkit (pure JS, no browser). The layout is our own: every line is broken
// and placed here, then drawn at a fixed position, so a page break always
// falls between lines and contents page numbers are known before drawing.
// Fonts are embedded and subset by pdfkit (Gelasio, a metric match for
// Georgia, for editorial text; Inter for labels), so the file renders the
// same everywhere. Nothing here touches the database or the network.
import { readFileSync } from 'node:fs'
import path from 'node:path'
import PDFDocument from 'pdfkit'
import {
  contentsTitles, parseArticle, note, plainText, stripEmoji,
  type Article, type Block, type Inline, type RenderNotes,
} from './briefing-blocks'

export interface ExportSource { url: string; title?: string | null }

export interface ExportBriefing {
  id: string
  created_at: string
  content: string
  sources: ExportSource[] | null
}

export interface ChannelPdfInput {
  channelName: string
  rangeLabel: string          // "All time", "Last 30 days", "Custom range"
  briefings: ExportBriefing[] // already in reading order
  generatedAt?: Date
}

export type ChannelPdfProgress =
  | { phase: 'layout'; done: number; total: number }
  | { phase: 'draw'; done: number; total: number }

export interface ChannelPdfResult {
  pdf: Buffer
  pageCount: number
  startPages: number[]   // 1-based physical page of each briefing
  briefingPages: number[] // pages each briefing takes
  notes: RenderNotes
}

export class ChannelPdfTooLarge extends Error {
  constructor(public pageCount: number, public briefingPages: number[]) {
    super(`The export would be ${pageCount} pages`)
  }
}

// Page geometry, in points (US Letter)
const W = 612
const H = 792
const ML = 90
const CW = W - 2 * ML
const TOP = 72
const BOTTOM = H - 72
const FOOTER_RULE_Y = H - 56

const C = {
  paper: '#F0ECF4',
  accent: '#6B5CA5',
  ink: '#2C2522',
  body: '#48404A',
  muted: '#7A7070',
  faint: '#9A9098',
  hair: '#DAD6DF',
  asideFill: '#F5F3F9',
}

const TIME_ZONE = 'America/New_York'

type FontKey = 'serif' | 'serif-i' | 'serif-b' | 'serif-bi' | 'sans' | 'sans-m' | 'sans-b'

const FONT_FILES: Record<FontKey, string> = {
  'serif': 'Gelasio_400Regular.ttf',
  'serif-i': 'Gelasio_400Regular_Italic.ttf',
  'serif-b': 'Gelasio_600SemiBold.ttf',
  'serif-bi': 'Gelasio_600SemiBold_Italic.ttf',
  'sans': 'Inter_400Regular.ttf',
  'sans-m': 'Inter_500Medium.ttf',
  'sans-b': 'Inter_600SemiBold.ttf',
}

const FONT_DIR = path.join(process.cwd(), 'lib', 'pdf', 'fonts')
let fontBuffers: Record<FontKey, Buffer> | null = null
function loadFonts(): Record<FontKey, Buffer> {
  if (!fontBuffers) {
    fontBuffers = Object.fromEntries(
      (Object.keys(FONT_FILES) as FontKey[]).map((k) => [k, readFileSync(path.join(FONT_DIR, FONT_FILES[k]))]),
    ) as Record<FontKey, Buffer>
  }
  return fontBuffers
}

// ── Text measurement and line breaking ─────────────────────────────────

interface TextStyle {
  family: 'serif' | 'sans'
  size: number
  lineHeight: number
  color: string
  weight?: 'regular' | 'medium' | 'bold'
  italic?: boolean
  tracking?: number
  uppercase?: boolean
  linkColor?: string
  boldColor?: string
}

interface Piece {
  text: string
  font: FontKey
  size: number
  color: string
  tracking: number
  href?: string
  width: number
}

interface Line {
  pieces: { piece: Piece; x: number }[]
  width: number
  lineHeight: number
  size: number
  font: FontKey
}

type Doc = PDFKit.PDFDocument
interface FontkitFont { hasGlyphForCodePoint(cp: number): boolean }
// pdfkit's embedded font: the fontkit font, plus metrics per 1000 units
interface EmbeddedFont { font: FontkitFont; ascender: number; descender: number }

class Measurer {
  private coverage = new Map<string, boolean>()
  private widths = new Map<string, number>()
  private metrics = new Map<FontKey, { ascent: number; descent: number }>()

  // Measuring-only passes (table column widths) lay text out twice; only
  // the real layout counts dropped characters
  quiet = false

  constructor(private doc: Doc, private notes: RenderNotes) {}

  private embedded(key: FontKey): EmbeddedFont {
    this.doc.font(key)
    return (this.doc as unknown as { _font: EmbeddedFont })._font
  }

  has(key: FontKey, cp: number): boolean {
    const k = `${key}:${cp}`
    let v = this.coverage.get(k)
    if (v === undefined) {
      v = this.embedded(key).font.hasGlyphForCodePoint(cp)
      this.coverage.set(k, v)
    }
    return v
  }

  // Ascent and descent per point of size
  metric(key: FontKey) {
    let m = this.metrics.get(key)
    if (!m) {
      const f = this.embedded(key)
      m = { ascent: f.ascender / 1000, descent: -f.descender / 1000 }
      this.metrics.set(key, m)
    }
    return m
  }

  width(font: FontKey, size: number, text: string, tracking: number): number {
    const k = `${font}|${text}`
    let per = this.widths.get(k)
    if (per === undefined) {
      this.doc.font(font).fontSize(1000)
      per = this.doc.widthOfString(text) / 1000
      this.widths.set(k, per)
    }
    return per * size + tracking * [...text].length
  }

  // Split a word into pieces by which font has the glyphs: the styled serif
  // first, then Inter (arrows, symbols). Characters no font has are dropped
  // and counted.
  pieces(text: string, primary: FontKey, base: Omit<Piece, 'text' | 'font' | 'width'>): Piece[] {
    const fallback: FontKey = primary.startsWith('sans') ? primary : primary.includes('b') ? 'sans-b' : 'sans'
    const out: Piece[] = []
    let cur = ''
    let curFont: FontKey | null = null
    const dropped: string[] = []
    for (const ch of text) {
      const cp = ch.codePointAt(0)!
      if (/\p{Cf}/u.test(ch)) continue // invisible format marks (LRM, soft hyphen)
      const font = this.has(primary, cp) ? primary : this.has(fallback, cp) ? fallback : null
      if (!font) { dropped.push(ch); continue }
      if (font !== curFont && cur) {
        out.push(this.piece(cur, curFont!, base))
        cur = ''
      }
      curFont = font
      cur += ch
    }
    if (cur) out.push(this.piece(cur, curFont!, base))
    if (dropped.length && !this.quiet) note(this.notes, `characters with no glyph in the embedded fonts removed: ${dropped.join('')}`, dropped.length)
    return out
  }

  private piece(text: string, font: FontKey, base: Omit<Piece, 'text' | 'font' | 'width'>): Piece {
    return { ...base, text, font, width: this.width(font, base.size, text, base.tracking) }
  }
}

function fontFor(style: TextStyle, inline: { bold?: boolean; italic?: boolean; code?: boolean }): FontKey {
  if (inline.code) return 'sans'
  if (style.family === 'sans') {
    if (style.weight === 'bold' || inline.bold) return 'sans-b'
    return style.weight === 'medium' ? 'sans-m' : 'sans'
  }
  const bold = inline.bold || style.weight === 'bold'
  const italic = inline.italic || style.italic
  return bold && italic ? 'serif-bi' : bold ? 'serif-b' : italic ? 'serif-i' : 'serif'
}

type Atom = { kind: 'word'; pieces: Piece[]; width: number } | { kind: 'space'; width: number } | { kind: 'break' }

function atomsFor(m: Measurer, inlines: Inline[], style: TextStyle): Atom[] {
  const atoms: Atom[] = []
  let word: Piece[] = []
  const flush = () => {
    if (word.length) atoms.push({ kind: 'word', pieces: word, width: word.reduce((s, p) => s + p.width, 0) })
    word = []
  }
  for (const inline of inlines) {
    const font = fontFor(style, inline)
    const size = inline.code ? style.size * 0.86 : style.size
    const color = inline.href ? (style.linkColor ?? C.accent) : inline.code ? C.accent : inline.bold ? (style.boldColor ?? style.color) : style.color
    const tracking = style.tracking ?? 0
    const text = style.uppercase ? inline.text.toUpperCase() : inline.text
    for (const token of text.split(/(\n|[ \t ]+)/)) {
      if (!token) continue
      if (token === '\n') { flush(); atoms.push({ kind: 'break' }); continue }
      if (/^[ \t ]+$/.test(token)) {
        flush()
        atoms.push({ kind: 'space', width: m.width(font, size, ' ', tracking) })
        continue
      }
      word.push(...m.pieces(token, font, { size, color, tracking, href: inline.href }))
    }
  }
  flush()
  return atoms
}

function sameStyle(a: Piece, b: Piece): boolean {
  return a.font === b.font && a.size === b.size && a.color === b.color && a.tracking === b.tracking && a.href === b.href
}

// Greedy line breaking at spaces. A word longer than the line (a bare URL)
// is cut between characters, never inside one.
function breakLines(m: Measurer, inlines: Inline[], style: TextStyle, width: number): Line[] {
  const lines: Line[] = []
  const primary = fontFor(style, {})
  const newLine = (): Line => ({ pieces: [], width: 0, lineHeight: style.lineHeight, size: style.size, font: primary })
  let cur = newLine()
  let space = 0

  // Words in the same style join one text run (one draw call per run, not
  // per word); `gap` is the space before the first piece
  const place = (pieces: Piece[], gap = 0) => {
    pieces.forEach((piece, i) => {
      const g = i === 0 ? gap : 0
      const last = cur.pieces[cur.pieces.length - 1]
      if (last && sameStyle(last.piece, piece)) {
        last.piece = { ...last.piece, text: last.piece.text + (g ? ' ' : '') + piece.text, width: cur.width + g + piece.width - last.x }
      } else {
        cur.pieces.push({ piece, x: cur.width + g })
      }
      cur.width += g + piece.width
    })
  }
  const pushLine = () => { lines.push(cur); cur = newLine(); space = 0 }

  for (const atom of atomsFor(m, inlines, style)) {
    if (atom.kind === 'break') { pushLine(); continue }
    if (atom.kind === 'space') { if (cur.pieces.length) space = atom.width; continue }
    if (cur.pieces.length && cur.width + space + atom.width <= width) {
      place(atom.pieces, space)
      space = 0
      continue
    }
    if (cur.pieces.length) pushLine()
    if (atom.width <= width) { place(atom.pieces); continue }
    // Overlong word: fill lines character by character
    for (const piece of atom.pieces) {
      let chunk = ''
      for (const ch of piece.text) {
        const next = chunk + ch
        const w = m.width(piece.font, piece.size, next, piece.tracking)
        if (cur.width + w > width && (chunk || cur.pieces.length)) {
          if (chunk) place([{ ...piece, text: chunk, width: m.width(piece.font, piece.size, chunk, piece.tracking) }])
          pushLine()
          chunk = ch
        } else {
          chunk = next
        }
      }
      if (chunk) place([{ ...piece, text: chunk, width: m.width(piece.font, piece.size, chunk, piece.tracking) }])
    }
  }
  if (cur.pieces.length) lines.push(cur)
  return lines
}

// ── Rows and pagination ────────────────────────────────────────────────

interface Box { id: number; kind: 'aside' | 'quote'; x: number; w: number; pad: number }

interface Row {
  h: number
  draw?: (r: Renderer, y: number) => void
  space?: boolean      // collapses at the top or bottom of a page
  kwn?: boolean        // keep with the next row
  boxes?: Box[]
  pageBreak?: boolean
  mark?: number        // this row starts briefing #mark
  soft?: boolean       // a "---" rule: dropped at the top or bottom of a page
}

interface Fragment { box: Box; top: number; bottom: number }
interface Page { rows: { row: Row; y: number }[]; fragments: Fragment[]; marks: number[] }

function paginate(rows: Row[]): Page[] {
  const pages: Page[] = []
  let page: Page | null = null
  let y = TOP
  let open: { box: Box; top: number }[] = []

  const closeBoxes = (keep: Box[], atY: number) => {
    const still: typeof open = []
    for (const o of open) {
      if (keep.some((b) => b.id === o.box.id)) still.push(o)
      else page!.fragments.push({ box: o.box, top: o.top, bottom: atY + o.box.pad })
    }
    const closedPad = open.filter((o) => !still.includes(o)).reduce((s, o) => Math.max(s, o.box.pad), 0)
    open = still
    return closedPad
  }
  const newPage = () => {
    if (page) {
      while (page.rows.length && page.rows[page.rows.length - 1].row.soft) {
        const last = page.rows.pop()!
        y = last.y
      }
      closeBoxes([], y)
    }
    page = { rows: [], fragments: [], marks: [] }
    pages.push(page)
    y = TOP
  }

  // Height a row needs here, including padding of boxes it opens and of
  // boxes that end with it
  const need = (i: number): number => {
    const row = rows[i]
    const boxes = row.boxes ?? []
    let h = row.h
    for (const b of boxes) if (!open.some((o) => o.box.id === b.id)) h += b.pad
    const next = rows[i + 1]
    for (const b of boxes) if (!next?.boxes?.some((nb) => nb.id === b.id)) h += b.pad
    return h
  }

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]
    if (row.pageBreak || !page) {
      newPage()
      if (row.mark !== undefined) page!.marks.push(row.mark)
      if (row.pageBreak) continue
    }
    if (row.space) {
      y += closeBoxes(row.boxes ?? [], y)
      if (y === TOP) continue
      if (y + row.h > BOTTOM) { newPage(); continue }
      y += row.h
      continue
    }

    if (row.soft && y === TOP) continue

    // Boxes that ended before this row close (and add their bottom padding)
    y += closeBoxes(row.boxes ?? [], y)

    // Keep-with-next: the row plus the chain of rows it holds on to
    let needed = need(i)
    for (let j = i, chain = 0; rows[j]?.kwn && chain < 4; chain++) {
      let k = j + 1
      while (rows[k]?.space) { needed += rows[k].h; k++ }
      if (!rows[k] || rows[k].pageBreak) break
      needed += rows[k].h
      j = k
    }
    if (y + needed > BOTTOM && y > TOP) {
      newPage()
    }

    for (const b of row.boxes ?? []) {
      if (!open.some((o) => o.box.id === b.id)) {
        open.push({ box: b, top: y })
        y += b.pad
      }
    }
    page!.rows.push({ row, y })
    y += row.h
  }
  if (page) closeBoxes([], y)
  return pages
}

// ── Renderer ───────────────────────────────────────────────────────────

class Renderer {
  m: Measurer
  private boxId = 0

  constructor(public doc: Doc, public notes: RenderNotes) {
    this.m = new Measurer(doc, notes)
  }

  nextBox(kind: Box['kind'], x: number, w: number, pad: number): Box {
    return { id: ++this.boxId, kind, x, w, pad }
  }

  drawLine(line: Line, x: number, y: number) {
    // Baselines align across fonts: centre the line's primary font, then
    // place every piece on that baseline
    const pm = this.m.metric(line.font)
    const baseline = y + (line.lineHeight - (pm.ascent + pm.descent) * line.size) / 2 + pm.ascent * line.size
    for (const { piece, x: px } of line.pieces) {
      const asc = this.m.metric(piece.font).ascent * piece.size
      const top = baseline - asc
      this.doc.font(piece.font).fontSize(piece.size).fillColor(piece.color)
      this.doc.text(piece.text, x + px, top, { lineBreak: false, characterSpacing: piece.tracking })
      if (piece.href) this.doc.link(x + px, y, piece.width, line.lineHeight, piece.href)
    }
  }

  rule(x: number, y: number, w: number, color = C.hair, weight = 0.5) {
    this.doc.save().moveTo(x, y).lineTo(x + w, y).lineWidth(weight).strokeColor(color).stroke().restore()
  }
}

function lineRows(lines: Line[], x: number, boxes: Box[] | undefined, opts: { kwnAll?: boolean } = {}): Row[] {
  return lines.map((line, i) => ({
    h: line.lineHeight,
    boxes,
    // Orphan and widow control: never one line of a paragraph alone
    kwn: opts.kwnAll || (lines.length > 1 && (i === 0 || i === lines.length - 2)),
    draw: (r: Renderer, y: number) => r.drawLine(line, x, y),
  }))
}

const space = (h: number, boxes?: Box[]): Row => ({ h, space: true, boxes })

interface Ctx { x: number; w: number; boxes?: Box[]; small: boolean }

function bodyStyle(ctx: Ctx): TextStyle {
  return ctx.small
    ? { family: 'serif', size: 10, lineHeight: 15, color: C.body, boldColor: C.ink }
    : { family: 'serif', size: 11, lineHeight: 16.5, color: C.body, boldColor: C.ink }
}

const LABEL: TextStyle = { family: 'sans', weight: 'medium', size: 7.5, lineHeight: 11, color: C.accent, tracking: 1.5, uppercase: true }

// A section label with a hairline running to the right edge (the reading
// view's press-label + press-rule-h)
function labelRows(r: Renderer, text: Inline[], ctx: Ctx, color = C.accent): Row[] {
  const style = { ...LABEL, color }
  const lines = breakLines(r.m, text.map((t) => ({ ...t, href: undefined, bold: false, italic: false })), style, ctx.w - 30)
  return lines.map((line, i) => ({
    h: style.lineHeight,
    boxes: ctx.boxes,
    kwn: true,
    draw: (rr: Renderer, y: number) => {
      rr.drawLine(line, ctx.x, y)
      if (i === lines.length - 1) rr.rule(ctx.x + line.width + 8, y + style.lineHeight / 2, ctx.w - line.width - 8)
    },
  }))
}

function headingStyle(depth: number, ctx: Ctx): TextStyle {
  if (depth === 1) return { family: 'serif', size: ctx.small ? 13 : 15.5, lineHeight: ctx.small ? 17 : 20, color: C.ink }
  if (depth <= 3) return { family: 'serif', size: ctx.small ? 11.5 : 12.5, lineHeight: ctx.small ? 15 : 17, color: C.ink }
  return { family: 'serif', weight: 'bold', size: ctx.small ? 10 : 11, lineHeight: ctx.small ? 14 : 15.5, color: C.ink }
}

function blockRows(r: Renderer, block: Block, ctx: Ctx, tight = false): Row[] {
  const gap = tight ? 0 : ctx.small ? 4 : 5.5
  switch (block.type) {
    case 'paragraph': {
      const lines = breakLines(r.m, block.inlines, bodyStyle(ctx), ctx.w)
      return [space(gap, ctx.boxes), ...lineRows(lines, ctx.x, ctx.boxes), space(gap, ctx.boxes)]
    }
    case 'heading': {
      const style = headingStyle(block.depth, ctx)
      const lines = breakLines(r.m, block.inlines, style, ctx.w)
      return [space(block.depth === 1 ? 11 : 9, ctx.boxes), ...lineRows(lines, ctx.x, ctx.boxes, { kwnAll: true }), space(3, ctx.boxes)]
    }
    case 'rule':
      return [space(6, ctx.boxes), { h: 1, soft: true, boxes: ctx.boxes, draw: (rr, y) => rr.rule(ctx.x, y + 0.5, ctx.w) }, space(6, ctx.boxes)]
    case 'blockquote': {
      const box = r.nextBox('quote', ctx.x, ctx.w, 0)
      const inner: Ctx = { ...ctx, x: ctx.x + 10, w: ctx.w - 10, boxes: [...(ctx.boxes ?? []), box] }
      const rows = block.children.flatMap((b) => blockRows(r, italicize(b), inner))
      return [space(gap, ctx.boxes), ...trimSpaces(rows), space(gap, ctx.boxes)]
    }
    case 'list':
      return listRows(r, block, ctx)
    case 'table':
      return tableRows(r, block.rows, ctx)
  }
}

function italicize(block: Block): Block {
  if (block.type === 'paragraph') return { ...block, inlines: block.inlines.map((i) => ({ ...i, italic: true })) }
  return block
}

// Leading/trailing spaces inside a box would add to its padding
function trimSpaces(rows: Row[]): Row[] {
  let a = 0
  let b = rows.length
  while (a < b && rows[a].space) a++
  while (b > a && rows[b - 1].space) b--
  return rows.slice(a, b)
}

// Lists as the reading view draws them: no bullet, a hairline between items;
// ordered lists keep their numbers
function listRows(r: Renderer, block: Extract<Block, { type: 'list' }>, ctx: Ctx): Row[] {
  const rows: Row[] = [space(ctx.small ? 2 : 4, ctx.boxes)]
  const indent = block.ordered ? 18 : 0
  block.items.forEach((item, i) => {
    if (i > 0) rows.push({ h: 0.5, soft: true, boxes: ctx.boxes, draw: (rr, y) => rr.rule(ctx.x, y + 0.25, ctx.w) })
    const inner: Ctx = { ...ctx, x: ctx.x + indent, w: ctx.w - indent }
    const itemRows = trimSpaces(item.flatMap((b) => blockRows(r, b, inner, true)))
    if (block.ordered && itemRows.length) {
      const first = itemRows.findIndex((row) => row.draw && !row.space)
      const number = breakLines(r.m, [{ text: `${block.start + i}.` }], { ...bodyStyle(ctx), color: C.muted }, indent)[0]
      const orig = itemRows[first]
      itemRows[first] = { ...orig, draw: (rr, y) => { rr.drawLine(number, ctx.x, y); orig.draw!(rr, y) } }
    }
    const pad = ctx.small ? 3 : 4
    rows.push({ h: pad, boxes: ctx.boxes }, ...itemRows, { h: pad, boxes: ctx.boxes })
  })
  rows.push(space(ctx.small ? 2 : 4, ctx.boxes))
  return rows
}

// Column widths from content: each column's natural (one-line) width, with
// the longest word as its minimum; shrunk proportionally to fit.
function tableRows(r: Renderer, cells: Inline[][][], ctx: Ctx): Row[] {
  if (!cells.length) return []
  const cols = Math.max(...cells.map((row) => row.length))
  const pad = 4
  const style: TextStyle = { family: 'serif', size: ctx.small ? 8.75 : 9.25, lineHeight: ctx.small ? 12 : 12.75, color: C.body, boldColor: C.ink }
  const headStyle: TextStyle = { ...style, weight: 'bold', color: C.ink }
  const natural = new Array(cols).fill(20)
  const minimum = new Array(cols).fill(20)
  cells.forEach((row, ri) => row.forEach((cell, ci) => {
    const s = ri === 0 ? headStyle : style
    r.m.quiet = true
    const lines = breakLines(r.m, cell, s, 10_000)
    r.m.quiet = false
    natural[ci] = Math.max(natural[ci], (lines[0]?.width ?? 0) + 2 * pad)
    for (const word of plainText(cell).split(/\s+/)) {
      minimum[ci] = Math.max(minimum[ci], Math.min(r.m.width(fontFor(s, {}), s.size, word, 0) + 2 * pad, ctx.w / cols))
    }
  }))
  let widths = natural.slice()
  const total = natural.reduce((a, b) => a + b, 0)
  if (total > ctx.w) {
    const minTotal = minimum.reduce((a, b) => a + b, 0)
    const spare = Math.max(0, ctx.w - minTotal)
    const extra = natural.map((n, i) => n - minimum[i])
    const extraTotal = extra.reduce((a, b) => a + b, 0) || 1
    widths = minimum.map((mn, i) => mn + (spare * extra[i]) / extraTotal)
    if (minTotal > ctx.w) widths = widths.map((wd) => (wd * ctx.w) / minTotal)
  } else {
    widths = natural.map((n) => n + (ctx.w - total) / cols)
  }
  const xs = widths.map((_, i) => ctx.x + widths.slice(0, i).reduce((a, b) => a + b, 0))

  const rows: Row[] = [space(ctx.small ? 4 : 6, ctx.boxes)]
  cells.forEach((row, ri) => {
    const s = ri === 0 ? headStyle : style
    const laid = Array.from({ length: cols }, (_, ci) => breakLines(r.m, row[ci] ?? [], s, widths[ci] - 2 * pad))
    const h = Math.max(1, ...laid.map((l) => l.length)) * s.lineHeight + 2 * 3
    rows.push({
      h,
      boxes: ctx.boxes,
      kwn: ri === 0,
      draw: (rr, y) => {
        laid.forEach((lines, ci) => lines.forEach((line, li) => rr.drawLine(line, xs[ci] + pad, y + 3 + li * s.lineHeight)))
        rr.rule(ctx.x, y + h, ctx.w, ri === 0 ? C.muted : C.hair, ri === 0 ? 0.6 : 0.5)
      },
    })
  })
  rows.push(space(ctx.small ? 4 : 6, ctx.boxes))
  return rows
}

// ── Article, contents, cover ───────────────────────────────────────────

function etDateLong(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { timeZone: TIME_ZONE, weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
}
function etDate(iso: string | Date): string {
  return new Date(iso).toLocaleDateString('en-US', { timeZone: TIME_ZONE, month: 'long', day: 'numeric', year: 'numeric' })
}
function etDateShort(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { timeZone: TIME_ZONE, month: 'short', day: 'numeric', year: 'numeric' })
}
function etTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-US', { timeZone: TIME_ZONE, hour: 'numeric', minute: '2-digit' })
}

// Sources listed per briefing, the reading view's number
const SOURCES_SHOWN = 8

function hostOf(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, '') } catch { return '' }
}

function articleRows(r: Renderer, b: ExportBriefing, article: Article, index: number, total: number, sameDay: boolean): Row[] {
  const ctx: Ctx = { x: ML, w: CW, small: false }
  const rows: Row[] = [{ h: 0, pageBreak: true, mark: index }]

  // Date line: the date, and the time when two briefings share a day
  const date = etDateLong(b.created_at) + (sameDay ? ` · ${etTime(b.created_at)}` : '')
  const dateLine = breakLines(r.m, [{ text: date }], LABEL, CW - 90)[0]
  const countLine = breakLines(r.m, [{ text: `${index + 1} of ${total}` }], { ...LABEL, color: C.faint }, 90)[0]
  rows.push({
    h: LABEL.lineHeight,
    kwn: true,
    draw: (rr, y) => {
      rr.drawLine(dateLine, ML, y)
      rr.drawLine(countLine, ML + CW - countLine.width, y)
      rr.rule(ML, y + LABEL.lineHeight + 5, CW, C.ink, 1)
    },
  }, space(16))

  if (article.headline) {
    const lines = breakLines(r.m, article.headline, { family: 'serif', size: 21, lineHeight: 26, color: C.ink }, CW)
    rows.push(...lineRows(lines, ML, undefined, { kwnAll: true }), space(6))
  }

  for (const section of article.sections) {
    if (section.isAside) {
      const box = r.nextBox('aside', ML, CW, 10)
      const inner: Ctx = { x: ML + 13, w: CW - 26, boxes: [box], small: true }
      rows.push(space(9))
      rows.push(...labelRows(r, [{ text: 'Analyst note' }], inner))
      rows.push({ h: 3, boxes: [box] })
      rows.push(...trimSpaces(section.blocks.flatMap((bl) => blockRows(r, bl, inner))))
      rows.push(space(9))
      continue
    }
    if (section.title) {
      rows.push(space(12), ...labelRows(r, section.title, ctx), space(3))
    }
    rows.push(...section.blocks.flatMap((bl) => blockRows(r, bl, ctx)))
  }

  // Source attribution as in the reading view: the first 8 sources, linked,
  // then a count of the rest
  const seen = new Set<string>()
  const sources = (b.sources ?? []).filter((s) => s?.url && !seen.has(s.url) && seen.add(s.url))
  if (sources.length) {
    const inlines: Inline[] = []
    sources.slice(0, SOURCES_SHOWN).forEach((s, i) => {
      if (i > 0) inlines.push({ text: '  ·  ' })
      const title = stripEmoji(s.title || hostOf(s.url) || s.url, r.notes).replace(/\s+/g, ' ').trim()
      inlines.push({ text: title.length > 110 ? `${title.slice(0, 107).trimEnd()}...` : title, href: s.url })
      const host = hostOf(s.url)
      if (host && host !== title) inlines.push({ text: ` (${host})` })
    })
    const style: TextStyle = { family: 'sans', size: 7.25, lineHeight: 10.5, color: C.faint, linkColor: C.muted }
    rows.push(space(16), ...labelRows(r, [{ text: `Sources · ${sources.length}` }], ctx, C.muted), space(4))
    rows.push(...lineRows(breakLines(r.m, inlines, style, CW), ML, undefined))
    const more = sources.length - SOURCES_SHOWN
    if (more > 0) {
      rows.push(space(3), ...lineRows(breakLines(r.m, [{ text: `${more} more source${more === 1 ? '' : 's'} in the reading view.`, italic: true }], { ...style, family: 'serif', size: 8, lineHeight: 11 }, CW), ML, undefined))
    }
  }
  return rows
}

function contentsRows(r: Renderer, briefings: ExportBriefing[], titles: string[], startPages: number[]): Row[] {
  const rows: Row[] = [{ h: 0, pageBreak: true }]
  const title = breakLines(r.m, [{ text: 'Contents' }], { family: 'serif', size: 24, lineHeight: 30, color: C.ink }, CW)[0]
  rows.push({
    h: 30,
    draw: (rr, y) => {
      rr.drawLine(title, ML, y)
      rr.rule(ML, y + 36, CW, C.ink, 1)
      rr.rule(ML, y + 38.5, CW, C.ink, 0.5)
    },
  }, space(22))

  const dateW = 86
  const numW = 34
  const titleStyle: TextStyle = { family: 'serif', size: 10.5, lineHeight: 14.5, color: C.ink }
  const metaStyle: TextStyle = { family: 'sans', size: 7.5, lineHeight: 14.5, color: C.muted, tracking: 0.6, uppercase: true }
  briefings.forEach((b, i) => {
    const dest = `briefing-${i}`
    const lines = breakLines(r.m, [{ text: titles[i] }], titleStyle, CW - dateW - numW)
    const date = breakLines(r.m, [{ text: etDateShort(b.created_at) }], metaStyle, dateW)[0]
    const h = lines.length * titleStyle.lineHeight + 9
    rows.push({
      h,
      draw: (rr, y) => {
        rr.drawLine(date, ML, y + 4.5)
        lines.forEach((line, li) => rr.drawLine(line, ML + dateW, y + 4.5 + li * titleStyle.lineHeight))
        // Page numbers are filled in after the briefings are paginated
        const num = breakLines(rr.m, [{ text: String(startPages[i]) }], { ...metaStyle, size: 9, color: C.ink, tracking: 0 }, numW)[0]
        rr.drawLine(num, ML + CW - num.width, y + 4.5)
        rr.doc.goTo(ML, y, CW, h, dest)
        rr.rule(ML, y + h, CW)
      },
    })
  })
  return rows
}

function drawCover(r: Renderer, input: ChannelPdfInput, span: string) {
  const { doc } = r
  doc.rect(0, 0, W, H).fill(C.paper)
  const center = (text: string, style: TextStyle, y: number) => {
    const line = breakLines(r.m, [{ text }], style, CW)
    line.forEach((l, i) => r.drawLine(l, ML + (CW - l.width) / 2, y + i * style.lineHeight))
    return line.length * style.lineHeight
  }
  let y = 230
  r.rule(ML, y, CW, C.ink, 0.5)
  y += 14
  y += center('PULSE', { family: 'serif', size: 54, lineHeight: 62, color: C.ink, tracking: 6 }, y)
  y += 4
  y += center('Your morning intelligence briefing', { ...LABEL, color: C.muted, tracking: 2.4 }, y)
  y += 10
  r.rule(ML, y, CW, C.ink, 2)
  y += 64
  y += center(input.channelName, { family: 'serif', size: 30, lineHeight: 36, color: C.ink }, y)
  y += 14
  y += center(span, { family: 'serif', italic: true, size: 13, lineHeight: 18, color: C.body }, y)
  y += 26
  const n = input.briefings.length
  center(`${input.rangeLabel} · ${n} briefing${n === 1 ? '' : 's'}`, { ...LABEL, size: 8, color: C.accent }, y)
  center(`Exported ${etDate(input.generatedAt ?? new Date())}`, { ...LABEL, color: C.muted }, H - 96)
}

function drawFooter(r: Renderer, channelName: string, pageNo: number) {
  r.rule(ML, FOOTER_RULE_Y, CW)
  const style: TextStyle = { family: 'sans', size: 7, lineHeight: 10, color: C.muted, tracking: 1.4, uppercase: true }
  const name = breakLines(r.m, [{ text: channelName }], style, CW - 60)[0]
  const num = breakLines(r.m, [{ text: String(pageNo) }], { ...style, size: 8, tracking: 0 }, 60)[0]
  if (name) r.drawLine(name, ML, FOOTER_RULE_Y + 6)
  r.drawLine(num, ML + CW - num.width, FOOTER_RULE_Y + 6)
}

function drawPage(r: Renderer, page: Page) {
  for (const f of page.fragments) {
    if (f.box.kind === 'aside') {
      r.doc.rect(f.box.x, f.top, f.box.w, f.bottom - f.top).fill(C.asideFill)
      r.doc.rect(f.box.x, f.top, 1.5, f.bottom - f.top).fill(C.accent)
    } else {
      r.doc.rect(f.box.x, f.top, 1.5, f.bottom - f.top).fill(C.accent)
    }
  }
  for (const { row, y } of page.rows) row.draw?.(r, y)
}

// ── Entry point ────────────────────────────────────────────────────────

export function coverSpan(briefings: ExportBriefing[]): string {
  if (!briefings.length) return ''
  const times = briefings.map((b) => b.created_at).sort()
  const first = etDate(times[0])
  const last = etDate(times[times.length - 1])
  return first === last ? first : `${first} to ${last}`
}

export async function renderChannelPdf(
  input: ChannelPdfInput,
  opts: { maxPages?: number; onProgress?: (p: ChannelPdfProgress) => void | Promise<void> } = {},
): Promise<ChannelPdfResult> {
  const notes: RenderNotes = new Map()
  const fonts = loadFonts()
  const doc = new PDFDocument({
    autoFirstPage: false,
    size: [W, H],
    margin: 0,
    font: path.join(FONT_DIR, FONT_FILES.serif), // never load pdfkit's built-in Helvetica
    info: {
      Title: `${input.channelName} · Pulse`,
      Author: 'Pulse',
      Subject: `${input.channelName}: ${input.briefings.length} briefings`,
      CreationDate: input.generatedAt ?? new Date(),
    },
    pdfVersion: '1.7',
    displayTitle: true,
  })
  for (const key of Object.keys(fonts) as FontKey[]) doc.registerFont(key, fonts[key])
  const r = new Renderer(doc, notes)

  const chunks: Buffer[] = []
  doc.on('data', (c: Buffer) => chunks.push(c))
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)))
    doc.on('error', reject)
  })

  // 1. Layout: every briefing's rows, paginated on their own
  const n = input.briefings.length
  const articles = input.briefings.map((b) => parseArticle(b.content, notes))
  // No useful headline: the date alone
  const titles = contentsTitles(articles, input.channelName).map((t, i) => t ?? etDateLong(input.briefings[i].created_at))
  const days = input.briefings.map((b) => etDate(b.created_at))
  const bodyPages: Page[][] = []
  for (let i = 0; i < n; i++) {
    const sameDay = days.filter((d) => d === days[i]).length > 1
    bodyPages.push(paginate(articleRows(r, input.briefings[i], articles[i], i, n, sameDay)))
    if (i % 5 === 4 || i === n - 1) await opts.onProgress?.({ phase: 'layout', done: i + 1, total: n })
  }

  // 2. Contents: its length doesn't depend on the numbers in it
  const startPages = new Array<number>(n).fill(0)
  const contentsPages = paginate(contentsRows(r, input.briefings, titles, startPages))
  let page = 2 + contentsPages.length
  bodyPages.forEach((pages, i) => { startPages[i] = page; page += pages.length })
  const pageCount = page - 1
  const briefingPages = bodyPages.map((p) => p.length)
  if (opts.maxPages && pageCount > opts.maxPages) {
    doc.end()
    throw new ChannelPdfTooLarge(pageCount, briefingPages)
  }

  // 3. Draw in order: cover, contents, briefings
  doc.addPage()
  drawCover(r, input, coverSpan(input.briefings))
  let pageNo = 1
  const all = [
    ...contentsPages.map((p) => ({ page: p })),
    ...bodyPages.flatMap((pages, i) => pages.map((p, pi) => (pi === 0
      ? { page: p, dest: `briefing-${i}`, outline: `${etDateShort(input.briefings[i].created_at)}  ${titles[i]}` }
      : { page: p }))),
  ] as { page: Page; dest?: string; outline?: string }[]
  for (const { page: p, dest, outline } of all) {
    doc.addPage()
    pageNo += 1
    if (dest) doc.addNamedDestination(dest, 'XYZ', null, H, null)
    if (outline) doc.outline.addItem(outline)
    drawPage(r, p)
    drawFooter(r, input.channelName, pageNo)
    if (pageNo % 20 === 0 || pageNo === pageCount) await opts.onProgress?.({ phase: 'draw', done: pageNo, total: pageCount })
  }
  doc.end()
  const pdf = await done
  return { pdf, pageCount, startPages, briefingPages, notes }
}

// Rough page estimate for the export sheet, before any layout: stored
// characters per page, fitted Oct 28 2026 to real renders of six channels
// (94 briefings, 547 pages): within about 10% per channel. The 8-source block
// mostly fits on a briefing's last page, so sources don't count. The limit
// check itself uses the real layout.
export function estimatePages(briefings: { contentLength: number }[]): number {
  if (!briefings.length) return 0
  const contents = Math.ceil(briefings.length / 24)
  const body = briefings.reduce((s, b) => s + Math.max(1, Math.ceil(b.contentLength / CHARS_PER_PAGE)), 0)
  return 1 + contents + body
}
const CHARS_PER_PAGE = 2400
