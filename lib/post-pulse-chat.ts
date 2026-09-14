// Post Pulse research chat (spec §6) — server-only.
//
// One turn = a Claude conversation with two tools: the server-side
// web_search tool for research, and a client-side `propose_change` tool
// the model calls when it is confident enough to propose a new tool, a new
// department, or an edit to either. Every propose_change call writes a
// pp_queue row IN THE SAME TURN (no in-chat confirmation; review happens
// once, in the Queue view). Ambiguity must produce a question, not a
// proposal — that rule is in the system prompt as a hard rule and the tool
// handler refuses proposals it can't validate against the live dataset.
import Anthropic from '@anthropic-ai/sdk'
import { anthropic, DEFAULT_MODEL } from '@/lib/anthropic'
import { calculateCost } from '@/lib/cost'
import { logUsage } from '@/lib/usage'
import {
  enqueueProposal,
  fetchDepartmentById,
  fetchPostPulseDataset,
  updateChatSession,
} from '@/lib/post-pulse'
import { normalizeToolFields } from '@/lib/post-pulse-proposals'
import {
  PP_CHAT_DEFAULT_NAME,
  PP_DEPARTMENT_EDITABLE_FIELDS,
  PP_PIPELINE_STAGES,
  PP_PIPELINE_SUBSTAGES,
  PP_TIERS,
  PP_TOOL_EDITABLE_FIELDS,
  hostAppLabel,
  slugifyHeading,
  type PpChatMessage,
  type PpChatQueued,
  type PpChatSession,
  type PpChatSource,
  type PpDataset,
  type PpDepartment,
} from '@/lib/post-pulse-types'

// Sonnet, per the spec: tier and taxonomy calls need real reasoning, not
// extraction. Effort defaults to medium (env-overridable like the briefing
// levers) — chat is interactive, so latency matters more than on the cron.
export const PP_CHAT_MODEL = DEFAULT_MODEL
const EFFORTS = new Set(['low', 'medium', 'high', 'xhigh', 'max'])
const envEffort = process.env.PULSE_PP_CHAT_EFFORT
export const PP_CHAT_EFFORT = (EFFORTS.has(envEffort ?? '') ? envEffort : 'medium') as
  | 'low'
  | 'medium'
  | 'high'
  | 'xhigh'
  | 'max'
const MAX_SEARCHES = 6
const MAX_TOKENS = 8000
const MAX_ROUNDS = 8 // tool_use + pause_turn continuations per turn
const MAX_HISTORY_TURNS = 40

export type PpChatStreamEvent =
  | { type: 'searching'; query: string }
  | { type: 'source'; source: PpChatSource }
  | { type: 'text_delta'; text: string }
  | { type: 'queued'; item: PpChatQueued }
  | { type: 'done'; name: string; message: PpChatMessage }
  | { type: 'error'; error: string }

// ── System prompt (built from the live database every turn) ─────────────

function departmentLine(d: PpDepartment, dataset: PpDataset): string {
  const tools = dataset.tools.filter((t) => t.department_id === d.id)
  const stage = d.pipeline_stage ?? 'unmapped'
  const sub = d.pipeline_substage ? ` / ${d.pipeline_substage}` : ''
  const attrs = d.comparison_attributes.map((a) => `${a.key}:${a.type}`).join(', ') || 'none'
  const toolLines = tools.length
    ? tools
        .map(
          (t) =>
            `    - ${t.name} [${t.tier}, ${hostAppLabel(t.host_app)}, ${t.status}${t.vendor ? `, ${t.vendor}` : ''}] id=${t.id}`
        )
        .join('\n')
    : '    (no tools tracked yet)'
  const related = d.related_department_ids
    .map((id) => dataset.departments.find((x) => x.id === id)?.name)
    .filter(Boolean)
    .join(', ')
  return `- ${d.name} (slug=${d.slug}, id=${d.id}, stage=${stage}${sub}; compare attributes: ${attrs}${related ? `; related: ${related}` : ''})\n${toolLines}`
}

export function buildSystemPrompt(dataset: PpDataset, contextDepartment: PpDepartment | null): string {
  const tiers = PP_TIERS.map((t) => `- ${t.value} (${t.label}): ${t.description}`).join('\n')
  const stages = PP_PIPELINE_STAGES.map((s) => `${s.value} (${s.label})`).join(', ')
  const substages = PP_PIPELINE_SUBSTAGES.map((s) => `${s.value} (${s.label}: ${s.description})`).join('; ')
  const departments = dataset.departments.map((d) => departmentLine(d, dataset)).join('\n')

  const context = contextDepartment
    ? `\n\n## Session context: ${contextDepartment.name}\n` +
      `This session was opened from the "${contextDepartment.name}" department doc. Use it as the DEFAULT frame for ambiguous references only ("this tool", "here", "this department"). It is not a filter: a question about another department, or something unrelated to it, gets a normal, complete answer — never a redirect back to ${contextDepartment.name}.\n\n` +
      `Current overview doc for ${contextDepartment.name}:\n"""\n${contextDepartment.overview_doc.trim() || '(empty)'}\n"""` +
      (contextDepartment.follow_up_sources.length
        ? `\n\nThe last research pass for ${contextDepartment.name} recommended starting the next look at these sources: ${contextDepartment.follow_up_sources.map((f) => f.source).join('; ')}. If the user asks you to research this department, check those first.`
        : '')
    : ''

  return (
    `You are the research assistant for Post Pulse, a structured reference of AI tools across the commercial VFX pipeline. ` +
    `It has three layers: department docs (long-form markdown with the reasoning, split into Tier 1 / Tier 2 / Tier 3 sections), ` +
    `tool entries (structured rows with a one-line blurb that deep-link into the department doc for the "why"), and a review queue that gates every change to the data.\n\n` +
    `Your job: research tools people ask about, decide where they fit (department, tier, host app), explain the reasoning, and file proposals when you are confident. Be conversational, direct, and concise. Markdown is fine. Cite the sources you relied on with plain links.\n\n` +
    `## Tiers — the reasoning framework used throughout this dataset\n${tiers}\n` +
    `Tier 3 (artist_led) means the work requires DIRECTED CREATIVE JUDGMENT — someone has to make the creative call, art-direct the result, or own the taste. It does not mean "AI can't do it at all"; AI may touch the edges (defaults, first passes, cleanup) and the department still sits at Tier 3. ` +
    `Tier 1 (automated) means the tool does the work end to end and a human only reviews. Tier 2 (assisted) is everything where AI takes a real share of the labour but an artist drives and finishes it. Ask: who makes the creative call, and who does the labour?\n\n` +
    `## Pipeline\nStages: ${stages}. Post-production sub-groups: ${substages}. Pre-production, production, and finishing & delivery are intentionally empty so far — that is a real gap in coverage, not a bug, and a new department there is a legitimate proposal.\n\n` +
    `## Departments and tools currently tracked (live from the database)\n${departments}\n\n` +
    `## Hard rule: confidence before proposals\n` +
    `Only call propose_change when you can confidently resolve WHAT the thing is and WHERE it fits. If a named tool, vendor, or entity cannot be confidently resolved from your searches — several unrelated things share the name, sources conflict, nothing matches, or the fit is a coin flip — ask the user a clarifying question in your reply and do NOT call propose_change. ` +
    `A wrong guess seeded into the review queue looks exactly as credible as a verified entry to someone skimming the queue, so a proposal built on a guess is worse than no proposal. This is a rule, not a preference.\n\n` +
    `## Proposals\n` +
    `When you are confident, call propose_change once per distinct proposal: a new tool, a new department, or an edit to an existing tool or department. The call writes to the review queue immediately — there is no separate confirmation step, and the user reviews it in the Queue view. Do not ask "shall I add it?"; either propose it or ask the clarifying question that would let you. ` +
    `After the call, tell the user in one line each what you queued; do not restate the whole record.\n` +
    `- Use the ids listed above for updates. If something is already tracked — in ANY department, including a related one — propose an update to that id, never a duplicate "new" entry; a duplicate name is refused at write time.\n` +
    `- For a tool edit, include only the fields that change.\n` +
    `- For a new tool: name, department_slug, tier, host_app (Maya | Houdini | Nuke | standalone | web | plugin | native), status, vendor, blurb (one line), attributes keyed to that department's compare attributes, source_urls.\n` +
    `- For a department doc edit, overview_doc is replaced wholesale on accept: send the COMPLETE new doc, keep the opening synthesis paragraph and the "## Tier 1 — Automated {#tier-1}", "## Tier 2 — AI-assisted {#tier-2}", "## Tier 3 — Artist-led {#tier-3}" sections.\n` +
    `- For a new department: name, slug, overview_doc in that same structure, comparison_attributes ([{key,label,type}]), pipeline_stage, and pipeline_substage only if the stage is post_production.\n` +
    `- Discontinued tools stay in the dataset with status=discontinued and a replacement_tool_id; never propose removing one.\n\n` +
    `## Web search\n` +
    `You have the web_search tool with a budget of ${MAX_SEARCHES} searches per reply. When the budget is exhausted the tool returns an error — that is the budget, not an outage: answer with what you have and say what you could not verify. Prefer vendor pages, release notes, and reputable trade press (CG Channel, SideFX, Foundry, befores & afters, fxguide) over aggregator listicles.` +
    context
  )
}

// ── The propose_change tool ─────────────────────────────────────────────

const PROPOSE_TOOL: Anthropic.Tool = {
  name: 'propose_change',
  description:
    'File a proposal in the Post Pulse review queue: a new tool, a new department, or an edit to an existing tool or department. ' +
    'It is written to the queue immediately (no confirmation step) and reviewed later by a human. ' +
    'Only call this when the entity and its fit are confidently resolved; when in doubt, ask the user instead.',
  input_schema: {
    type: 'object',
    properties: {
      target_type: { type: 'string', enum: ['tool', 'department'] },
      action: { type: 'string', enum: ['create', 'update'] },
      target_id: {
        type: 'string',
        description: 'For action=update: the id of the existing tool or department (from the system prompt lists).',
      },
      department_slug: {
        type: 'string',
        description: 'For a new tool: the slug of the department it belongs to. For a new department: the proposed slug.',
      },
      changes: {
        type: 'object',
        description:
          'Field values. Tool fields: name, tier, host_app, status, vendor, blurb, attributes, source_urls, replacement_tool_id, doc_anchor. ' +
          'Department fields: name, slug, overview_doc, comparison_attributes, pipeline_stage, pipeline_substage. For updates include only the fields that change.',
        additionalProperties: true,
      },
      rationale: {
        type: 'string',
        description: 'One or two sentences on why this fits where you put it — shown to the reviewer.',
      },
      source_urls: { type: 'array', items: { type: 'string' }, description: 'URLs that support the proposal.' },
    },
    required: ['target_type', 'action', 'changes', 'rationale'],
  },
}

interface ProposeInput {
  target_type?: unknown
  action?: unknown
  target_id?: unknown
  department_slug?: unknown
  changes?: unknown
  rationale?: unknown
  source_urls?: unknown
}

type ProposalOutcome = { ok: true; queued: PpChatQueued } | { ok: false; error: string }

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v)
}

function httpUrls(list: unknown): string[] {
  if (!Array.isArray(list)) return []
  return list.filter((u): u is string => typeof u === 'string' && /^https?:\/\//i.test(u))
}

function pick<K extends string>(obj: Record<string, unknown>, keys: readonly K[]): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const k of keys) if (k in obj) out[k] = obj[k]
  return out
}

// Validates a propose_change call against the live dataset and files it.
// Returns an error (fed back to the model as a tool_result) rather than
// queueing anything that doesn't resolve — duplicates, unknown ids, unknown
// departments, missing required fields.
async function handleProposal(input: ProposeInput, dataset: PpDataset, turnSources: PpChatSource[]): Promise<ProposalOutcome> {
  const targetType = input.target_type === 'department' ? 'department' : input.target_type === 'tool' ? 'tool' : null
  const action = input.action === 'create' ? 'create' : input.action === 'update' ? 'update' : null
  if (!targetType || !action) return { ok: false, error: 'target_type must be tool|department and action must be create|update' }
  if (!isRecord(input.changes)) return { ok: false, error: 'changes must be an object of field values' }
  const rationale = typeof input.rationale === 'string' ? input.rationale.trim() : ''
  if (!rationale) return { ok: false, error: 'rationale is required' }

  const sourceUrls = Array.from(new Set([...httpUrls(input.source_urls), ...turnSources.map((s) => s.url)])).slice(0, 12)
  const targetId = typeof input.target_id === 'string' ? input.target_id : null
  const deptSlug =
    typeof input.department_slug === 'string'
      ? input.department_slug
      : typeof input.changes.department_slug === 'string'
        ? input.changes.department_slug
        : null

  // Dataset-level checks (unknown ids, duplicates) live here; the shape
  // rules (required fields, enums, normalisation) live in buildProposal.
  if (targetType === 'tool') {
    const changes = normalizeToolFields(pick(input.changes, PP_TOOL_EDITABLE_FIELDS))
    if (action === 'update') {
      const tool = targetId ? dataset.tools.find((t) => t.id === targetId) : null
      if (!tool) return { ok: false, error: 'target_id does not match a tracked tool; use an id from the department list, or action=create' }
      if (Object.keys(changes).length === 0) return { ok: false, error: 'no editable tool fields in changes' }
      const res = await enqueueProposal({ kind: 'tool_update', toolId: tool.id, changes, note: rationale, source: 'chat', sourceUrls }, dataset)
      if ('error' in res) return { ok: false, error: res.error }
      return { ok: true, queued: { id: res.id, label: `Update ${tool.name} (${Object.keys(changes).join(', ')})`, targetType: 'tool' } }
    }
    const department = deptSlug ? dataset.departments.find((d) => d.slug === deptSlug) : null
    if (!department) return { ok: false, error: 'department_slug must name an existing department (or propose the department first)' }
    const name = typeof changes.name === 'string' ? changes.name.trim() : ''
    const dup = name ? dataset.tools.find((t) => t.department_id === department.id && t.name.toLowerCase() === name.toLowerCase()) : null
    if (dup) return { ok: false, error: `"${dup.name}" is already tracked in ${department.name} (id=${dup.id}); propose an update to it instead` }
    const res = await enqueueProposal(
      {
        kind: 'tool_create',
        department: { id: department.id, slug: department.slug },
        fields: changes,
        note: rationale,
        source: 'chat',
        sourceUrls,
      },
      dataset
    )
    if ('error' in res) return { ok: false, error: res.error }
    return { ok: true, queued: { id: res.id, label: `New tool: ${name} → ${department.name}`, targetType: 'tool' } }
  }

  // Department targets
  const changes = pick(input.changes, PP_DEPARTMENT_EDITABLE_FIELDS)
  if (action === 'update') {
    const department = targetId ? dataset.departments.find((d) => d.id === targetId) : null
    if (!department) return { ok: false, error: 'target_id does not match a department; use an id from the department list, or action=create' }
    const res = await enqueueProposal({ kind: 'department_update', departmentId: department.id, changes, note: rationale, source: 'chat', sourceUrls }, dataset)
    if ('error' in res) return { ok: false, error: res.error }
    return {
      ok: true,
      queued: { id: res.id, label: `Update department ${department.name} (${Object.keys(changes).join(', ')})`, targetType: 'department' },
    }
  }
  const name = typeof changes.name === 'string' ? changes.name.trim() : ''
  const slug = (typeof changes.slug === 'string' && changes.slug.trim()) || deptSlug || (name ? slugifyHeading(name) : '')
  const clash = dataset.departments.find((d) => (slug && d.slug === slug) || (name && d.name.toLowerCase() === name.toLowerCase()))
  if (clash) return { ok: false, error: `department "${clash.name}" already exists (id=${clash.id}); propose an update instead` }
  const res = await enqueueProposal({ kind: 'department_create', fields: { ...changes, slug }, note: rationale, source: 'chat', sourceUrls }, dataset)
  if ('error' in res) return { ok: false, error: res.error }
  return { ok: true, queued: { id: res.id, label: `New department: ${name}`, targetType: 'department' } }
}

// ── One turn ────────────────────────────────────────────────────────────

function autoName(session: PpChatSession, userMessage: string): string {
  const isDefault = session.name === PP_CHAT_DEFAULT_NAME || session.name === 'Untitled session'
  if (!isDefault || session.messages.length > 0) return session.name
  const firstLine = userMessage.replace(/\s+/g, ' ').trim()
  if (firstLine.length <= 60) return firstLine || session.name
  const cut = firstLine.slice(0, 60)
  return `${cut.slice(0, Math.max(cut.lastIndexOf(' '), 40))}…`
}

function historyToParams(messages: PpChatMessage[]): Anthropic.MessageParam[] {
  const recent = messages.slice(-MAX_HISTORY_TURNS)
  const params: Anthropic.MessageParam[] = []
  for (const m of recent) {
    const content = m.content.trim()
    if (!content) continue
    params.push({ role: m.role, content })
  }
  // The API needs the conversation to open with a user turn.
  while (params.length && params[0].role !== 'user') params.shift()
  return params
}

export async function runChatTurn(params: {
  session: PpChatSession
  userMessage: string
  onEvent: (e: PpChatStreamEvent) => void
}): Promise<void> {
  const { session, userMessage, onEvent } = params
  const model = PP_CHAT_MODEL
  const dataset = await fetchPostPulseDataset()
  const contextDepartment = session.department_context_id ? await fetchDepartmentById(session.department_context_id) : null
  const system = buildSystemPrompt(dataset, contextDepartment)

  const messages: Anthropic.MessageParam[] = [...historyToParams(session.messages), { role: 'user', content: userMessage }]
  const userEntry: PpChatMessage = { role: 'user', content: userMessage, created_at: new Date().toISOString() }

  let text = ''
  const sources: PpChatSource[] = []
  const seenUrls = new Set<string>()
  const queued: PpChatQueued[] = []
  let searchesUsed = 0
  const usage = { input: 0, output: 0, cacheWrite: 0, cacheRead: 0, searches: 0 }

  const persist = async (assistantText: string, name: string) => {
    const assistantEntry: PpChatMessage = {
      role: 'assistant',
      content: assistantText,
      created_at: new Date().toISOString(),
      ...(sources.length ? { sources } : {}),
      ...(queued.length ? { queued } : {}),
    }
    await updateChatSession(session.id, {
      name,
      messages: [...session.messages, userEntry, assistantEntry],
      proposedQueueIds: [...session.proposed_queue_ids, ...queued.map((q) => q.id)],
    })
    return assistantEntry
  }

  const name = autoName(session, userMessage)
  // web_search_20260209 runs the model's searches in a code-execution
  // container. Resuming after OUR tool_use in such a round requires that
  // container's id back ("container_id is required when there are pending
  // tool uses generated by code execution with tools"). The SDK's
  // finalMessage() drops it, but the raw message_start / message_delta
  // events carry it — so it is captured here and passed on the next round,
  // with the assistant turn replayed UNCHANGED (editing it around thinking
  // blocks is rejected) and web_search still declared (the container is
  // only accepted while the code-execution-backed tool is present).
  let containerId: string | null = null

  try {
    for (let round = 0; round < MAX_ROUNDS; round++) {
      let blockType = ''
      let inputJson = ''
      let roundText = ''

      const stream = anthropic.messages.stream({
        model,
        max_tokens: MAX_TOKENS,
        system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
        messages,
        ...(containerId ? { container: containerId } : {}),
        thinking: { type: 'adaptive' },
        output_config: { effort: PP_CHAT_EFFORT },
        tools: [
          { type: 'web_search_20260209', name: 'web_search', max_uses: Math.max(1, MAX_SEARCHES - searchesUsed) },
          PROPOSE_TOOL,
        ],
      })

      for await (const event of stream) {
        const found = containerIdFromEvent(event)
        if (found) containerId = found
        switch (event.type) {
          case 'content_block_start': {
            const block = event.content_block
            blockType = block.type
            inputJson = ''
            if (block.type === 'server_tool_use' && isRecord(block.input) && typeof block.input.query === 'string') {
              // Some responses carry the search input whole on the start event
              // instead of streaming it as input_json_delta.
              onEvent({ type: 'searching', query: block.input.query })
              blockType = 'server_tool_use:announced'
            }
            if (block.type === 'web_search_tool_result' && Array.isArray(block.content)) {
              for (const r of block.content) {
                if (r.type === 'web_search_result' && r.url && !seenUrls.has(r.url)) {
                  seenUrls.add(r.url)
                  const source = { title: r.title || r.url, url: r.url }
                  sources.push(source)
                  onEvent({ type: 'source', source })
                }
              }
            }
            break
          }
          case 'content_block_delta': {
            if (event.delta.type === 'text_delta') {
              if (!roundText && text && !text.endsWith('\n')) {
                text += '\n\n'
                onEvent({ type: 'text_delta', text: '\n\n' })
              }
              roundText += event.delta.text
              text += event.delta.text
              onEvent({ type: 'text_delta', text: event.delta.text })
            } else if (event.delta.type === 'input_json_delta' && blockType === 'server_tool_use') {
              inputJson += event.delta.partial_json
            }
            break
          }
          case 'content_block_stop': {
            if (blockType === 'server_tool_use' && inputJson) {
              try {
                const input = JSON.parse(inputJson) as { query?: string }
                if (input.query) onEvent({ type: 'searching', query: input.query })
              } catch {
                /* partial JSON — skip */
              }
            }
            blockType = ''
            inputJson = ''
            break
          }
        }
      }

      const final: Anthropic.Message = await stream.finalMessage()
      usage.input += final.usage.input_tokens
      usage.output += final.usage.output_tokens
      usage.cacheWrite += final.usage.cache_creation_input_tokens ?? 0
      usage.cacheRead += final.usage.cache_read_input_tokens ?? 0
      const roundSearches = final.usage.server_tool_use?.web_search_requests ?? 0
      usage.searches += roundSearches
      searchesUsed += roundSearches

      if (final.stop_reason === 'pause_turn') {
        messages.push({ role: 'assistant', content: final.content })
        continue
      }

      if (final.stop_reason === 'tool_use') {
        const results: Anthropic.ToolResultBlockParam[] = []
        for (const block of final.content) {
          if (block.type !== 'tool_use') continue
          if (block.name !== PROPOSE_TOOL.name) {
            results.push({ type: 'tool_result', tool_use_id: block.id, content: 'Unknown tool', is_error: true })
            continue
          }
          const outcome = await handleProposal(block.input as ProposeInput, dataset, sources)
          if (outcome.ok) {
            queued.push(outcome.queued)
            onEvent({ type: 'queued', item: outcome.queued })
            results.push({
              type: 'tool_result',
              tool_use_id: block.id,
              content: JSON.stringify({ queued: true, queue_id: outcome.queued.id, label: outcome.queued.label }),
            })
          } else {
            results.push({
              type: 'tool_result',
              tool_use_id: block.id,
              content: JSON.stringify({ queued: false, error: outcome.error }),
              is_error: true,
            })
          }
        }
        messages.push({ role: 'assistant', content: final.content })
        messages.push({ role: 'user', content: results })
        continue
      }

      if (final.stop_reason === 'max_tokens') {
        text += '\n\n_(Reply cut off at the length limit.)_'
        onEvent({ type: 'text_delta', text: '\n\n_(Reply cut off at the length limit.)_' })
      }
      break
    }

    if (!text.trim()) {
      text = queued.length
        ? `Queued ${queued.length} ${queued.length === 1 ? 'proposal' : 'proposals'} for review.`
        : '_(No reply text was produced.)_'
      onEvent({ type: 'text_delta', text })
    }

    const message = await persist(text, name)
    onEvent({ type: 'done', name, message })
  } catch (err) {
    const friendly = describeError(err)
    // Keep the session consistent: the user's message and whatever streamed.
    const partial = text.trim() ? `${text}\n\n_(Response interrupted: ${friendly})_` : `_(Response failed: ${friendly})_`
    await persist(partial, name).catch(() => {})
    onEvent({ type: 'error', error: friendly })
  } finally {
    if (usage.input + usage.output > 0) {
      logUsage({
        callType: 'pp_chat',
        channelName: 'Post Pulse chat',
        model,
        inputTokens: usage.input,
        outputTokens: usage.output,
        costUsd: calculateCost(model, usage.input, usage.output, {
          cacheCreationTokens: usage.cacheWrite,
          cacheReadTokens: usage.cacheRead,
          webSearchCount: usage.searches,
        }),
        cacheCreationTokens: usage.cacheWrite,
        cacheReadTokens: usage.cacheRead,
        webSearchCount: usage.searches,
      }).catch(() => {})
    }
  }
}

// The code-execution container id rides on the raw stream events
// (message_start.message.container, message_delta.container) but not on
// the SDK's assembled final message (verified against @anthropic-ai/sdk
// 0.115, 2026-09-14). Shared with the research loop.
export function containerIdFromEvent(event: Anthropic.MessageStreamEvent): string | null {
  const ev = event as unknown as {
    type: string
    message?: { container?: { id?: string } | null }
    delta?: { container?: { id?: string } | null }
    container?: { id?: string } | null
  }
  return ev.message?.container?.id ?? ev.delta?.container?.id ?? ev.container?.id ?? null
}

function describeError(err: unknown): string {
  if (err instanceof Anthropic.RateLimitError) return 'Rate limit reached — wait a moment and try again.'
  if (err instanceof Anthropic.AuthenticationError) return 'Authentication failed — check ANTHROPIC_API_KEY.'
  if (err instanceof Anthropic.APIError) {
    if (err.status === 529) return 'The AI service is temporarily overloaded. Try again in a moment.'
    return `API error ${err.status ?? ''}: ${err.message}`.trim()
  }
  return err instanceof Error ? err.message : 'Something went wrong'
}
