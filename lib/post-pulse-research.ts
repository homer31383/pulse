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
  fetchPostPulseDataset,
  stampDepartmentsResearched,
  stampToolsVerified,
} from '@/lib/post-pulse'
import { fetchRssItems, isKnownSourceUrl, PP_RSS_SOURCES, type PpRssItem } from '@/lib/post-pulse-rss'
import {
  PP_HOST_APPS,
  PP_TIERS,
  hostAppLabel,
  type PpDataset,
  type PpDepartment,
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
const MAX_SEARCHES_PER_DEPARTMENT = 5
// web_search_20260209's dynamic filtering runs the model's searches inside a
// code-execution step, and Sonnet will happily batch several in one block —
// which hits max_uses before any result is read (observed 2026-09-14: five
// searches, zero results). The prompt states MAX_SEARCHES as the budget and
// asks for one search at a time; the hard cap sits above it as headroom.
const MAX_USES_HEADROOM = 3
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

function suggestedQueries(dept: PpDepartment, tools: PpTool[]): string[] {
  const year = new Date().getFullYear()
  const base = dept.name.replace(/\s*\(.*?\)\s*/g, ' ').trim()
  const queries = [`${base} AI tools ${year}`, `${base} machine learning VFX ${year} release`]
  for (const t of tools.slice(0, 6)) queries.push(`${t.name.replace(/\s*\(.*?\)\s*/g, ' ').trim()} ${year}`)
  return queries
}

function researchSystemPrompt(dept: PpDepartment, tools: PpTool[], dataset: PpDataset, sinceLabel: string): string {
  const otherDepts = dataset.departments
    .filter((d) => d.id !== dept.id)
    .map((d) => `${d.name} (slug=${d.slug})`)
    .join(', ')
  const known = PP_RSS_SOURCES.map((s) => s.domains.join('/')).join(', ')
  return (
    `You are the research pass for Post Pulse, a structured reference of AI tools across the commercial VFX pipeline. This pass covers ONE department: ${dept.name}. Your job is to find what changed for this department since ${sinceLabel} — new tools, version or status changes, acquisitions, discontinuations, tier-relevant capability shifts — verify it, and report structured findings with the report_findings tool.\n\n` +
    `## Tier framework\n${tierFramework()}\n\n` +
    `## The department doc (current state; the reasoning the dataset holds today)\n"""\n${dept.overview_doc.trim() || '(empty)'}\n"""\n\n` +
    `## Tools tracked in ${dept.name}\n${tools.length ? tools.map(toolLine).join('\n') : '(none yet)'}\n\n` +
    `Other departments (use their slug only if a finding clearly belongs there): ${otherDepts}.\n\n` +
    `## Rules\n` +
    `- You have ${MAX_SEARCHES_PER_DEPARTMENT} web searches. Run them ONE AT A TIME and read each result before deciding the next — never batch several searches in a single step, or the budget is spent before you see anything. When the budget is exhausted the tool returns an error — that is the budget, not an outage; report what you have. Prefer vendor pages, release notes, and trade press. Known sources (their claims count as vendor-grade): ${known}; also befores & afters, fxguide.\n` +
    `- Verify each RSS lead you are given first (cite its URL in source_urls and set from_lead), then run the suggested queries you have budget for.\n` +
    `- kind=update: an existing tool (tool_id) changed — include ONLY changed fields in changes, and only fields you can support with a source. kind=confirmation: you found current evidence that the entry is accurate and nothing changed (tool_id required). kind=new_tool: a tool not in the list, worth tracking, with name, tier, host_app (${PP_HOST_APPS.join(' | ')}), status, vendor, blurb, source_urls. kind=noop: nothing found worth recording (one per pass is enough).\n` +
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
): Promise<{ findings: Finding[]; notes: string; searches: number; complete: boolean }> {
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
  const user =
    `Research ${dept.name} for changes since ${since}.\n\n## RSS leads to verify first\n${leadText}\n\n## Suggested queries (use what the budget allows)\n` +
    suggestedQueries(dept, tools)
      .map((q) => `- ${q}`)
      .join('\n')

  const messages: Anthropic.MessageParam[] = [{ role: 'user', content: user }]
  let searches = 0
  for (let round = 0; round < MAX_ROUNDS; round++) {
    const stream = anthropic.messages.stream({
      model: SEARCH_MODEL,
      max_tokens: 8000,
      system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
      messages,
      thinking: { type: 'adaptive' },
      output_config: { effort: EFFORT },
      tools: [
        { type: 'web_search_20260209', name: 'web_search', max_uses: Math.max(1, MAX_SEARCHES_PER_DEPARTMENT + MAX_USES_HEADROOM - searches) },
        REPORT_TOOL,
      ],
    })
    const final = await stream.finalMessage()
    addUsage(spend, SEARCH_MODEL, final.usage)
    searches += final.usage.server_tool_use?.web_search_requests ?? 0

    const report = final.content.find((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use' && b.name === REPORT_TOOL.name)
    if (report) {
      const input = report.input as { findings?: unknown[]; notes?: string; complete?: boolean }
      const findings = (Array.isArray(input.findings) ? input.findings : []).filter(
        (f): f is Finding => !!f && typeof f === 'object' && typeof (f as Finding).kind === 'string' && typeof (f as Finding).name === 'string'
      )
      return { findings, notes: typeof input.notes === 'string' ? input.notes : '', searches, complete: input.complete !== false }
    }
    if (final.stop_reason === 'pause_turn' || final.stop_reason === 'tool_use') {
      // pause_turn: server tool loop paused; tool_use without our tool
      // shouldn't happen (web_search is server-side) — resume either way.
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
  return { findings: [], notes: 'The research pass ended without reporting findings.', searches, complete: false }
}

// ── Publishing ──────────────────────────────────────────────────────────

function httpUrls(list: unknown): string[] {
  if (!Array.isArray(list)) return []
  return list.filter((u): u is string => typeof u === 'string' && /^https?:\/\//i.test(u))
}

function normalizeChanges(changes: Record<string, unknown>): Record<string, unknown> {
  const out = { ...changes }
  if (typeof out.host_app === 'string') {
    const canonical = PP_HOST_APPS.find((h) => h.toLowerCase() === (out.host_app as string).trim().toLowerCase())
    out.host_app = canonical ?? out.host_app.trim()
  }
  if (typeof out.tier === 'string') out.tier = out.tier.trim().toLowerCase().replace(/[\s-]+/g, '_')
  if (typeof out.status === 'string') out.status = out.status.trim().toLowerCase()
  return out
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

    const changes = normalizeChanges(f.changes && typeof f.changes === 'object' ? f.changes : {})

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
      const res = await enqueueProposal({
        targetType: 'tool',
        proposedToolId: tool.id,
        proposedChanges: { ...changes, note: keys.length ? note : `${note} (no concrete field change supplied — review the summary)` },
        source,
        sourceUrls: urls,
      })
      if (!('error' in res)) queued.push({ label: `Update ${tool.name} (${keys.join(', ') || 'see note'})`, queueId: res.id, source })
      continue
    }

    if (f.kind === 'ambiguous') {
      const res = await enqueueProposal({
        targetType: 'tool',
        proposedToolId: tool?.id ?? null,
        proposedChanges: {
          ...(tool ? {} : { name: f.name, department_slug: targetDept.slug }),
          ...changes,
          flag: 'ambiguous',
          note: `Needs a human — could not be resolved confidently. ${note}`,
        },
        source,
        sourceUrls: urls,
      })
      if (!('error' in res)) queued.push({ label: `Ambiguous: ${f.name}`, queueId: res.id, source })
      continue
    }

    // new_tool (or an update that named no tracked tool): always reviewed.
    const existing = dataset.tools.find(
      (t) => t.department_id === targetDept.id && t.name.toLowerCase() === f.name.trim().toLowerCase()
    )
    const res = await enqueueProposal({
      targetType: 'tool',
      proposedToolId: existing?.id ?? null,
      proposedChanges: existing
        ? { ...changes, note }
        : { ...changes, name: f.name.trim(), department_slug: targetDept.slug, department_id: targetDept.id, note },
      source,
      sourceUrls: urls,
    })
    if (!('error' in res)) {
      queued.push({
        label: existing ? `Update ${existing.name}` : `New tool: ${f.name.trim()} → ${targetDept.name}`,
        queueId: res.id,
        source,
      })
    }
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
  const triggerLabel =
    run.trigger === 'scheduled' ? 'the scheduled fortnightly sweep' : run.trigger === 'manual_global' ? 'a manual full sweep' : 'a manual department check'

  const headline =
    published.length || queuedAll.length
      ? `# Post Pulse research: ${published.length} ${published.length === 1 ? 'update' : 'updates'} published, ${queuedAll.length} waiting for review across ${scope}`
      : `# Post Pulse research: ${scope} checked, nothing new to record`

  const lines: string[] = [headline, '']
  lines.push(
    `${when}. This was ${triggerLabel} covering ${done.map(departmentLabel).join(', ') || 'no departments'}. ` +
      `${run.rss.fresh} fresh RSS ${run.rss.fresh === 1 ? 'item' : 'items'} from ${run.rss.sources} feeds were routed (${run.rss.routed} relevant), and ${done.reduce((n, d) => n + d.searches, 0)} web searches ran. ` +
      `${confirmedAll.length} existing ${confirmedAll.length === 1 ? 'entry was' : 'entries were'} confirmed unchanged.`
  )
  lines.push('')

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

  const seen = new Set<string>()
  const sourceList: { title: string; url: string }[] = []
  for (const d of done) {
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

// ── Run orchestration ───────────────────────────────────────────────────

export function isDepartmentDue(d: PpDepartment, now = Date.now()): boolean {
  if (!d.last_researched_at) return true
  return now - Date.parse(d.last_researched_at) >= PP_RESEARCH_CADENCE_DAYS * 86_400_000
}

export async function runResearch(opts: {
  trigger: PpResearchTrigger
  departmentIds?: string[] // undefined = every department (dueOnly narrows it)
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

  const worker = async () => {
    while (cursor < targets.length) {
      if (Date.now() - startedAt.getTime() > budget) {
        remaining.push(targets[cursor++].id)
        continue
      }
      const dept = targets[cursor++]
      const leads = leadsBySlug.get(dept.slug) ?? []
      try {
        const { findings, notes: n, searches, complete } = await researchDepartment(dept, dataset, leads, spend)
        if (!complete) {
          // The model says it never got to check the tools (budget/error):
          // no stamp, so the department stays due and is retried.
          throw new Error(`incomplete pass — ${n || 'the model reported it could not finish'}`)
        }
        const outcome = await publishFindings(dept, findings, leads, dataset, runTag)
        if (n) notes[dept.id] = n
        results.push({ departmentId: dept.id, slug: dept.slug, name: dept.name, status: 'done', searches, leads: leads.length, ...outcome })
      } catch (err) {
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

  const base: Omit<PpResearchRunSummary, 'briefingId' | 'channelId' | 'costUsd'> = {
    trigger: opts.trigger,
    startedAt: startedAt.toISOString(),
    finishedAt: new Date().toISOString(),
    departments: results,
    remainingDepartmentIds: remaining,
    rss: { sources: rss.fetchedSources, fetched: rss.items.length, fresh: fresh.length, routed, errors: rss.errors },
  }

  let briefingId: string | null = null
  let channelId: string | null = null
  if (doneIds.length) {
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
    `[post-pulse research] ${opts.trigger}: ${doneIds.length} done, ${results.length - doneIds.length} failed, ${remaining.length} remaining; ` +
      `rss ${fresh.length} fresh/${routed} routed; searches ${spend.searches}; cost $${spend.cost.toFixed(3)}; briefing ${briefingId ?? 'none'}`
  )
  return { ...base, briefingId, channelId, costUsd: spend.cost }
}
