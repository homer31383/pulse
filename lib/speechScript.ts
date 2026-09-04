// The spoken script: what the TTS engines actually read. Built from the
// article's markdown structure (lib/press-sections) with verbal signposts
// ("Analyst note.", "First story: …") before each structural section, and
// chapter markers (sentence indices) for jump-to navigation. The stored
// article and its display are untouched. Used by both providers: the
// browser voice speaks `text` directly; ElevenLabs is sent `text` and the
// cache row records the resulting chapters and per-sentence times.
import { parsePressSections } from './press-sections'
import { splitSentences, stripMarkdown } from './speech'

// Bump when the script rules change: premium cache rows carry the version,
// and older rows are treated as misses (regenerated on next play).
export const SPEECH_SCRIPT_VERSION = 2

export interface Chapter {
  label: string          // shown on the chapter chip
  sentenceIndex: number  // first sentence of the chapter in `sentences`
}

export interface SpeechScript {
  text: string           // paragraphs joined with blank lines (chunkText-stable)
  sentences: string[]
  starts: number[]       // char offsets of each sentence in `text`
  chapters: Chapter[]
}

export interface ScriptOptions {
  channelNames?: string[]   // digest: section titles that are stories, never asides
}

const clean = (s: string) => stripMarkdown(s).replace(/\s+/g, ' ').trim()
// A label read as its own beat: ends in terminal punctuation so both engines pause after it
const beat = (s: string) => {
  const t = clean(s)
  return /[.!?:]$/.test(t) ? t : `${t}.`
}

// Body text → paragraphs, promoting `#`/`###` lines inside a section body
// (e.g. per-film headlines in a multi-part edition) to their own beats.
function bodyParagraphs(body: string): { text: string; sub: boolean }[] {
  const out: { text: string; sub: boolean }[] = []
  let buf: string[] = []
  const flush = () => {
    const t = clean(buf.join('\n'))
    if (t) out.push({ text: t, sub: false })
    buf = []
  }
  for (const raw of body.split('\n')) {
    const line = raw.trim()
    if (/^#{1,6}\s+\S/.test(line)) {
      flush()
      const t = clean(line.replace(/^#{1,6}\s+/, ''))
      if (t) out.push({ text: t, sub: true })
      continue
    }
    if (line === '') { flush(); continue }
    buf.push(raw)
  }
  flush()
  return out
}

export function buildSpeechScript(markdown: string, kind: 'briefing' | 'digest', opts: ScriptOptions = {}): SpeechScript {
  const { headline, sections } = parsePressSections(markdown, { neverAside: opts.channelNames })

  const paras: string[] = []
  const marks: { label: string; paraIndex: number }[] = []
  // A beat must start its own sentence: terminate the preceding paragraph
  // if it trails off without punctuation (a list item, a stray line), or
  // the splitter glues the label onto it and the chapter lands late.
  const pushBeat = (spoken: string, label: string) => {
    const last = paras.length - 1
    if (last >= 0 && !/[.!?:]$/.test(paras[last])) paras[last] += '.'
    marks.push({ label, paraIndex: paras.length })
    paras.push(spoken)
  }

  if (headline) pushBeat(beat(headline), clean(headline))

  let story = 0
  sections.forEach((sec, si) => {
    let body = bodyParagraphs(sec.body)
    // Older archived briefings carry the model's research narration ahead
    // of the headline (fixed at persist time since Sept 2026). In speech,
    // drop lead-block text that precedes a promoted `#` headline.
    if (si === 0 && sec.title === null && !headline) {
      const firstSub = body.findIndex((p) => p.sub)
      if (firstSub > 0) body = body.slice(firstSub)
    }
    if (sec.title !== null) {
      const title = clean(sec.title)
      if (sec.isAside) {
        pushBeat('Analyst note.', 'Analyst note')
      } else if (kind === 'digest') {
        pushBeat(`${story === 0 ? 'First' : 'Next'} story: ${beat(title)}`, title)
        story += 1
      } else {
        pushBeat(beat(title), title)
      }
    }
    for (const p of body) {
      if (p.sub) pushBeat(beat(p.text), p.text)
      else paras.push(p.text)
    }
  })

  // Assemble text while recording each paragraph's char offset
  const offsets: number[] = []
  let text = ''
  paras.forEach((p, i) => {
    if (i > 0) text += '\n\n'
    offsets.push(text.length)
    text += p
  })

  const { sentences, starts } = splitSentences(text)

  // Chapter = first sentence starting at/after the label paragraph's offset
  const chapters: Chapter[] = []
  for (const m of marks) {
    const off = offsets[m.paraIndex]
    let idx = starts.findIndex((s) => s >= off)
    if (idx < 0) idx = Math.max(0, sentences.length - 1)
    // Two beats on one sentence (an empty section): keep the later, more specific label
    if (chapters.length && chapters[chapters.length - 1].sentenceIndex === idx) { chapters[chapters.length - 1].label = m.label; continue }
    chapters.push({ label: m.label, sentenceIndex: idx })
  }

  return { text, sentences, starts, chapters }
}

// Re-locate chapters in a sentence list produced from a re-flowed copy of
// the script (e.g. after chunking), by matching each chapter's label sentence.
export function locateChapters(script: SpeechScript, sentences: string[]): Chapter[] {
  const out: Chapter[] = []
  let from = 0
  for (const ch of script.chapters) {
    const target = script.sentences[ch.sentenceIndex]
    let idx = -1
    for (let i = from; i < sentences.length; i++) {
      if (sentences[i] === target) { idx = i; break }
    }
    if (idx < 0) continue
    out.push({ label: ch.label, sentenceIndex: idx })
    from = idx + 1
  }
  return out
}
