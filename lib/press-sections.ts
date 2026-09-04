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
