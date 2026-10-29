// Shared markdown structure for briefings/digests: an optional `#` headline,
// then `##` sections, some of which are "analyst note" asides. Used by the
// broadsheet renderer (PressArticle) and the speech script builder
// (lib/speechScript.ts), so spoken chapters always match visual sections.

export interface PressSection {
  title: string | null // null for the lead block before any heading
  body: string
  isAside: boolean     // Key Takeaways / analysis → analyst-note treatment
}

const ASIDE_TITLE = /takeaway|analys|insight|outlook|assessment|bottom line/i

export interface ParseOptions {
  // Titles that must never be treated as asides — e.g. a digest's channel
  // names ("Ethereum & RWA Outlook" is a story, not an analyst note).
  neverAside?: string[]
}

// Split markdown into an optional headline, then ## sections. Code fences kept intact.
export function parsePressSections(md: string, opts: ParseOptions = {}): { headline: string | null; sections: PressSection[] } {
  const never = new Set((opts.neverAside ?? []).map((n) => n.trim().toLowerCase()))
  const lines = md.split('\n')
  let headline: string | null = null
  const sections: PressSection[] = []
  let currentTitle: string | null = null
  let currentBody: string[] = []
  let inFence = false
  let seenContent = false

  function flush() {
    const body = currentBody.join('\n').trim()
    if (body || currentTitle) {
      const t = currentTitle?.trim().toLowerCase() ?? ''
      sections.push({
        title: currentTitle,
        body,
        isAside: currentTitle !== null && ASIDE_TITLE.test(currentTitle) && !never.has(t),
      })
    }
    currentBody = []
  }

  for (const line of lines) {
    if (/^\s*(```|~~~)/.test(line)) inFence = !inFence

    if (!inFence && !seenContent && /^#\s+(?!#)/.test(line.trim())) {
      headline = line.trim().replace(/^#\s+/, '')
      seenContent = true
      continue
    }
    if (!inFence && /^##\s+(?!#)/.test(line.trim())) {
      flush()
      currentTitle = line.trim().replace(/^##\s+/, '')
      seenContent = true
      continue
    }
    if (line.trim() !== '') seenContent = true
    currentBody.push(line)
  }
  flush()

  return { headline, sections }
}

// Sonnet 5 sometimes narrates its research between tool calls ("I have great
// material now. Let me write the briefing.") despite the prompt, and that
// text streams out as content ahead of the headline, sometimes glued to it
// on the same line ("...Parasite content.# 🎬 Classic Movies"). Every briefing
// opens with a Markdown heading, so drop everything before the first one.
// Only applied to what gets persisted; the live stream already showed it.
export function stripPreHeadingNarration(content: string): { content: string; stripped: string } {
  const candidates: number[] = []
  // Heading at the start of a line
  const lineStart = /(?:^|\n)[ \t]{0,3}(#{1,6}[ \t]+\S)/.exec(content)
  if (lineStart) candidates.push(lineStart.index + lineStart[0].length - lineStart[1].length)
  // Heading glued to the end of a narration sentence, including one that
  // ends in a colon ("...round out the digest:# Morning Digest")
  const glued = /[.!?)`*:][ \t]*(#{1,6}[ \t]+\S)/.exec(content)
  if (glued) candidates.push(glued.index + glued[0].length - glued[1].length)
  if (candidates.length === 0) return { content, stripped: '' }
  const idx = Math.min(...candidates)
  const stripped = content.slice(0, idx)
  if (!stripped.trim()) return { content, stripped: '' }
  return { content: content.slice(idx), stripped }
}
