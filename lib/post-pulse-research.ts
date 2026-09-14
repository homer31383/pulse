// Post Pulse research runs (spec §5) — server-only.
//
// One run = RSS pull → Haiku routes fresh items to departments → per
// department, a Sonnet + web_search call that verifies the RSS leads and
// searches the department's own query set, reporting structured findings →
// confidence-based publishing (factual updates to verified entries from
// known sources auto-publish with a changelog row; new tools, judgment
// calls, and anything ambiguous go to pp_queue) → last_researched_at stamp
// → a briefing written through Pulse's existing channel mechanism.
//
// Three triggers share this: the daily cron (which only processes
// departments due under the uniform 14-day cadence), the global manual
// sweep, and the per-department button on a department doc.
import Anthropic from '@anthropic-ai/sdk'
import { anthropic, DEFAULT_MODEL } from '@/lib/anthropic'
import { calculateCost } from '@/lib/cost'
import { logUsage } from '@/lib/usage'
import { supabase } from '@/lib/supabase'
import { enqueue } from '@/lib/queue'
import {
  applyToolUpdate,
  enqueueProposal,
  fetchKnownSourceUrls,
  fetchLatestFrontierScans,
  fetchPostPulseDataset,
  recordFrontierScan,
  saveDepartmentFollowUps,
  stampDepartmentsResearched,
  stampToolsVerified,
} from '@/lib/post-pulse'
import { fetchRssItems, isKnownSourceUrl, PP_RSS_SOURCES, type PpRssItem } from '@/lib/post-pulse-rss'
import { findNameCollision, normalizeToolFields } from '@/lib/post-pulse-proposals'
import { containerIdFromEvent } from '@/lib/post-pulse-chat'
import {
  PP_HOST_APPS,
  PP_PIPELINE_STAGES,
  PP_PIPELINE_SUBSTAGES,
  PP_TIERS,
  hostAppLabel,
  slugifyHeading,
  type PpDataset,
  type PpDepartment,
  type PpFrontierScanSummary,
  type PpPipelineStage,
  type PpResearchDepartmentSummary,
  type PpResearchRunSummary,
  type PpResearchTrigger,
  type PpTool,
} from '@/lib/post-pulse-types'

// ── Configuration ───────────────────────────────────────────────────────

export const PP_RESEARCH_CADENCE_DAYS = 14 // uniform for now (spec §5)
const RSS_LOOKBACK_DAYS = 21
const SEARCH_MODEL = DEFAULT_MODEL // claude-sonnet-5: tier/status judgment
const EXTRACT_MODEL = 'claude-haiku-4-5' // RSS extraction / dedup / routing
// Search budget per department pass. Tunable, like PULSE_PP_CHAT_EFFORT:
// cost scales roughly linearly with searches (measured ≈ $0.15–0.25 per
// department at 5, so expect ≈ $0.45–0.70 at 15 and a full cycle in the
// $6–9 range). Raised 5 → 15 on 2026-09-14 after a pass exhausted itself on
// generic searches before reaching the good sources.
function intFromEnv(name: string, fallback: number, min: number, max: number): number {
  const n = Number(process.env[name])
  return Number.isFinite(n) && n >= min && n <= max ? Math.floor(n) : fallback
}
const MAX_SEARCHES_PER_DEPARTMENT = intFromEnv('PULSE_PP_RESEARCH_SEARCHES', 15, 1, 40)
// web_search_20260209's dynamic filtering runs the model's searches inside a
// code-execution step, and Sonnet will happily batch several in one block —
// which hits max_uses before any result is read (observed 2026-09-14: five
// searches, zero results). The prompt states MAX_SEARCHES as the budget and
// asks for one search at a time; the hard cap sits above it as headroom.
const MAX_USES_HEADROOM = intFromEnv('PULSE_PP_RESEARCH_SEARCH_HEADROOM', 5, 0, 20)
// Trade sources with better signal-to-noise than generic search; the query
// plan puts them first, then vendor release notes, then generic queries.
const TRADE_SOURCES = ['vp-land.com/tools', 'fxguide.com', 'cgchannel.com', 'beforesandafters.com']
const MAX_ROUNDS = 6
const CONCURRENCY = Math.max(1, Number(process.env.PULSE_PP_RESEARCH_CONCURRENCY ?? 4) || 4)
const EFFORT = (['low', 'medium', 'high', 'xhigh', 'max'].includes(process.env.PULSE_PP_RESEARCH_EFFORT ?? '')
  ? process.env.PULSE_PP_RESEARCH_EFFORT
  : 'medium') as 'low' | 'medium' | 'high' | 'xhigh' | 'max'
const DEFAULT_PROFILE_ID = '00000000-0000-0000-0000-000000000001'
// Briefings are profile-scoped in Pulse; the pp_* dataset is not. Research
// briefings land in this profile's "Post Pulse Research" channel.
const RESEARCH_PROFILE_ID = process.env.PULSE_PP_RESEARCH_PROFILE_ID ?? DEFAULT_PROFILE_ID
export const RESEARCH_CHANNEL_NAME = 'Post Pulse Research'

// Fields a research finding may change on an existing tool without a
// human in the loop. Tier, status, name, department, and replacement links
// are judgment calls and always queue.
const AUTO_PUBLISH_FIELDS = new Set(['vendor', 'blurb', 'source_urls', 'attributes', 'host_app'])

// ── Findings schema (what the Sonnet call reports) ──────────────────────

type FindingKind = 'new_tool' | 'update' | 'confirmation' | 'ambiguous' | 'noop'

interface Finding {
  kind: FindingKind
  tool_id?: string
  name: string
  department_slug?: string
  changes?: Record<string, unknown>
  summary: string
  evidence?: string
  source_urls?: string[]
  confidence?: 'high' | 'medium' | 'low'
  from_lead?: number
}

interface Lead {
  index: number
  item: PpRssItem
  toolId: string | null
  kind: string
  note: string
}

const REPORT_TOOL: Anthropic.Tool = {
  name: 'report_findings',
  description:
    'Report everything this research pass established for the department, then stop. Call it exactly once, at the end, even when nothing changed (use kind=noop).',
  input_schema: {
    type: 'object',
    properties: {
      findings: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            kind: { type: 'string', enum: ['new_tool', 'update', 'confirmation', 'ambiguous', 'noop'] },
            tool_id: { type: 'string', description: 'Existing tool id (from the list) for update/confirmation/ambiguous-about-a-tool.' },
            name: { type: 'string', description: 'Tool name as it should appear.' },
            department_slug: { type: 'string', description: 'Department the finding belongs to (this one unless it clearly belongs elsewhere).' },
            changes: {
              type: 'object',
              description:
                'For update/new_tool: the field values. Tool fields: name, tier, host_app, status, vendor, blurb, attributes, source_urls, replacement_tool_id. For updates include only fields that changed.',
              additionalProperties: true,
            },
            summary: { type: 'string', description: 'One or two sentences: what happened, in plain words. Goes into the briefing.' },
            evidence: { type: 'string', description: 'Why you believe it — which source says what.' },
            source_urls: { type: 'array', items: { type: 'string' } },
            confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
            from_lead: { type: 'integer', description: 'Index of the RSS lead this verifies, if any.' },
          },
          required: ['kind', 'name', 'summary'],
        },
      },
      notes: { type: 'string', description: 'Anything a human reviewer should know about this pass (dead ends, conflicts, coverage gaps).' },
      complete: {
        type: 'boolean',
        description:
          'true if you actually checked the tracked tools and the leads; false if the search budget or an error stopped you before you could (the pass will be retried).',
      },
      follow_up_sources: {
        type: 'array',
        items: { type: 'string' },
        description:
          'Where the NEXT pass for this department should start: specific URLs or named sources (a vendor release-notes page, "fxguide search for X") that you recommend but did not reach, or that proved productive. The next pass is given these first. Leave empty if the generic plan was enough.',
      },
    },
    required: ['findings', 'complete'],
  },
}

const ROUTE_TOOL: Anthropic.Tool = {
  name: 'route_items',
  description: 'Classify each RSS item: is it about an AI/ML tool relevant to a VFX pipeline department, and which department / tracked tool does it concern?',
  input_schema: {
    type: 'object',
    properties: {
      items: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            index: { type: 'integer' },
            relevant: { type: 'boolean' },
            department_slug: { type: 'string' },
            tool_id: { type: 'string', description: 'Tracked tool id if the item is about one; omit otherwise.' },
            kind: { type: 'string', enum: ['new_tool', 'update', 'status_change', 'release', 'other'] },
            note: { type: 'string', description: 'One line: what the item claims.' },
          },
          required: ['index', 'relevant'],
        },
      },
    },
    required: ['items'],
  },
}

// ── Prompts ─────────────────────────────────────────────────────────────

function tierFramework(): string {
  return (
    PP_TIERS.map((t) => `- ${t.value} (${t.label}): ${t.description}`).join('\n') +
    '\nTier 3 (artist_led) means the work requires DIRECTED CREATIVE JUDGMENT, not "AI can\'t do it at all". Ask: who makes the creative call, and who does the labour?'
  )
}

function toolLine(t: PpTool): string {
  const attrs = Object.keys(t.attributes).length ? ` attributes=${JSON.stringify(t.attributes)}` : ''
  return `- ${t.name} [id=${t.id}; ${t.tier}; ${hostAppLabel(t.host_app)}; ${t.status}; vendor=${t.vendor ?? '—'}; verified=${t.last_verified_at?.slice(0, 10) ?? 'never'}] blurb: ${t.blurb ?? ''}${attrs}`
}

function cleanName(s: string): string {
  return s.replace(/\s*\(.*?\)\s*/g, ' ').replace(/\s+/g, ' ').trim()
}

// Ordered search plan. The order is the point: (0) what the previous pass
// said to check next, (1) trade sources with real signal, (2) the major
// vendors' own release notes (from the department's tool list — it already
// knows who matters), (3) generic catch-all queries LAST. A budget-exhausted
// pass should fail having checked the good sources, not having spent itself
// on generic searches that were unproductive earlier in the same run.
function buildQueryPlan(dept: PpDepartment, tools: PpTool[]): { title: string; queries: string[] }[] {
  const year = new Date().getFullYear()
  const base = cleanName(dept.name)
  const plan: { title: string; queries: string[] }[] = []
  if (dept.follow_up_sources.length) {
    plan.push({ title: 'Start here — recommended by the previous pass for this department', queries: dept.follow_up_sources.map((f) => f.source) })
  }
  plan.push({
    title: 'Trade sources (high signal; search them by name)',
    queries: [`vp-land.com tools ${base} ${year}`, `fxguide ${base} AI ${year}`, `cgchannel ${base} ${year}`],
  })
  const vendors = Array.from(
    new Set(
      tools
        .map((t) => (t.vendor ? cleanName(t.vendor).replace(/\s*\/.*$/, '').replace(/,.*$/, '') : ''))
        .filter((v) => v && !/^open[- ]?source$/i.test(v) && !/^various/i.test(v))
    )
  ).slice(0, 8)
  const majors = tools.slice(0, 8).map((t) => cleanName(t.name))
  plan.push({
    title: 'Vendor release notes / changelogs for the major tracked players',
    queries: [
      ...vendors.map((v) => `${v} release notes ${year}`),
      ...majors.map((n) => `${n} changelog ${year}`),
    ],
  })
  plan.push({
    title: 'Generic catch-all (last; stop after two unproductive searches in a row)',
    queries: [`${base} AI tools ${year}`, `${base} machine learning VFX ${year} release`, `new ${base} AI tool announced ${year}`],
  })
  return plan
}

function researchSystemPrompt(dept: PpDepartment, tools: PpTool[], dataset: PpDataset, sinceLabel: string): string {
  const otherDepts = dataset.departments
    .filter((d) => d.id !== dept.id)
    .map((d) => `${d.name} (slug=${d.slug})`)
    .join(', ')
  // Related departments (migration 026): their rosters are "already
  // tracked" context so a pass doesn't spend its budget rediscovering
  // tools that live one department over.
  const related = dept.related_department_ids
    .map((id) => dataset.departments.find((d) => d.id === id))
    .filter((d): d is PpDepartment => !!d)
  const relatedSection = related.length
    ? `\n\n## Related departments — already tracked, do NOT report as new\n` +
      related
        .map((r) => {
          const rt = dataset.tools.filter((t) => t.department_id === r.id)
          return `${r.name} (slug=${r.slug}): ${rt.length ? rt.map((t) => `${t.name} [id=${t.id}]`).join(', ') : '(no tools yet)'}`
        })
        .join('\n') +
      `\nNews about these tools is a kind=update or kind=confirmation with that tool_id and department_slug=<their slug>, never a new_tool here.`
    : ''
  const known = PP_RSS_SOURCES.map((s) => s.domains.join('/')).join(', ')
  return (
    `You are the research pass for Post Pulse, a structured reference of AI tools across the commercial VFX pipeline. This pass covers ONE department: ${dept.name}. Your job is to find what changed for this department since ${sinceLabel} — new tools, version or status changes, acquisitions, discontinuations, tier-relevant capability shifts — verify it, and report structured findings with the report_findings tool.\n\n` +
    `## Tier framework\n${tierFramework()}\n\n` +
    `## The department doc (current state; the reasoning the dataset holds today)\n"""\n${dept.overview_doc.trim() || '(empty)'}\n"""\n\n` +
    `## Tools tracked in ${dept.name}\n${tools.length ? tools.map(toolLine).join('\n') : '(none yet)'}\n\n` +
    `Other departments (use their slug only if a finding clearly belongs there): ${otherDepts}.${relatedSection}\n\n` +
    `## Rules\n` +
    `- You have ${MAX_SEARCHES_PER_DEPARTMENT} web searches. Run them ONE AT A TIME and read each result before deciding the next — never batch several searches in a single step, or the budget is spent before you see anything. When the budget is exhausted the tool returns an error — that is the budget, not an outage; report what you have.\n` +
    `- Follow the search plan in the user message IN ORDER: previous-pass recommendations, then trade sources (${TRADE_SOURCES.join(', ')}), then vendor release notes, and only then generic queries. Generic search and news roundups are the catch-all, not the opening move; if two generic searches in a row add nothing, stop searching and report. Known sources (their claims count as vendor-grade): ${known}; also befores & afters, fxguide.\n` +
    `- In report_findings, fill follow_up_sources with the specific places the next pass should start (URLs or named sources you recommend but could not reach, or that proved productive). That list is handed to the next pass verbatim, so make it concrete.\n` +
    `- Verify each RSS lead you are given first (cite its URL in source_urls and set from_lead), then run the suggested queries you have budget for.\n` +
    `- kind=update: an existing tool (tool_id) changed — include ONLY changed fields in changes, and only fields you can support with a source. kind=confirmation: you found current evidence that the entry is accurate and nothing changed (tool_id required). kind=new_tool: a tool not in the list, worth tracking — changes MUST include tier (automated | assisted | artist_led), host_app (${PP_HOST_APPS.join(' | ')}), status, vendor, blurb, and source_urls; a new_tool without a tier is stored only as an incomplete note a human has to redo, so decide the tier or report it as ambiguous instead. kind=noop: nothing found worth recording (one per pass is enough).\n` +
    `- Hard rule: when a named entity cannot be confidently resolved — several unrelated things share the name, sources conflict, nothing matches, or the fit is a coin flip — report kind=ambiguous with what you saw and why it is unresolved. Never assert a tier, status, or identity you could not verify; a wrong guess looks as credible as a verified entry to a reviewer.\n` +
    `- Confidence: high = a primary or vendor-grade source states it plainly; medium = a credible secondary source; low = inference. Tier and status changes are judgment calls and will be reviewed by a human regardless of confidence.\n` +
    `- Do not propose removing discontinued tools; propose status=discontinued with a replacement if you can name one.\n` +
    `- Finish by calling report_findings exactly once with every finding (including confirmations). Keep summaries plain and specific; they are read aloud in a briefing.`
  )
}

function routeSystemPrompt(dataset: PpDataset): string {
  const depts = dataset.departments
    .map((d) => {
      const tools = dataset.tools.filter((t) => t.department_id === d.id).map((t) => `${t.name} (id=${t.id})`)
      return `- ${d.name} (slug=${d.slug}): ${tools.join(', ') || 'no tools yet'}`
    })
    .join('\n')
  return (
    `You route news items for Post Pulse, a reference of AI/ML tools across the commercial VFX pipeline. For each item decide whether it concerns an AI or ML tool, feature, release, acquisition, discontinuation, or capability that belongs to one of these departments, and if it is about a tool already tracked, name its id. Be strict: general industry news, tutorials, showreels, hardware, and non-AI product news are not relevant. Call route_items exactly once with every index.\n\n## Departments and tracked tools\n${depts}`
  )
}

// ── Usage accounting ────────────────────────────────────────────────────

interface Spend {
  input: number
  output: number
  cacheWrite: number
  cacheRead: number
  searches: number
  cost: number
}

function addUsage(spend: Spend, model: string, u: Anthropic.Usage): void {
  const cacheWrite = u.cache_creation_input_tokens ?? 0
  const cacheRead = u.cache_read_input_tokens ?? 0
  const searches = u.server_tool_use?.web_search_requests ?? 0
  spend.input += u.input_tokens
  spend.output += u.output_tokens
  spend.cacheWrite += cacheWrite
  spend.cacheRead += cacheRead
  spend.searches += searches
  spend.cost += calculateCost(model, u.input_tokens, u.output_tokens, {
    cacheCreationTokens: cacheWrite,
    cacheReadTokens: cacheRead,
    webSearchCount: searches,
  })
}

// ── RSS routing (Haiku) ─────────────────────────────────────────────────

async function routeRssItems(items: PpRssItem[], dataset: PpDataset, spend: Spend): Promise<Map<string, Lead[]>> {
  const leadsBySlug = new Map<string, Lead[]>()
  if (!items.length) return leadsBySlug
  const batch = items.slice(0, 80)
  const listing = batch
    .map((it, i) => `[${i}] (${it.sourceName}, ${it.published?.slice(0, 10) ?? 'undated'}) ${it.title}\n    ${it.summary.slice(0, 300)}\n    ${it.link}`)
    .join('\n')

  const response = await anthropic.messages.create({
    model: EXTRACT_MODEL,
    max_tokens: 8000,
    system: routeSystemPrompt(dataset),
    messages: [{ role: 'user', content: `Route these ${batch.length} items:\n\n${listing}` }],
    tools: [ROUTE_TOOL],
    tool_choice: { type: 'tool', name: ROUTE_TOOL.name },
  })
  addUsage(spend, EXTRACT_MODEL, response.usage)

  const call = response.content.find((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use' && b.name === ROUTE_TOOL.name)
  const routed = (call?.input as { items?: unknown[] } | undefined)?.items ?? []
  const slugs = new Set(dataset.departments.map((d) => d.slug))
  const toolIds = new Set(dataset.tools.map((t) => t.id))
  for (const raw of routed) {
    const r = raw as { index?: number; relevant?: boolean; department_slug?: string; tool_id?: string; kind?: string; note?: string }
    if (!r.relevant || typeof r.index !== 'number' || !batch[r.index]) continue
    if (!r.department_slug || !slugs.has(r.department_slug)) continue
    const list = leadsBySlug.get(r.department_slug) ?? []
    list.push({
      index: list.length,
      item: batch[r.index],
      toolId: r.tool_id && toolIds.has(r.tool_id) ? r.tool_id : null,
      kind: r.kind ?? 'other',
      note: r.note ?? '',
    })
    leadsBySlug.set(r.department_slug, list)
  }
  return leadsBySlug
}

// ── Per-department research (Sonnet + web_search) ───────────────────────

async function researchDepartment(
  dept: PpDepartment,
  dataset: PpDataset,
  leads: Lead[],
  spend: Spend
): Promise<{ findings: Finding[]; notes: string; searches: number; complete: boolean; followUps: string[] }> {
  const tools = dataset.tools.filter((t) => t.department_id === dept.id)
  const since = dept.last_researched_at
    ? new Date(dept.last_researched_at).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
    : `the dataset was seeded (${new Date(Date.now() - RSS_LOOKBACK_DAYS * 86_400_000).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })} or so)`
  const system = researchSystemPrompt(dept, tools, dataset, since)
  const leadText = leads.length
    ? leads
        .map((l) => `[lead ${l.index}] ${l.item.sourceName}: ${l.item.title}${l.toolId ? ` (about tool id=${l.toolId})` : ''}\n    ${l.note}\n    ${l.item.link}`)
        .join('\n')
    : '(none this cycle)'
  const plan = buildQueryPlan(dept, tools)
  const user =
    `Research ${dept.name} for changes since ${since}. Budget: ${MAX_SEARCHES_PER_DEPARTMENT} searches, one at a time, in plan order.\n\n## RSS leads to verify first\n${leadText}\n\n## Search plan (in order; skip what you have already covered)\n` +
    plan.map((section, i) => `### ${i + 1}. ${section.title}\n${section.queries.map((q) => `- ${q}`).join('\n')}`).join('\n\n')

  const messages: Anthropic.MessageParam[] = [{ role: 'user', content: user }]
  let searches = 0
  // Continuations replay the assistant turn unchanged and pass the
  // code-execution container id from the raw events (see post-pulse-chat.ts).
  let containerId: string | null = null
  for (let round = 0; round < MAX_ROUNDS; round++) {
    const stream = anthropic.messages.stream({
      model: SEARCH_MODEL,
      max_tokens: 8000,
      system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
      messages,
      ...(containerId ? { container: containerId } : {}),
      thinking: { type: 'adaptive' },
      output_config: { effort: EFFORT },
      tools: [
        { type: 'web_search_20260209', name: 'web_search', max_uses: Math.max(1, MAX_SEARCHES_PER_DEPARTMENT + MAX_USES_HEADROOM - searches) },
        REPORT_TOOL,
      ],
    })
    for await (const event of stream) {
      const found = containerIdFromEvent(event)
      if (found) containerId = found
    }
    const final: Anthropic.Message = await stream.finalMessage()
    addUsage(spend, SEARCH_MODEL, final.usage)
    searches += final.usage.server_tool_use?.web_search_requests ?? 0

    const report = final.content.find((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use' && b.name === REPORT_TOOL.name)
    if (report) {
      const input = report.input as { findings?: unknown[]; notes?: string; complete?: boolean; follow_up_sources?: unknown }
      const findings = (Array.isArray(input.findings) ? input.findings : []).filter(
        (f): f is Finding => !!f && typeof f === 'object' && typeof (f as Finding).kind === 'string' && typeof (f as Finding).name === 'string'
      )
      const followUps = Array.isArray(input.follow_up_sources)
        ? input.follow_up_sources.filter((s): s is string => typeof s === 'string' && s.trim().length > 0)
        : []
      return { findings, notes: typeof input.notes === 'string' ? input.notes : '', searches, complete: input.complete !== false, followUps }
    }
    if (final.stop_reason === 'pause_turn' || final.stop_reason === 'tool_use') {
      // pause_turn: the server tool loop paused; tool_use for an unknown
      // tool shouldn't happen. Either way resume with the full turn (+ the
      // container id captured above).
      messages.push({ role: 'assistant', content: final.content })
      if (final.stop_reason === 'tool_use') {
        messages.push({
          role: 'user',
          content: final.content
            .filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use')
            .map((b) => ({ type: 'tool_result' as const, tool_use_id: b.id, content: 'Unknown tool; call report_findings.', is_error: true })),
        })
      }
      continue
    }
    // Ended without reporting: nudge once, then give up.
    messages.push({ role: 'assistant', content: final.content })
    messages.push({ role: 'user', content: 'Call report_findings now with what you established (kind=noop if nothing).' })
  }
  return { findings: [], notes: 'The research pass ended without reporting findings.', searches, complete: false, followUps: [] }
}

// ── Publishing ──────────────────────────────────────────────────────────

function httpUrls(list: unknown): string[] {
  if (!Array.isArray(list)) return []
  return list.filter((u): u is string => typeof u === 'string' && /^https?:\/\//i.test(u))
}

async function publishFindings(
  dept: PpDepartment,
  findings: Finding[],
  leads: Lead[],
  dataset: PpDataset,
  runTag: string
): Promise<Pick<PpResearchDepartmentSummary, 'published' | 'queued' | 'confirmed' | 'sourceUrls'>> {
  const published: PpResearchDepartmentSummary['published'] = []
  const queued: PpResearchDepartmentSummary['queued'] = []
  const confirmed: string[] = []
  const confirmedIds: string[] = []
  const allUrls = new Set<string>()
  const toolById = new Map(dataset.tools.map((t) => [t.id, t]))
  const deptTools = dataset.tools.filter((t) => t.department_id === dept.id)

  for (const f of findings) {
    if (f.kind === 'noop') continue
    const lead = typeof f.from_lead === 'number' ? leads[f.from_lead] : undefined
    const urls = Array.from(new Set([...httpUrls(f.source_urls), ...(lead ? [lead.item.link] : [])]))
    for (const u of urls) allUrls.add(u)
    const source: 'rss' | 'search' = lead ? 'rss' : 'search'
    const knownSource = urls.some(isKnownSourceUrl)
    const tool = f.tool_id ? toolById.get(f.tool_id) : deptTools.find((t) => t.name.toLowerCase() === f.name.trim().toLowerCase())
    const targetDept = f.department_slug ? dataset.departments.find((d) => d.slug === f.department_slug) ?? dept : dept
    const note = `${f.summary}${f.evidence ? ` — ${f.evidence}` : ''} [research ${runTag}${lead ? `, via ${lead.item.sourceName}` : ''}]`

    if (f.kind === 'confirmation') {
      if (tool) {
        confirmedIds.push(tool.id)
        confirmed.push(tool.name)
      }
      continue
    }

    const changes = normalizeToolFields(f.changes && typeof f.changes === 'object' ? f.changes : {})

    if (f.kind === 'update' && tool) {
      const keys = Object.keys(changes)
      const factualOnly = keys.length > 0 && keys.every((k) => AUTO_PUBLISH_FIELDS.has(k))
      const trusted = knownSource || tool.confidence === 'verified'
      if (f.confidence === 'high' && factualOnly && trusted) {
        const applied = await applyToolUpdate(tool.id, changes, `research:${source}:${runTag}`)
        if (applied.ok && applied.changedFields.length) {
          published.push({ tool: tool.name, fields: applied.changedFields })
          continue
        }
        if (applied.ok) {
          confirmedIds.push(tool.id)
          confirmed.push(tool.name)
          continue
        }
      }
      const res = await enqueueProposal(
        {
          kind: 'tool_update',
          toolId: tool.id,
          changes,
          note: keys.length ? note : `${note} (no concrete field change supplied — accepting only re-verifies the entry)`,
          source,
          sourceUrls: urls,
        },
        dataset
      )
      if ('error' in res) console.warn(`[post-pulse research] proposal refused (${tool.name}): ${res.error}`)
      else queued.push({ label: `Update ${tool.name} (${keys.join(', ') || 'see note'})`, queueId: res.id, source })
      continue
    }

    if (f.kind === 'ambiguous') {
      // A flagged note: stored for a human, refused by Accept, resolved in chat.
      const res = await enqueueProposal(
        tool
          ? { kind: 'tool_update', toolId: tool.id, changes, note: `Needs a human — could not be resolved confidently. ${note}`, source, sourceUrls: urls, flag: 'ambiguous' }
          : {
              kind: 'tool_create',
              department: { id: targetDept.id, slug: targetDept.slug },
              fields: { ...changes, name: f.name.trim() },
              note: `Needs a human — could not be resolved confidently. ${note}`,
              source,
              sourceUrls: urls,
              flag: 'ambiguous',
            },
        dataset
      )
      if ('error' in res) console.warn(`[post-pulse research] ambiguous note refused (${f.name}): ${res.error}`)
      else queued.push({ label: `Ambiguous: ${f.name}`, queueId: res.id, source })
      continue
    }

    // new_tool (or an update that named no tracked tool): always reviewed.
    // A name already tracked in ANY department is an update to that entry,
    // not a duplicate — the cross-department check that was missing when
    // Concept & Image Generation rediscovered the Generative Media roster.
    const existing =
      dataset.tools.find((t) => t.department_id === targetDept.id && t.name.toLowerCase() === f.name.trim().toLowerCase()) ??
      findNameCollision(f.name, dataset)?.tool
    const fields: Record<string, unknown> = { ...changes, name: f.name.trim() }
    // The model must supply a tier for a real create; without one the row
    // is stored as an incomplete note rather than a proposal Accept would
    // choke on (the Beeble Canvas case, 2026-09-14).
    const incomplete = !existing && typeof fields.tier !== 'string'
    const res = await enqueueProposal(
      existing
        ? { kind: 'tool_update', toolId: existing.id, changes, note, source, sourceUrls: urls }
        : {
            kind: 'tool_create',
            department: { id: targetDept.id, slug: targetDept.slug },
            fields,
            note: incomplete ? `Incomplete — the research pass did not establish a tier. ${note}` : note,
            source,
            sourceUrls: urls,
            ...(incomplete ? { flag: 'incomplete' as const } : {}),
          },
      dataset
    )
    if ('error' in res) {
      console.warn(`[post-pulse research] proposal refused (${f.name}): ${res.error}`)
      continue
    }
    queued.push({
      label: existing ? `Update ${existing.name}` : `${incomplete ? 'Incomplete: ' : 'New tool: '}${f.name.trim()} → ${targetDept.name}`,
      queueId: res.id,
      source,
    })
  }

  await stampToolsVerified(Array.from(new Set(confirmedIds)))
  return { published, queued, confirmed: Array.from(new Set(confirmed)), sourceUrls: Array.from(allUrls) }
}

// ── Briefing via Pulse's channel mechanism ──────────────────────────────

async function ensureResearchChannel(profileId: string): Promise<string | null> {
  const { data: existing } = await supabase
    .from('channels')
    .select('id')
    .eq('profile_id', profileId)
    .eq('name', RESEARCH_CHANNEL_NAME)
    .maybeSingle()
  if (existing) return existing.id
  const { data: maxRow } = await supabase
    .from('channels')
    .select('position')
    .eq('profile_id', profileId)
    .order('position', { ascending: false })
    .limit(1)
    .maybeSingle()
  const { data, error } = await supabase
    .from('channels')
    .insert({
      name: RESEARCH_CHANNEL_NAME,
      description: 'System channel: briefings written by Post Pulse research runs (RSS + web search sweeps of the VFX AI tool dataset).',
      instructions:
        'This channel is written by Post Pulse research runs. If generated manually, produce a concise briefing on the latest developments in AI tools for the commercial VFX pipeline (modeling, rigging, simulation, rendering, compositing, generative workflows), with sources.',
      search_queries: ['AI tools VFX pipeline news', 'machine learning visual effects software release'],
      profile_id: profileId,
      position: ((maxRow?.position as number | null) ?? 0) + 1,
    })
    .select('id')
    .single()
  if (error) {
    console.warn('[post-pulse research] could not create research channel:', error.message)
    return null
  }
  return data.id
}

function departmentLabel(d: PpResearchDepartmentSummary): string {
  return d.name
}

export function composeBriefing(run: Omit<PpResearchRunSummary, 'briefingId' | 'channelId' | 'costUsd'>, notes: Record<string, string>): {
  content: string
  sources: { title: string; url: string }[]
} {
  const done = run.departments.filter((d) => d.status === 'done')
  const failed = run.departments.filter((d) => d.status === 'failed')
  const published = done.flatMap((d) => d.published.map((p) => ({ ...p, dept: d.name })))
  const queuedAll = done.flatMap((d) => d.queued.map((q) => ({ ...q, dept: d.name })))
  const confirmedAll = done.flatMap((d) => d.confirmed.map((c) => ({ tool: c, dept: d.name })))
  const scope =
    run.trigger === 'manual_department' && done.length === 1
      ? done[0].name
      : `${done.length} ${done.length === 1 ? 'department' : 'departments'}`
  const when = new Date(run.startedAt).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
  const frontierDone = run.frontier.filter((f) => f.status === 'done')
  const frontierFailed = run.frontier.filter((f) => f.status === 'failed')
  const frontierQueued = frontierDone.reduce((n, f) => n + f.queued.length, 0)
  const frontierOnly = done.length === 0 && failed.length === 0 && frontierDone.length > 0
  const triggerLabel =
    run.trigger === 'scheduled'
      ? 'the scheduled fortnightly sweep'
      : run.trigger === 'manual_global'
        ? 'a manual full sweep'
        : run.trigger === 'manual_frontier'
          ? 'a manual frontier scan'
          : 'a manual department check'

  const headline = frontierOnly
    ? `# Post Pulse frontier scan: ${frontierDone.map((f) => f.stageLabel).join(', ')} — ${frontierQueued} ${frontierQueued === 1 ? 'proposal' : 'proposals'} for review`
    : published.length || queuedAll.length
      ? `# Post Pulse research: ${published.length} ${published.length === 1 ? 'update' : 'updates'} published, ${queuedAll.length + frontierQueued} waiting for review across ${scope}${frontierDone.length ? ` and ${frontierDone.length} frontier ${frontierDone.length === 1 ? 'scan' : 'scans'}` : ''}`
      : `# Post Pulse research: ${scope} checked, nothing new to record`

  const lines: string[] = [headline, '']
  if (frontierOnly) {
    lines.push(
      `${when}. This was ${triggerLabel} — an exploratory pass over a whole pipeline stage asking what AI help exists that the dataset does not yet track, not a check on known tools. It covered ${frontierDone.map((f) => f.stageLabel).join(', ')} with ${frontierDone.reduce((n, f) => n + f.searches, 0)} web searches. Everything it found is in the review queue tagged Frontier; nothing was published automatically.`
    )
  } else {
    lines.push(
      `${when}. This was ${triggerLabel} covering ${done.map(departmentLabel).join(', ') || 'no departments'}. ` +
        `${run.rss.fresh} fresh RSS ${run.rss.fresh === 1 ? 'item' : 'items'} from ${run.rss.sources} feeds were routed (${run.rss.routed} relevant), and ${done.reduce((n, d) => n + d.searches, 0)} web searches ran. ` +
        `${confirmedAll.length} existing ${confirmedAll.length === 1 ? 'entry was' : 'entries were'} confirmed unchanged.` +
        (frontierDone.length ? ` It also ran a frontier scan of ${frontierDone.map((f) => f.stageLabel).join(', ')} (see below).` : '')
    )
  }
  lines.push('')

  for (const f of frontierDone) {
    lines.push(`## Frontier scan: ${f.stageLabel}`)
    lines.push(f.summary || `${f.searches} searches, ${f.findings} ${f.findings === 1 ? 'finding' : 'findings'}.`)
    if (f.queued.length) {
      lines.push('')
      for (const q of f.queued) lines.push(`- **${q.label}** — exploratory; review before trusting.`)
    }
    if (f.skippedExisting.length) {
      lines.push('')
      lines.push(`Already tracked, not re-proposed: ${f.skippedExisting.join('; ')}.`)
    }
    lines.push('')
  }
  for (const f of frontierFailed) {
    lines.push(`## Frontier scan: ${f.stageLabel}`)
    lines.push(`Failed — ${f.error ?? 'unknown error'}. The stage stays due and will be retried.`)
    lines.push('')
  }
  if (frontierOnly) {
    lines.push('## Analyst note')
    lines.push('Frontier findings answer "does anything exist for this", not "did a known thing change", so they are inherently less certain than routine updates. Each one is tagged Frontier in the queue for that reason.')
    lines.push('')
  }

  if (frontierOnly) return finishBriefing(lines, [...done, ...frontierDone])

  lines.push('## Auto-published')
  if (published.length) {
    for (const p of published) lines.push(`- **${p.tool}** (${p.dept}): ${p.fields.join(', ')} updated from a trusted source. Logged to the changelog.`)
  } else {
    lines.push('Nothing met the auto-publish bar this cycle: factual fields, high confidence, known source or a verified entry.')
  }
  lines.push('')

  lines.push('## Waiting for review')
  if (queuedAll.length) {
    for (const q of queuedAll) lines.push(`- **${q.label}** (${q.dept}) — from ${q.source === 'rss' ? 'an RSS lead' : 'web search'}.`)
    lines.push('')
    lines.push('Open the Post Pulse review queue to accept or reject these.')
  } else {
    lines.push('The queue received nothing from this run.')
  }
  lines.push('')

  if (confirmedAll.length) {
    lines.push('## Confirmed unchanged')
    lines.push(confirmedAll.map((c) => `${c.tool} (${c.dept})`).join(', ') + '.')
    lines.push('')
  }

  lines.push('## Departments checked')
  for (const d of done) {
    lines.push(
      `- **${d.name}**: ${d.leads} RSS ${d.leads === 1 ? 'lead' : 'leads'}, ${d.searches} ${d.searches === 1 ? 'search' : 'searches'}, ${d.published.length} published, ${d.queued.length} queued, ${d.confirmed.length} confirmed.` +
        (notes[d.departmentId] ? ` Note: ${notes[d.departmentId]}` : '')
    )
  }
  for (const d of failed) lines.push(`- **${d.name}**: failed — ${d.error ?? 'unknown error'}. It stays due and will be retried.`)
  if (run.remainingDepartmentIds.length) {
    lines.push(`- ${run.remainingDepartmentIds.length} ${run.remainingDepartmentIds.length === 1 ? 'department was' : 'departments were'} not reached within the time budget and remain due.`)
  }
  lines.push('')

  const asideParts: string[] = []
  const missingFeeds = PP_RSS_SOURCES.filter((s) => !s.feedUrl).map((s) => s.name)
  if (missingFeeds.length) asideParts.push(`${missingFeeds.join(', ')} publish no RSS feed, so they are covered by web search only.`)
  if (run.rss.errors.length) asideParts.push(`Feed errors this run: ${run.rss.errors.map((e) => `${e.source} (${e.error})`).join('; ')}.`)
  asideParts.push('Tier and status changes never auto-publish; they are judgment calls and always go to the queue.')
  lines.push('## Analyst note')
  lines.push(asideParts.join(' '))

  return finishBriefing(lines, [...done, ...frontierDone])
}

function finishBriefing(lines: string[], withSources: { sourceUrls: string[] }[]): { content: string; sources: { title: string; url: string }[] } {
  const seen = new Set<string>()
  const sourceList: { title: string; url: string }[] = []
  for (const d of withSources) {
    for (const url of d.sourceUrls) {
      if (seen.has(url)) continue
      seen.add(url)
      let title = url
      try {
        title = new URL(url).hostname.replace(/^www\./, '')
      } catch {
        /* keep the raw url */
      }
      sourceList.push({ title, url })
    }
  }
  return { content: lines.join('\n'), sources: sourceList }
}

async function persistBriefing(content: string, sources: { title: string; url: string }[]): Promise<{ briefingId: string | null; channelId: string | null }> {
  const channelId = await ensureResearchChannel(RESEARCH_PROFILE_ID)
  if (!channelId) return { briefingId: null, channelId: null }
  const { data, error } = await supabase
    .from('briefings')
    .insert({ channel_id: channelId, content, sources, model: SEARCH_MODEL, scheduled: true })
    .select('id')
    .single()
  if (error) {
    console.warn('[post-pulse research] briefing insert failed:', error.message)
    return { briefingId: null, channelId }
  }
  await supabase.from('channels').update({ last_briefed_at: new Date().toISOString() }).eq('id', channelId)
  enqueue(RESEARCH_PROFILE_ID, 'briefing', data.id, 'scheduled').catch((err) =>
    console.warn('[post-pulse research] enqueue failed:', (err as Error).message)
  )
  return { briefingId: data.id, channelId }
}

// ── Frontier scans (spec §5a) ───────────────────────────────────────────
//
// Maintenance research asks "what changed about the tools we track" and
// derives its queries from the roster, so it can never find a technique
// category nobody has named yet. A frontier scan asks the open question —
// "what AI help exists for problem X" — for a whole pipeline stage. For
// post-production it dedupes against every tracked tool (cross-department
// name check) and asks capability questions per sub-group; for the three
// empty stages it is pure discovery and proposes brand-new departments.
// Every finding goes to the queue as source='frontier'; nothing
// auto-publishes. Cadence is per stage in pp_frontier_scans.

export const PP_FRONTIER_CADENCE_DAYS = PP_RESEARCH_CADENCE_DAYS

type FrontierKind = 'new_tool' | 'new_department' | 'existing' | 'noop'

interface FrontierFinding {
  kind: FrontierKind
  name: string
  department_slug?: string
  department?: { name?: string; slug?: string; pipeline_substage?: string; overview?: string }
  changes?: Record<string, unknown>
  summary: string
  evidence?: string
  source_urls?: string[]
  confidence?: 'high' | 'medium' | 'low'
}

const FRONTIER_TOOL: Anthropic.Tool = {
  name: 'report_frontier',
  description:
    'Report what the frontier scan established for the pipeline stage, then stop. Call it exactly once, at the end, even when nothing new turned up (kind=noop).',
  input_schema: {
    type: 'object',
    properties: {
      findings: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            kind: { type: 'string', enum: ['new_tool', 'new_department', 'existing', 'noop'] },
            name: { type: 'string', description: 'Tool name (new_tool/existing) or the proposed department name (new_department).' },
            department_slug: { type: 'string', description: 'new_tool only: the existing department it belongs to (must be in this stage).' },
            department: {
              type: 'object',
              description: 'new_department only.',
              properties: {
                name: { type: 'string' },
                slug: { type: 'string' },
                pipeline_substage: { type: 'string', description: 'Post-production only: asset_creation | performance_simulation | rendering_capture | comp_generative.' },
                overview: { type: 'string', description: 'Two to four sentences: what the department covers and what AI does there today, naming the tools you found.' },
              },
            },
            changes: {
              type: 'object',
              description: 'new_tool only: name, tier, host_app, status, vendor, blurb, attributes, source_urls.',
              additionalProperties: true,
            },
            summary: { type: 'string', description: 'One or two plain sentences. Goes into the briefing.' },
            evidence: { type: 'string' },
            source_urls: { type: 'array', items: { type: 'string' } },
            confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
          },
          required: ['kind', 'name', 'summary'],
        },
      },
      notes: { type: 'string', description: 'What a reviewer should know: coverage, dead ends, categories you looked for and did not find.' },
      complete: { type: 'boolean', description: 'false if the budget or an error stopped you before the plan was covered.' },
      follow_up_sources: { type: 'array', items: { type: 'string' }, description: 'Where the next scan of this stage should start.' },
    },
    required: ['findings', 'complete'],
  },
}

// What each stage covers — the open question a frontier scan asks.
function stageBrief(stage: PpPipelineStage): string {
  switch (stage) {
    case 'pre_production':
      return 'Everything before cameras roll: script breakdown and bidding, concept and design, storyboards and animatics, previs and techvis, virtual scouting, scheduling and budgeting, casting and reference gathering.'
    case 'production':
      return 'Everything on set: on-set capture (LIDAR, photogrammetry, HDRI, witness cameras), virtual production (LED volumes, real-time engines, camera tracking), on-set VFX supervision data, performance and facial capture on set, dailies and on-set review.'
    case 'post_production':
      return 'The VFX pipeline proper: asset creation (modeling, UVs, texturing, look development, rigging, grooming), performance and simulation (animation, mocap, muscle and skin, FX, crowds), rendering and capture (rendering, denoising, Gaussian splats, photogrammetry), and comp and generative work (roto, tracking, compositing, generative media).'
    case 'finishing_delivery':
      return 'Everything after final comp: colour grading and look management, conform and online, mastering (HDR, ACES, deliverables), QC and compliance checking, localisation and versioning, archive and delivery.'
  }
}

function frontierSystemPrompt(stage: PpPipelineStage, dataset: PpDataset): string {
  const meta = PP_PIPELINE_STAGES.find((s) => s.value === stage)!
  const depts = dataset.departments.filter((d) => d.pipeline_stage === stage)
  const known = PP_RSS_SOURCES.map((s) => s.domains.join('/')).join(', ')

  let roster = ''
  if (depts.length) {
    const bySub = PP_PIPELINE_SUBSTAGES.map((sub) => {
      const ds = depts.filter((d) => d.pipeline_substage === sub.value)
      if (!ds.length) return null
      return `${sub.label} (${sub.value}):\n` + ds
        .map((d) => {
          const tools = dataset.tools.filter((t) => t.department_id === d.id)
          return `  - ${d.name} (slug=${d.slug}): ${tools.length ? tools.map((t) => t.name).join(', ') : 'no tools yet'}`
        })
        .join('\n')
    }).filter(Boolean)
    const unsubbed = depts.filter((d) => !d.pipeline_substage)
    if (unsubbed.length) {
      bySub.push(
        `Other:\n` + unsubbed.map((d) => `  - ${d.name} (slug=${d.slug}): ${dataset.tools.filter((t) => t.department_id === d.id).map((t) => t.name).join(', ') || 'no tools yet'}`).join('\n')
      )
    }
    roster = `\n\n## Already tracked in this stage — NEVER report these as new (kind=existing if you meet them)\n${bySub.join('\n')}`
  } else {
    roster = `\n\n## Nothing is tracked in this stage yet\nThere is no roster to dedupe against. This scan is how the stage gets its first departments: a real finding is a kind=new_department proposal with a name, a slug, and a short overview naming the tools you found.`
  }
  const allTracked = dataset.tools.map((t) => t.name).join(', ')

  return (
    `You are the frontier scan for Post Pulse, a structured reference of AI tools across the commercial VFX pipeline. This scan covers ONE pipeline stage: ${meta.label}. ` +
    `Unlike the routine maintenance pass (which checks known tools for changes), you ask the open question: what AI help exists for the problems of this stage that the dataset does not yet track? Report with the report_frontier tool.\n\n` +
    `## The stage\n${stageBrief(stage)}${roster}\n\n` +
    `## Every tool tracked anywhere in the dataset (any of these is kind=existing, never new_tool)\n${allTracked || '(none)'}\n\n` +
    `## Tier framework (for new_tool proposals)\n${tierFramework()}\n\n` +
    `## Rules\n` +
    `- Ask capability questions, not vendor questions: "what AI exists for <problem>" per sub-area, not "what is new from <vendor>". Follow the search plan in the user message in order, one search at a time; you have ${MAX_SEARCHES_PER_DEPARTMENT} searches. Trade sources (${TRADE_SOURCES.join(', ')}) before generic search. When the budget is exhausted the tool returns an error — that is the budget, not an outage; report what you have.\n` +
    `- A finding is exploratory by nature; be honest about confidence. Never assert a tier, status, or identity you could not verify — if a named thing cannot be resolved, say so in notes rather than reporting it.\n` +
    `- kind=new_tool needs changes with tier (automated | assisted | artist_led), host_app (${PP_HOST_APPS.join(' | ')}), status, vendor, blurb, source_urls, and department_slug from the roster above. A new_tool without a tier is stored only as an incomplete note.\n` +
    `- kind=new_department is for a real gap: a category of work in this stage with real AI tooling and no department to hold it. Give department.name, department.slug, an overview naming the tools, and (post-production only) pipeline_substage. Do not propose a department that duplicates an existing one under another name.\n` +
    `- Prefer a few well-sourced findings to many thin ones. Finish by calling report_frontier exactly once; fill follow_up_sources with where the next scan should start.` +
    ` Known sources (vendor-grade): ${known}; also befores & afters, fxguide.`
  )
}

function frontierQueryPlan(stage: PpPipelineStage, dataset: PpDataset): { title: string; queries: string[] }[] {
  const year = new Date().getFullYear()
  const plan: { title: string; queries: string[] }[] = []
  const label = PP_PIPELINE_STAGES.find((s) => s.value === stage)!.label
  plan.push({
    title: 'Trade sources first (search them by name)',
    queries: [`fxguide AI ${label.toLowerCase()} VFX ${year}`, `vp-land.com tools ${label.toLowerCase()} AI ${year}`, `befores and afters AI ${label.toLowerCase()} ${year}`],
  })
  if (stage === 'post_production') {
    const depts = dataset.departments.filter((d) => d.pipeline_stage === stage)
    for (const sub of PP_PIPELINE_SUBSTAGES) {
      const names = depts.filter((d) => d.pipeline_substage === sub.value).map((d) => d.name.replace(/\s*\(.*?\)/g, ''))
      plan.push({
        title: `${sub.label}: what AI techniques exist that the roster lacks`,
        queries: [
          `AI machine learning ${sub.label.toLowerCase()} VFX new technique ${year}`,
          ...names.slice(0, 4).map((n) => `${n} new AI technique ${year}`),
        ],
      })
    }
  } else {
    const topics: Record<Exclude<PpPipelineStage, 'post_production'>, string[]> = {
      pre_production: ['script breakdown and bidding', 'previs and techvis', 'storyboards and animatics', 'virtual scouting', 'production scheduling and budgeting'],
      production: ['virtual production LED volume', 'on-set LIDAR and photogrammetry capture', 'on-set camera tracking', 'on-set facial and performance capture', 'dailies and on-set review'],
      finishing_delivery: ['colour grading', 'conform and online', 'HDR and ACES mastering', 'deliverable QC and compliance', 'localisation and versioning'],
    }
    for (const t of topics[stage]) plan.push({ title: `${t}: what AI exists`, queries: [`AI ${t} film VFX ${year}`, `${t} machine learning tool ${year}`] })
  }
  plan.push({ title: 'Generic catch-all (last; stop after two unproductive searches)', queries: [`new AI tools ${label.toLowerCase()} film VFX ${year}`] })
  return plan
}

async function frontierScan(
  stage: PpPipelineStage,
  dataset: PpDataset,
  spend: Spend
): Promise<{ findings: FrontierFinding[]; notes: string; searches: number; complete: boolean; followUps: string[] }> {
  const system = frontierSystemPrompt(stage, dataset)
  const plan = frontierQueryPlan(stage, dataset)
  const label = PP_PIPELINE_STAGES.find((s) => s.value === stage)!.label
  const user =
    `Frontier scan of ${label}. Budget: ${MAX_SEARCHES_PER_DEPARTMENT} searches, one at a time, in plan order.\n\n## Search plan\n` +
    plan.map((s, i) => `### ${i + 1}. ${s.title}\n${s.queries.map((q) => `- ${q}`).join('\n')}`).join('\n\n')

  const messages: Anthropic.MessageParam[] = [{ role: 'user', content: user }]
  let searches = 0
  let containerId: string | null = null
  for (let round = 0; round < MAX_ROUNDS; round++) {
    const stream = anthropic.messages.stream({
      model: SEARCH_MODEL,
      max_tokens: 8000,
      system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
      messages,
      ...(containerId ? { container: containerId } : {}),
      thinking: { type: 'adaptive' },
      output_config: { effort: EFFORT },
      tools: [
        { type: 'web_search_20260209', name: 'web_search', max_uses: Math.max(1, MAX_SEARCHES_PER_DEPARTMENT + MAX_USES_HEADROOM - searches) },
        FRONTIER_TOOL,
      ],
    })
    for await (const event of stream) {
      const found = containerIdFromEvent(event)
      if (found) containerId = found
    }
    const final: Anthropic.Message = await stream.finalMessage()
    addUsage(spend, SEARCH_MODEL, final.usage)
    searches += final.usage.server_tool_use?.web_search_requests ?? 0

    const report = final.content.find((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use' && b.name === FRONTIER_TOOL.name)
    if (report) {
      const input = report.input as { findings?: unknown[]; notes?: string; complete?: boolean; follow_up_sources?: unknown }
      const findings = (Array.isArray(input.findings) ? input.findings : []).filter(
        (f): f is FrontierFinding => !!f && typeof f === 'object' && typeof (f as FrontierFinding).kind === 'string' && typeof (f as FrontierFinding).name === 'string'
      )
      const followUps = Array.isArray(input.follow_up_sources) ? input.follow_up_sources.filter((s): s is string => typeof s === 'string' && s.trim().length > 0) : []
      return { findings, notes: typeof input.notes === 'string' ? input.notes : '', searches, complete: input.complete !== false, followUps }
    }
    if (final.stop_reason === 'pause_turn' || final.stop_reason === 'tool_use') {
      messages.push({ role: 'assistant', content: final.content })
      if (final.stop_reason === 'tool_use') {
        messages.push({
          role: 'user',
          content: final.content
            .filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use')
            .map((b) => ({ type: 'tool_result' as const, tool_use_id: b.id, content: 'Unknown tool; call report_frontier.', is_error: true })),
        })
      }
      continue
    }
    messages.push({ role: 'assistant', content: final.content })
    messages.push({ role: 'user', content: 'Call report_frontier now with what you established (kind=noop if nothing).' })
  }
  return { findings: [], notes: 'The frontier scan ended without reporting.', searches, complete: false, followUps: [] }
}

// Scaffold doc for a proposed department, in the dataset's tier structure,
// so accepting the proposal yields a usable page rather than an empty one.
function scaffoldDepartmentDoc(name: string, overview: string, summary: string): string {
  return (
    `${overview.trim() || summary.trim()}\n\nProposed by a frontier scan on ${new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}; the tier sections below are a scaffold until a research pass or a chat session fills them in.\n\n` +
    `## Tier 1 — Automated {#tier-1}\n\nNot researched yet.\n\n## Tier 2 — AI-assisted {#tier-2}\n\n${summary.trim()}\n\n## Tier 3 — Artist-led {#tier-3}\n\nNot researched yet; assume the creative calls in ${name} are still made by people until a pass shows otherwise.\n`
  )
}

async function publishFrontierFindings(
  stage: PpPipelineStage,
  findings: FrontierFinding[],
  dataset: PpDataset,
  runTag: string
): Promise<Pick<PpFrontierScanSummary, 'queued' | 'skippedExisting' | 'sourceUrls'>> {
  const queued: PpFrontierScanSummary['queued'] = []
  const skippedExisting: string[] = []
  const urlsAll = new Set<string>()
  const stageDepts = dataset.departments.filter((d) => d.pipeline_stage === stage)
  const substages = new Set<string>(PP_PIPELINE_SUBSTAGES.map((s) => s.value))

  for (const f of findings) {
    if (f.kind === 'noop') continue
    const urls = httpUrls(f.source_urls)
    for (const u of urls) urlsAll.add(u)
    const note = `${f.summary}${f.evidence ? ` — ${f.evidence}` : ''} [frontier scan ${runTag}, ${PP_PIPELINE_STAGES.find((s) => s.value === stage)!.label}${f.confidence ? `, confidence ${f.confidence}` : ''}]`

    if (f.kind === 'existing') {
      skippedExisting.push(f.name)
      continue
    }

    if (f.kind === 'new_tool') {
      // Cross-department dedupe: anything already tracked is not new.
      const clash = findNameCollision(f.name, dataset)
      if (clash) {
        skippedExisting.push(`${f.name} (tracked as ${clash.tool.name} in ${clash.departmentName})`)
        continue
      }
      const dept = f.department_slug ? stageDepts.find((d) => d.slug === f.department_slug) : null
      if (!dept) {
        console.warn(`[post-pulse frontier] new_tool "${f.name}" named no department in ${stage}; skipped`)
        continue
      }
      const fields: Record<string, unknown> = { ...normalizeToolFields(f.changes && typeof f.changes === 'object' ? f.changes : {}), name: f.name.trim() }
      const incomplete = typeof fields.tier !== 'string'
      const res = await enqueueProposal(
        {
          kind: 'tool_create',
          department: { id: dept.id, slug: dept.slug },
          fields,
          note: incomplete ? `Incomplete — the frontier scan did not establish a tier. ${note}` : note,
          source: 'frontier',
          sourceUrls: urls,
          ...(incomplete ? { flag: 'incomplete' as const } : {}),
        },
        dataset
      )
      if ('error' in res) console.warn(`[post-pulse frontier] proposal refused (${f.name}): ${res.error}`)
      else queued.push({ label: `${incomplete ? 'Incomplete: ' : 'New tool: '}${f.name.trim()} → ${dept.name}`, queueId: res.id, kind: 'tool' })
      continue
    }

    // new_department
    const name = (f.department?.name ?? f.name).trim()
    const slug = (f.department?.slug?.trim() || slugifyHeading(name)).toLowerCase()
    const dup = dataset.departments.find((d) => d.slug === slug || d.name.toLowerCase() === name.toLowerCase())
    if (dup) {
      skippedExisting.push(`${name} (department already exists: ${dup.name})`)
      continue
    }
    const substage = stage === 'post_production' && f.department?.pipeline_substage && substages.has(f.department.pipeline_substage) ? f.department.pipeline_substage : null
    const res = await enqueueProposal(
      {
        kind: 'department_create',
        fields: {
          name,
          slug,
          overview_doc: scaffoldDepartmentDoc(name, f.department?.overview ?? '', f.summary),
          comparison_attributes: [],
          pipeline_stage: stage,
          pipeline_substage: substage,
        },
        note,
        source: 'frontier',
        sourceUrls: urls,
      },
      dataset
    )
    if ('error' in res) console.warn(`[post-pulse frontier] department proposal refused (${name}): ${res.error}`)
    else queued.push({ label: `New department: ${name}`, queueId: res.id, kind: 'department' })
  }
  return { queued, skippedExisting, sourceUrls: Array.from(urlsAll) }
}

export async function fetchDueFrontierStages(now = Date.now()): Promise<PpPipelineStage[]> {
  const latest = await fetchLatestFrontierScans()
  return PP_PIPELINE_STAGES.map((s) => s.value).filter((stage) => {
    const ran = latest[stage]
    return !ran || now - Date.parse(ran) >= PP_FRONTIER_CADENCE_DAYS * 86_400_000
  })
}

// ── Run orchestration ───────────────────────────────────────────────────

export function isDepartmentDue(d: PpDepartment, now = Date.now()): boolean {
  if (!d.last_researched_at) return true
  return now - Date.parse(d.last_researched_at) >= PP_RESEARCH_CADENCE_DAYS * 86_400_000
}

export async function runResearch(opts: {
  trigger: PpResearchTrigger
  departmentIds?: string[] // undefined = every department (dueOnly narrows it)
  frontierStages?: PpPipelineStage[] // undefined = none, unless dueOnly picks up due stages
  dueOnly?: boolean
  timeBudgetMs?: number
}): Promise<PpResearchRunSummary> {
  const startedAt = new Date()
  const budget = opts.timeBudgetMs ?? 230_000
  const runTag = startedAt.toISOString().slice(0, 16)
  const spend: Spend = { input: 0, output: 0, cacheWrite: 0, cacheRead: 0, searches: 0, cost: 0 }

  const dataset = await fetchPostPulseDataset()
  let targets = opts.departmentIds
    ? dataset.departments.filter((d) => opts.departmentIds!.includes(d.id))
    : dataset.departments
  if (opts.dueOnly) targets = targets.filter((d) => isDepartmentDue(d))
  // Frontier stages: explicit list for manual triggers; the daily cron
  // takes whatever is due under the same 14-day cadence (per stage, from
  // pp_frontier_scans — stages can have zero departments).
  let stages: PpPipelineStage[] = opts.frontierStages ?? []
  if (opts.dueOnly && !opts.frontierStages) stages = await fetchDueFrontierStages()
  // Oldest research first so a time-limited run makes progress on the
  // stalest departments.
  targets.sort((a, b) => (a.last_researched_at ?? '').localeCompare(b.last_researched_at ?? ''))

  // RSS pull + routing (shared by every department in the run)
  const sinceIso = new Date(Date.now() - RSS_LOOKBACK_DAYS * 86_400_000).toISOString()
  const [rss, seenUrls] = await Promise.all([fetchRssItems({ sinceIso }), fetchKnownSourceUrls()])
  const fresh = rss.items.filter((it) => !seenUrls.has(it.link))
  let leadsBySlug = new Map<string, Lead[]>()
  try {
    leadsBySlug = targets.length && fresh.length ? await routeRssItems(fresh, dataset, spend) : new Map()
  } catch (err) {
    rss.errors.push({ source: 'routing', error: err instanceof Error ? err.message : String(err) })
  }
  const routed = Array.from(leadsBySlug.values()).reduce((n, l) => n + l.length, 0)

  const results: PpResearchDepartmentSummary[] = []
  const notes: Record<string, string> = {}
  const remaining: string[] = []
  let cursor = 0

  // A department pass at the 15-search budget takes ~3 minutes, so "is
  // there budget left?" is not enough — a pass started with 100s left would
  // overrun Vercel's 300s limit and be killed mid-write. Don't start one
  // unless the longest pass seen so far (or a conservative default) fits.
  let longestPassMs = 150_000
  const worker = async () => {
    while (cursor < targets.length) {
      const elapsed = Date.now() - startedAt.getTime()
      if (elapsed + longestPassMs > budget) {
        remaining.push(targets[cursor++].id)
        continue
      }
      const dept = targets[cursor++]
      const leads = leadsBySlug.get(dept.slug) ?? []
      const passStarted = Date.now()
      try {
        const { findings, notes: n, searches, complete, followUps } = await researchDepartment(dept, dataset, leads, spend)
        // Persist the "check these next" list whether the pass completed or
        // not — an incomplete pass's recommendations are the most valuable.
        await saveDepartmentFollowUps(dept.id, followUps)
        if (!complete) {
          // The model says it never got to check the tools (budget/error):
          // no stamp, so the department stays due and is retried.
          throw new Error(`incomplete pass — ${n || 'the model reported it could not finish'}`)
        }
        const outcome = await publishFindings(dept, findings, leads, dataset, runTag)
        if (n) notes[dept.id] = n
        results.push({ departmentId: dept.id, slug: dept.slug, name: dept.name, status: 'done', searches, leads: leads.length, ...outcome })
        longestPassMs = Math.max(longestPassMs, Date.now() - passStarted)
      } catch (err) {
        longestPassMs = Math.max(longestPassMs, Date.now() - passStarted)
        results.push({
          departmentId: dept.id,
          slug: dept.slug,
          name: dept.name,
          status: 'failed',
          error: err instanceof Error ? err.message : String(err),
          searches: 0,
          leads: leads.length,
          published: [],
          queued: [],
          confirmed: [],
          sourceUrls: [],
        })
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, Math.max(1, targets.length)) }, worker))

  // Stamp what was actually processed (failed departments stay due).
  const doneIds = results.filter((r) => r.status === 'done').map((r) => r.departmentId)
  await stampDepartmentsResearched(doneIds)

  // Frontier scans run after the maintenance passes, under the same
  // "will it fit" start check. A completed scan is recorded in
  // pp_frontier_scans (that row is the cadence anchor); a failed one is
  // not, so it stays due and is retried.
  const frontier: PpFrontierScanSummary[] = []
  const remainingStages: PpPipelineStage[] = []
  let stageCursor = 0
  const stageWorker = async () => {
    while (stageCursor < stages.length) {
      const elapsed = Date.now() - startedAt.getTime()
      if (elapsed + longestPassMs > budget) {
        remainingStages.push(stages[stageCursor++])
        continue
      }
      const stage = stages[stageCursor++]
      const stageLabel = PP_PIPELINE_STAGES.find((s) => s.value === stage)!.label
      const passStarted = Date.now()
      try {
        const { findings, notes: n, searches, complete, followUps } = await frontierScan(stage, dataset, spend)
        if (!complete) throw new Error(`incomplete scan — ${n || 'the model reported it could not finish'}`)
        const outcome = await publishFrontierFindings(stage, findings, dataset, runTag)
        const real = findings.filter((f) => f.kind !== 'noop' && f.kind !== 'existing').length
        const summary =
          (n ? `${n} ` : '') +
          (followUps.length ? `Next scan should start from: ${followUps.join('; ')}.` : '')
        await recordFrontierScan({ pipeline_stage: stage, summary: summary.trim() || null, findings_count: real, queued_count: outcome.queued.length })
        frontier.push({ stage, stageLabel, status: 'done', searches, findings: real, summary: summary.trim(), ...outcome })
      } catch (err) {
        frontier.push({
          stage,
          stageLabel,
          status: 'failed',
          error: err instanceof Error ? err.message : String(err),
          searches: 0,
          findings: 0,
          queued: [],
          skippedExisting: [],
          summary: '',
          sourceUrls: [],
        })
      } finally {
        longestPassMs = Math.max(longestPassMs, Date.now() - passStarted)
      }
    }
  }
  if (stages.length) await Promise.all(Array.from({ length: Math.min(CONCURRENCY, stages.length) }, stageWorker))
  const frontierDone = frontier.filter((f) => f.status === 'done')

  const base: Omit<PpResearchRunSummary, 'briefingId' | 'channelId' | 'costUsd'> = {
    trigger: opts.trigger,
    startedAt: startedAt.toISOString(),
    finishedAt: new Date().toISOString(),
    departments: results,
    remainingDepartmentIds: remaining,
    frontier,
    remainingStages,
    rss: { sources: rss.fetchedSources, fetched: rss.items.length, fresh: fresh.length, routed, errors: rss.errors },
  }

  let briefingId: string | null = null
  let channelId: string | null = null
  if (doneIds.length || frontierDone.length) {
    const { content, sources } = composeBriefing(base, notes)
    ;({ briefingId, channelId } = await persistBriefing(content, sources))
  }

  if (spend.input + spend.output > 0) {
    logUsage({
      callType: 'pp_research',
      channelId: channelId ?? undefined,
      channelName: RESEARCH_CHANNEL_NAME,
      model: SEARCH_MODEL,
      inputTokens: spend.input,
      outputTokens: spend.output,
      costUsd: spend.cost,
      cacheCreationTokens: spend.cacheWrite,
      cacheReadTokens: spend.cacheRead,
      webSearchCount: spend.searches,
    }).catch(() => {})
  }

  console.log(
    `[post-pulse research] ${opts.trigger}: ${doneIds.length} done, ${results.length - doneIds.length} failed, ${remaining.length} remaining; frontier ${frontierDone.length} done/${frontier.length - frontierDone.length} failed/${remainingStages.length} remaining; ` +
      `rss ${fresh.length} fresh/${routed} routed; searches ${spend.searches}; cost $${spend.cost.toFixed(3)}; briefing ${briefingId ?? 'none'}`
  )
  return { ...base, briefingId, channelId, costUsd: spend.cost }
}
