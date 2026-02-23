/**
 * Strip markdown formatting from text, leaving plain prose suitable for TTS.
 */
export function stripMarkdown(text: string): string {
  return text
    // Fenced code blocks
    .replace(/```[\s\S]*?```/g, '')
    // Inline code → bare text
    .replace(/`([^`]+)`/g, '$1')
    // Headings
    .replace(/^#{1,6}\s+/gm, '')
    // Bold + italic (up to 3 stars/underscores)
    .replace(/\*{1,3}([^*\n]+)\*{1,3}/g, '$1')
    .replace(/_{1,3}([^_\n]+)_{1,3}/g, '$1')
    // Links [text](url) → text
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    // Images ![alt](url) → (dropped)
    .replace(/!\[[^\]]*\]\([^)]+\)/g, '')
    // List markers (- item  /  * item  /  1. item)
    .replace(/^[ \t]*[-*+]\s+/gm, '')
    .replace(/^[ \t]*\d+\.\s+/gm, '')
    // Blockquotes
    .replace(/^>\s*/gm, '')
    // Horizontal rules
    .replace(/^[-*_]{3,}\s*$/gm, '')
    // Collapse 3+ newlines to two
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/**
 * Split plain text into sentences.
 * Returns both the sentence strings and their byte-offsets in the original text
 * so that charIndex from SpeechSynthesisUtterance.onboundary can be mapped back
 * to the correct sentence.
 */
export function splitSentences(text: string): { sentences: string[]; starts: number[] } {
  const sentences: string[] = []
  const starts: number[] = []

  // Split at whitespace that follows a sentence-ending punctuation (.!?) and
  // precedes an uppercase letter or the end of the string.
  // Using a loop with exec() for wider compatibility than matchAll.
  const re = /[.!?]+(?=\s+[A-Z]|\s*$)/g
  let lastEnd = 0

  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    const end = m.index + m[0].length
    const sentence = text.slice(lastEnd, end).trim()
    if (sentence.length > 0) {
      starts.push(lastEnd)
      sentences.push(sentence)
    }
    // Advance past the boundary whitespace
    lastEnd = end
    // Skip over whitespace between sentences
    while (lastEnd < text.length && /\s/.test(text[lastEnd])) {
      lastEnd++
    }
    re.lastIndex = lastEnd
  }

  // Any remainder after the last boundary
  const remainder = text.slice(lastEnd).trim()
  if (remainder.length > 0) {
    starts.push(lastEnd)
    sentences.push(remainder)
  }

  // Fallback: if nothing was split, return the whole text as one sentence
  if (sentences.length === 0 && text.trim().length > 0) {
    return { sentences: [text.trim()], starts: [0] }
  }

  return { sentences, starts }
}
