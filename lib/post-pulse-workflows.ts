// Post Pulse workflow docs (spec §11) — client-safe helpers.
// A workflow doc is a prompt-and-answer pair saved from chat, filed under
// one department. These helpers derive its title and its referenced tools;
// staleness is computed server-side against pp_changelog at display time.

// A short title from the original user prompt: strip the question scaffold
// ("what is a possible workflow for…", "how do I…"), keep the subject.
// Heuristic on purpose (no model call); the save form lets the user edit it.
const LEADING = [
  /^(please|hey|hi|ok|okay|so)[,\s]+/i,
  /^(can|could|would) you (please )?(tell me|explain|describe|give me|suggest|outline|walk me through|help me (with|understand))\s+/i,
  /^(what|which|how|where|when|why)('s| is| are| do i| do we| does| would| should| could| can)?\s+(a |an |the )?(possible |good |best |typical |standard |recommended )?(workflow|pipeline|approach|way|process|setup|method|options?|tools?)?\s*(for|to|of|is|are)?\s+/i,
  /^(tell me|explain|describe|give me|suggest|outline|summarize|compare)\s+(about |me )?(a |an |the )?/i,
  /^(is there|are there)\s+(a |an |any )?/i,
]

// `confident` is true when a question scaffold was actually stripped —
// i.e. the result is a subject phrase, not just a clipped prompt. When it
// is false the save API asks Haiku for a real summary instead (the form
// still prefills this heuristic so the user can type their own).
export function generateWorkflowTitle(prompt: string, max = 72): { title: string; confident: boolean } {
  let t = prompt.replace(/\s+/g, ' ').trim()
  // Use the first sentence/question only.
  const cut = t.search(/[?.!]\s|[?.!]$/)
  if (cut > 20) t = t.slice(0, cut)
  const before = t
  for (const re of LEADING) t = t.replace(re, '')
  const stripped = t !== before
  t = t.replace(/[?.!,;:]+$/g, '').trim()
  if (!t) t = prompt.trim().slice(0, max)
  let clipped = false
  if (t.length > max) {
    const cutTo = t.slice(0, max)
    t = cutTo.slice(0, Math.max(cutTo.lastIndexOf(' '), 40)).trim() + '…'
    clipped = true
  }
  return { title: t.charAt(0).toUpperCase() + t.slice(1), confident: stripped && !clipped }
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// Best-effort: which known tools does this answer mention? Matches the
// cleaned tool name and, for "A / B (…)" names, each part, as whole words,
// case-insensitively. It is a staleness signal, not a citation system.
export function matchReferencedTools(content: string, tools: { id: string; name: string }[]): string[] {
  const hay = content
  const ids: string[] = []
  for (const tool of tools) {
    const base = tool.name.replace(/\s*\(.*?\)\s*/g, ' ').replace(/\s+/g, ' ').trim()
    const parts = Array.from(new Set([base, ...base.split('/').map((p) => p.trim())])).filter((p) => p.length >= 4)
    const hit = parts.some((p) => new RegExp(`(^|[^A-Za-z0-9])${escapeRe(p)}(?=$|[^A-Za-z0-9])`, 'i').test(hay))
    if (hit) ids.push(tool.id)
  }
  return ids
}
