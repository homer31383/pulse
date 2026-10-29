// Server-only: several channels' briefings as one "Channel archive" PDF, or
// as volumes when they don't fit one file. Built from the channel export's
// own pieces (lib/pdf/channel-pdf). A first pass lays out every briefing and
// keeps only its page count; the volume plan is made from those exact
// counts. Each volume then lays out its own briefings again (layout is
// deterministic) and checks the total against the plan, so memory is bounded
// by one volume and a plan's page numbers are the file's page numbers.
// Nothing here touches the database or the network.
import PDFDocument from 'pdfkit'
import path from 'node:path'
import { contentsTitles, parseArticle, type RenderNotes } from './briefing-blocks'
import {
  C, CW, FONT_DIR, FONT_FILES, H, LABEL, ML, Renderer, W,
  articleRows, breakLines, contentsRows, coverSpan, drawFooter, drawPage, etDate, etDateLong, etDateShort,
  loadFonts, paginate, space,
  type ExportBriefing, type FontKey, type Page, type Row, type TextStyle,
} from './channel-pdf'

export interface ArchiveChannelInput {
  id: string
  name: string
  briefings: ExportBriefing[] // already in reading order
}

export interface ArchiveLimits { maxPages: number; maxBriefings: number }

// One channel, or one date slice of a channel too big for a volume alone
export interface VolumePart {
  channel: number // index into the laid-out channels
  from: number    // slice of that channel's briefings, end exclusive
  to: number
  part: number    // 1-based; parts = 1 when the channel isn't split
  parts: number
}

export interface VolumePlan { parts: VolumePart[]; pages: number; briefings: number }

interface LaidChannel {
  id: string
  name: string
  briefings: ExportBriefing[]
  titles: string[]      // contents titles, chosen across the channel's whole selection
  sameDay: boolean[]    // shares its ET day with another briefing (date line gets the time)
  pageCounts: number[]  // pages each briefing takes
}

export interface ArchiveLayout {
  channels: LaidChannel[]
  volumes: VolumePlan[]
  notes: RenderNotes
}

export type ArchiveProgress =
  | { phase: 'layout'; done: number; total: number }
  | { phase: 'draw'; done: number; total: number }

function newDoc(info?: PDFKit.DocumentInfo): PDFKit.PDFDocument {
  const doc = new PDFDocument({
    autoFirstPage: false,
    size: [W, H],
    margin: 0,
    font: path.join(FONT_DIR, FONT_FILES.serif), // never load pdfkit's built-in Helvetica
    info,
    pdfVersion: '1.7',
    displayTitle: true,
  })
  const fonts = loadFonts()
  for (const key of Object.keys(fonts) as FontKey[]) doc.registerFont(key, fonts[key])
  return doc
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

function partLabel(p: VolumePart): string {
  return p.parts > 1 ? `part ${p.part} of ${p.parts}` : ''
}

function partBriefings(ch: LaidChannel, p: VolumePart): ExportBriefing[] {
  return ch.briefings.slice(p.from, p.to)
}

// ── Rows ───────────────────────────────────────────────────────────────

const HEADING: TextStyle = { family: 'serif', size: 24, lineHeight: 30, color: C.ink }

// The archive's own contents: one row per channel (or channel part), linked
// to its divider page
function topContentsRows(r: Renderer, channels: LaidChannel[], parts: VolumePart[], dividerPages: number[]): Row[] {
  const rows: Row[] = [{ h: 0, pageBreak: true }]
  const title = breakLines(r.m, [{ text: 'Contents' }], HEADING, CW)[0]
  rows.push({
    h: 30,
    draw: (rr, y) => {
      rr.drawLine(title, ML, y)
      rr.rule(ML, y + 36, CW, C.ink, 1)
      rr.rule(ML, y + 38.5, CW, C.ink, 0.5)
    },
  }, space(22))

  const numW = 34
  const nameStyle: TextStyle = { family: 'serif', size: 13, lineHeight: 17, color: C.ink }
  const metaStyle: TextStyle = { family: 'sans', size: 7.5, lineHeight: 11, color: C.muted, tracking: 0.6, uppercase: true }
  parts.forEach((p, k) => {
    const ch = channels[p.channel]
    const list = partBriefings(ch, p)
    const names = breakLines(r.m, [{ text: ch.name }], nameStyle, CW - numW)
    const meta = [plural(list.length, 'briefing'), coverSpan(list), partLabel(p)].filter(Boolean).join(' · ')
    const metaLines = breakLines(r.m, [{ text: meta }], metaStyle, CW - numW)
    const h = names.length * nameStyle.lineHeight + metaLines.length * metaStyle.lineHeight + 16
    rows.push({
      h,
      draw: (rr, y) => {
        let yy = y + 6
        names.forEach((line) => { rr.drawLine(line, ML, yy); yy += nameStyle.lineHeight })
        metaLines.forEach((line) => { rr.drawLine(line, ML, yy + 1); yy += metaStyle.lineHeight })
        // Filled in once every channel is paginated
        const num = breakLines(rr.m, [{ text: String(dividerPages[k]) }], { ...metaStyle, size: 10, color: C.ink, tracking: 0 }, numW)[0]
        rr.drawLine(num, ML + CW - num.width, y + 8)
        rr.doc.goTo(ML, y, CW, h, `ch-${k}`)
        rr.rule(ML, y + h, CW)
      },
    })
  })
  return rows
}

// A channel's own contents: the single-channel contents with the channel
// named above it
function channelContentsRows(r: Renderer, ch: LaidChannel, p: VolumePart, k: number, startPages: number[]): Row[] {
  const rows = contentsRows(r, partBriefings(ch, p), ch.titles.slice(p.from, p.to), startPages, (i) => `c${k}-b${i}`)
  const label = breakLines(r.m, [{ text: [ch.name, partLabel(p)].filter(Boolean).join(' · ') }], LABEL, CW)
  const labelRows: Row[] = label.map((line) => ({ h: LABEL.lineHeight, kwn: true, draw: (rr, y) => rr.drawLine(line, ML, y) }))
  return [rows[0], ...labelRows, space(8), ...rows.slice(1)]
}

function drawDivider(r: Renderer, ch: LaidChannel, p: VolumePart, k: number, count: number) {
  const center = (text: string, style: TextStyle, y: number) => {
    const lines = breakLines(r.m, [{ text }], style, CW)
    lines.forEach((l, i) => r.drawLine(l, ML + (CW - l.width) / 2, y + i * style.lineHeight))
    return lines.length * style.lineHeight
  }
  const list = partBriefings(ch, p)
  let y = 250
  y += center(`Channel ${k + 1} of ${count}`, { ...LABEL, color: C.muted, tracking: 2.4 }, y)
  y += 10
  r.rule(ML, y, CW, C.ink, 0.5)
  y += 30
  y += center(ch.name, { family: 'serif', size: 32, lineHeight: 38, color: C.ink }, y)
  y += 12
  y += center(coverSpan(list), { family: 'serif', italic: true, size: 13, lineHeight: 18, color: C.body }, y)
  y += 22
  y += center([plural(list.length, 'briefing'), partLabel(p)].filter(Boolean).join(' · '), { ...LABEL, size: 8, color: C.accent }, y)
  y += 16
  r.rule(ML, y, CW, C.ink, 2)
}

interface CoverInfo { rangeLabel: string; volume: number; volumes: number; channelCount: number; briefingCount: number; span: string; generatedAt: Date }

function drawArchiveCover(r: Renderer, info: CoverInfo) {
  const { doc } = r
  doc.rect(0, 0, W, H).fill(C.paper)
  const center = (text: string, style: TextStyle, y: number) => {
    const lines = breakLines(r.m, [{ text }], style, CW)
    lines.forEach((l, i) => r.drawLine(l, ML + (CW - l.width) / 2, y + i * style.lineHeight))
    return lines.length * style.lineHeight
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
  y += center('Channel archive', { family: 'serif', size: 30, lineHeight: 36, color: C.ink }, y)
  if (info.volumes > 1) {
    y += 8
    y += center(`Volume ${info.volume} of ${info.volumes}`, { ...LABEL, size: 9, color: C.ink, tracking: 2 }, y)
  }
  y += 14
  y += center(info.span, { family: 'serif', italic: true, size: 13, lineHeight: 18, color: C.body }, y)
  y += 26
  center(`${info.rangeLabel} · ${plural(info.channelCount, 'channel')} · ${plural(info.briefingCount, 'briefing')}`, { ...LABEL, size: 8, color: C.accent }, y)
  center(`Exported ${etDate(info.generatedAt)}`, { ...LABEL, color: C.muted }, H - 96)
}

// ── Layout and plan ────────────────────────────────────────────────────

export async function layoutArchive(
  input: ArchiveChannelInput[],
  limits: ArchiveLimits,
  onProgress?: (p: ArchiveProgress) => void | Promise<void>,
): Promise<ArchiveLayout> {
  const notes: RenderNotes = new Map()
  // Measuring only: nothing is drawn on this document
  const doc = newDoc()
  const r = new Renderer(doc, notes)
  const total = input.reduce((s, c) => s + c.briefings.length, 0)
  let done = 0

  const channels: LaidChannel[] = []
  for (const c of input) {
    if (!c.briefings.length) continue
    const articles = c.briefings.map((b) => parseArticle(b.content, notes))
    // Same titles and "N of M" as the channel's own export
    const titles = contentsTitles(articles, c.name).map((t, i) => t ?? etDateLong(c.briefings[i].created_at))
    const days = c.briefings.map((b) => etDate(b.created_at))
    const sameDay = days.map((d) => days.filter((x) => x === d).length > 1)
    const pageCounts: number[] = []
    for (let i = 0; i < c.briefings.length; i++) {
      pageCounts.push(paginate(articleRows(r, c.briefings[i], articles[i], i, c.briefings.length, sameDay[i])).length)
      done += 1
      if (done % 10 === 0 || done === total) await onProgress?.({ phase: 'layout', done, total })
    }
    channels.push({ id: c.id, name: c.name, briefings: c.briefings, titles, sameDay, pageCounts })
  }
  doc.end()

  const volumes = planVolumes(r, channels, limits)
  return { channels, volumes, notes }
}

// Exact page count of a volume holding these parts
function volumePages(r: Renderer, channels: LaidChannel[], parts: VolumePart[], blockCache: Map<string, number>): number {
  let pages = 1 + paginate(topContentsRows(r, channels, parts, parts.map(() => 0))).length
  for (const p of parts) {
    const key = `${p.channel}:${p.from}:${p.to}:${p.part}:${p.parts}`
    let block = blockCache.get(key)
    if (block === undefined) {
      const ch = channels[p.channel]
      block = 1 + paginate(channelContentsRows(r, ch, p, 0, new Array(p.to - p.from).fill(0))).length
      for (let i = p.from; i < p.to; i++) block += ch.pageCounts[i]
      blockCache.set(key, block)
    }
    pages += block
  }
  return pages
}

// Volumes break at channel boundaries. Only a channel too big for a volume
// on its own is cut, by whole ET days, into parts that each fill a volume.
function planVolumes(r: Renderer, channels: LaidChannel[], limits: ArchiveLimits): VolumePlan[] {
  const cache = new Map<string, number>()
  const count = (parts: VolumePart[]) => parts.reduce((s, p) => s + p.to - p.from, 0)
  const fits = (parts: VolumePart[]) => count(parts) <= limits.maxBriefings && volumePages(r, channels, parts, cache) <= limits.maxPages
  const plans: VolumePart[][] = []
  let cur: VolumePart[] = []
  const flush = () => { if (cur.length) plans.push(cur); cur = [] }

  channels.forEach((ch, ci) => {
    const whole: VolumePart = { channel: ci, from: 0, to: ch.briefings.length, part: 1, parts: 1 }
    if (fits([...cur, whole])) { cur.push(whole); return }
    flush()
    if (fits([whole])) { cur = [whole]; return }

    // Runs of briefings on the same ET day, in reading order
    const groups: { from: number; to: number }[] = []
    ch.briefings.forEach((b, i) => {
      const day = etDate(b.created_at)
      const last = groups[groups.length - 1]
      if (last && etDate(ch.briefings[last.from].created_at) === day) last.to = i + 1
      else groups.push({ from: i, to: i + 1 })
    })
    // Part numbers are set once the cut is known; a provisional "part 1 of
    // 2" keeps the measured label as long as the real one
    const cuts: { from: number; to: number }[] = []
    let start = 0
    for (const g of groups) {
      const trial: VolumePart = { channel: ci, from: start, to: g.to, part: 1, parts: 2 }
      if (g.from > start && !fits([trial])) { cuts.push({ from: start, to: g.from }); start = g.from }
    }
    cuts.push({ from: start, to: ch.briefings.length })
    const parts = cuts.map((c, i) => ({ channel: ci, from: c.from, to: c.to, part: i + 1, parts: cuts.length }))
    for (const p of parts) {
      if (!fits([p])) throw new Error(`${ch.name}: one day's briefings are more than a volume can hold`)
    }
    parts.slice(0, -1).forEach((p) => plans.push([p]))
    // The last part can share its volume with the channels after it
    cur = [parts[parts.length - 1]]
  })
  flush()
  return plans.map((parts) => ({ parts, pages: volumePages(r, channels, parts, cache), briefings: count(parts) }))
}

// ── Drawing one volume ─────────────────────────────────────────────────

export async function renderArchiveVolume(
  layout: ArchiveLayout,
  index: number, // 0-based
  meta: { rangeLabel: string; generatedAt?: Date },
  onProgress?: (p: ArchiveProgress) => void | Promise<void>,
): Promise<{ pdf: Buffer; pageCount: number }> {
  const plan = layout.volumes[index]
  const volumes = layout.volumes.length
  const { channels } = layout
  const title = volumes > 1 ? `Pulse archive vol ${index + 1} of ${volumes}` : 'Pulse archive'
  const generatedAt = meta.generatedAt ?? new Date()
  const doc = newDoc({
    Title: title,
    Author: 'Pulse',
    Subject: `${plural(plan.parts.length, 'channel')}, ${plural(plan.briefings, 'briefing')}`,
    CreationDate: generatedAt,
  })
  // Notes were counted by the layout pass; this volume's re-layout would
  // count them again
  const r = new Renderer(doc, new Map())
  const chunks: Buffer[] = []
  doc.on('data', (c: Buffer) => chunks.push(c))
  const finished = new Promise<Buffer>((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)))
    doc.on('error', reject)
  })

  // Contents first with placeholder numbers, then count pages and fill them in
  const dividerPages = plan.parts.map(() => 0)
  const topPages = paginate(topContentsRows(r, channels, plan.parts, dividerPages))
  let page = 2 + topPages.length
  let laid = 0
  const blocks: { p: VolumePart; ch: LaidChannel; contents: Page[]; bodies: Page[][] }[] = []
  for (const [k, p] of plan.parts.entries()) {
    const ch = channels[p.channel]
    const bodies: Page[][] = []
    for (let i = p.from; i < p.to; i++) {
      const b = ch.briefings[i]
      bodies.push(paginate(articleRows(r, b, parseArticle(b.content, new Map()), i, ch.briefings.length, ch.sameDay[i])))
      laid += 1
      if (laid % 10 === 0 || laid === plan.briefings) await onProgress?.({ phase: 'layout', done: laid, total: plan.briefings })
    }
    const startPages = new Array<number>(p.to - p.from).fill(0)
    const contents = paginate(channelContentsRows(r, ch, p, k, startPages))
    dividerPages[k] = page
    page += 1 + contents.length
    bodies.forEach((pages, i) => { startPages[i] = page; page += pages.length })
    blocks.push({ p, ch, contents, bodies })
  }
  const pageCount = page - 1
  if (pageCount !== plan.pages) throw new Error(`Volume ${index + 1}: planned ${plan.pages} pages, laid out ${pageCount}`)

  const footer = volumes > 1 ? `Channel archive · Volume ${index + 1} of ${volumes}` : 'Channel archive'
  const all = plan.parts.flatMap((p) => partBriefings(channels[p.channel], p))
  doc.addPage()
  drawArchiveCover(r, {
    rangeLabel: meta.rangeLabel, volume: index + 1, volumes,
    channelCount: new Set(plan.parts.map((p) => p.channel)).size, briefingCount: plan.briefings,
    span: coverSpan(all), generatedAt,
  })
  let pageNo = 1
  const next = async () => {
    doc.addPage()
    pageNo += 1
    if (pageNo % 20 === 0 || pageNo === pageCount) await onProgress?.({ phase: 'draw', done: pageNo, total: pageCount })
  }
  for (const p of topPages) {
    await next()
    drawPage(r, p)
    drawFooter(r, footer, pageNo)
  }
  for (const [k, { p, ch, contents, bodies }] of blocks.entries()) {
    await next()
    doc.addNamedDestination(`ch-${k}`, 'XYZ', null, H, null)
    const group = doc.outline.addItem([ch.name, partLabel(p)].filter(Boolean).join(', '), { expanded: false })
    drawDivider(r, ch, p, k, plan.parts.length)
    drawFooter(r, ch.name, pageNo)
    for (const cp of contents) {
      await next()
      drawPage(r, cp)
      drawFooter(r, ch.name, pageNo)
    }
    for (let i = p.from; i < p.to; i++) {
      bodies[i - p.from].forEach((bp, pi) => {
        doc.addPage()
        pageNo += 1
        if (pi === 0) {
          doc.addNamedDestination(`c${k}-b${i - p.from}`, 'XYZ', null, H, null)
          group.addItem(`${etDateShort(ch.briefings[i].created_at)}  ${ch.titles[i]}`)
        }
        drawPage(r, bp)
        drawFooter(r, ch.name, pageNo)
      })
      if (i % 5 === 4 || i === p.to - 1) await onProgress?.({ phase: 'draw', done: pageNo, total: pageCount })
    }
  }
  doc.end()
  return { pdf: await finished, pageCount }
}
