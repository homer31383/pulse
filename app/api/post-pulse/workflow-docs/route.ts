import { NextRequest } from 'next/server'
import { createWorkflowDoc, fetchDepartmentById, fetchPostPulseDataset, getChatSession } from '@/lib/post-pulse'
import { generateWorkflowTitle, matchReferencedTools } from '@/lib/post-pulse-workflows'
import { anthropic } from '@/lib/anthropic'
import { calculateCost } from '@/lib/cost'
import { logUsage } from '@/lib/usage'

const TITLE_MODEL = 'claude-haiku-4-5'

// A short title from the prompt when the heuristic couldn't find a subject
// phrase (statements, multi-part prompts). Haiku, ~a hundred tokens; falls
// back to the heuristic on any failure.
async function summarizeTitle(prompt: string, fallback: string): Promise<string> {
  try {
    const res = await anthropic.messages.create({
      model: TITLE_MODEL,
      max_tokens: 60,
      system:
        'Write a title of at most eight words for a saved research note, naming its subject the way a document title would ("Single-image to Gaussian splat pipeline"). Title case is fine, no quotes, no trailing period, no preamble — output the title only.',
      messages: [{ role: 'user', content: `The note answers this prompt:\n\n${prompt.slice(0, 2000)}` }],
    })
    logUsage({
      callType: 'pp_workflow_title',
      channelName: 'Post Pulse research',
      model: TITLE_MODEL,
      inputTokens: res.usage.input_tokens,
      outputTokens: res.usage.output_tokens,
      costUsd: calculateCost(TITLE_MODEL, res.usage.input_tokens, res.usage.output_tokens),
    }).catch(() => {})
    const text = res.content
      .filter((b): b is { type: 'text'; text: string } & typeof b => b.type === 'text')
      .map((b) => b.text)
      .join(' ')
      .replace(/^["'\s]+|["'\s.]+$/g, '')
      .split('\n')[0]
      .trim()
    return text && text.length <= 120 ? text : fallback
  } catch {
    return fallback
  }
}

export const dynamic = 'force-dynamic'

// POST { sessionId, messageIndex, departmentId, title?, titleAuto?, startIndex? }
// Saves a workflow doc (spec §11) from the stored session so the client
// can't drift. Scope: by default the assistant message at messageIndex
// with the user message before it; with startIndex (a user message at or
// before that pair) the whole slice from startIndex through messageIndex
// is kept as a conversation (migration 032). prompt = first user message
// of the slice, content = the final answer; sources = the union of the
// slice's search results; referenced tools matched over every assistant
// message in the slice against the department's roster + related ones.
export async function POST(req: NextRequest) {
  let body: { sessionId?: unknown; messageIndex?: unknown; departmentId?: unknown; title?: unknown; titleAuto?: unknown; startIndex?: unknown }
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  if (typeof body.sessionId !== 'string' || typeof body.messageIndex !== 'number' || typeof body.departmentId !== 'string') {
    return Response.json({ error: 'sessionId, messageIndex, and departmentId are required' }, { status: 400 })
  }

  const [session, department] = await Promise.all([getChatSession(body.sessionId), fetchDepartmentById(body.departmentId)])
  if (!session) return Response.json({ error: 'Session not found' }, { status: 404 })
  if (!department) return Response.json({ error: 'Department not found' }, { status: 404 })

  const message = session.messages[body.messageIndex]
  if (!message || message.role !== 'assistant') {
    return Response.json({ error: 'messageIndex must point at an assistant message' }, { status: 400 })
  }
  // The pair's own prompt: nearest user message before the answer.
  let pairStart = -1
  for (let i = body.messageIndex - 1; i >= 0; i--) {
    if (session.messages[i].role === 'user') {
      pairStart = i
      break
    }
  }
  if (pairStart < 0) return Response.json({ error: 'No user prompt precedes that message' }, { status: 400 })
  // Optional wider scope: start at an earlier user message.
  let start = pairStart
  if (typeof body.startIndex === 'number') {
    const s = body.startIndex
    if (!Number.isInteger(s) || s < 0 || s > pairStart || session.messages[s]?.role !== 'user') {
      return Response.json({ error: 'startIndex must be a user message at or before the answer\'s own prompt' }, { status: 400 })
    }
    start = s
  }
  const slice = session.messages.slice(start, body.messageIndex + 1)
  const isConversation = start < pairStart
  const prompt = session.messages[start].content
  const assistantText = slice.filter((m) => m.role === 'assistant').map((m) => m.content).join('\n\n')
  const sourceUrls = Array.from(new Set(slice.flatMap((m) => (m.sources ?? []).map((s) => s.url))))

  const dataset = await fetchPostPulseDataset()
  const rosterDeptIds = new Set([department.id, ...department.related_department_ids])
  const roster = dataset.tools.filter((t) => rosterDeptIds.has(t.department_id)).map((t) => ({ id: t.id, name: t.name }))

  // Title: the user's edit wins; an untouched heuristic title that only
  // clipped the prompt is replaced by a real summary.
  const heuristic = generateWorkflowTitle(prompt)
  const userTitle = typeof body.title === 'string' && body.title.trim() ? body.title.trim() : null
  const title =
    userTitle && body.titleAuto !== true
      ? userTitle
      : heuristic.confident
        ? heuristic.title
        : await summarizeTitle(prompt, userTitle ?? heuristic.title)

  const result = await createWorkflowDoc({
    departmentId: department.id,
    title,
    prompt,
    content: message.content,
    messages: isConversation ? slice.map((m) => ({ role: m.role, content: m.content })) : [],
    referencedToolIds: matchReferencedTools(assistantText, roster),
    sourceUrls,
    sourceChatSessionId: session.id,
  })
  if ('error' in result) return Response.json({ error: result.error }, { status: result.status ?? 500 })
  return Response.json({ id: result.id, departmentSlug: department.slug }, { status: 201 })
}
