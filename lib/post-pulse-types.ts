// Post Pulse — client-safe types and constants.
// The pp_* tables are a shared reference dataset (not profile-scoped): AI
// tools across the VFX pipeline, grouped by department, tiered by how much
// of the work they take over. See POST_PULSE_SPEC.md.

export type PpTier = 'automated' | 'assisted' | 'artist_led'
// Migration 039: what an entry IS (kind) and how much AI is in it
// (ai_involvement), separate from tier (who does the labour). Tier is
// required for software and null for the other kinds, where it does not
// apply. Research and frontier scans may only create AI entries
// (buildProposal enforces it); chat may file anything helpful.
export type PpKind = 'software' | 'asset_library' | 'learning_resource' | 'reference'
export type PpAiInvolvement = 'none' | 'assisted' | 'core'
export type PpStatus = 'active' | 'discontinued'
export type PpConfidence = 'verified' | 'queued'
export type PpQueueSource = 'rss' | 'search' | 'chat' | 'frontier' // frontier = exploratory scan (spec §5a, migration 028)
export type PpQueueStatus = 'pending' | 'accepted' | 'rejected'

// One column of a department's compare table. Stored as jsonb on
// pp_departments.comparison_attributes so each department compares on its
// own fields (rigging and rendering don't share a schema).
export interface PpComparisonAttribute {
  key: string
  label: string
  type: 'text' | 'boolean' | 'number'
}

// Where a department sits in the production pipeline (migration 022). The
// landing page is a four-stage flowchart; only post-production is split
// further, into the sub-groups below. NULL = not mapped yet.
export type PpPipelineStage = 'pre_production' | 'production' | 'post_production' | 'finishing_delivery'
export type PpPipelineSubstage = 'asset_creation' | 'performance_simulation' | 'rendering_capture' | 'comp_generative'

export interface PpDepartment {
  id: string
  slug: string
  name: string
  overview_doc: string
  comparison_attributes: PpComparisonAttribute[]
  pipeline_stage: PpPipelineStage | null
  pipeline_substage: PpPipelineSubstage | null
  last_researched_at: string | null // migration 024: stamped by every research run that touched it
  related_department_ids: string[] // migration 026: cross-references, not shared ownership of tools
  follow_up_sources: PpFollowUpSource[] // migration 027: where the next research pass should start
  created_at: string
  updated_at: string
}

// A research pass's "check this next" recommendation (migration 027).
export interface PpFollowUpSource {
  source: string // a URL or a named source ("Midjourney release notes")
  added_at: string
}

// ── Research runs (spec §5) — client-safe result shapes ─────────────────

export type PpResearchTrigger = 'scheduled' | 'manual_global' | 'manual_department' | 'manual_frontier'

export interface PpResearchDepartmentSummary {
  departmentId: string
  slug: string
  name: string
  status: 'done' | 'failed' | 'skipped'
  error?: string
  searches: number
  leads: number
  published: { tool: string; fields: string[] }[]
  queued: { label: string; queueId: string; source: 'rss' | 'search' }[]
  confirmed: string[]
  sourceUrls: string[]
}

// One frontier scan (spec §5a): a whole pipeline stage, problem-oriented
// queries, every finding to the queue as source='frontier'.
export interface PpFrontierScanSummary {
  stage: PpPipelineStage
  stageLabel: string
  status: 'done' | 'failed'
  error?: string
  searches: number
  findings: number
  queued: { label: string; queueId: string; kind: 'tool' | 'department' }[]
  skippedExisting: string[] // findings that named something already tracked
  summary: string
  sourceUrls: string[]
}

export interface PpResearchRunSummary {
  trigger: PpResearchTrigger
  startedAt: string
  finishedAt: string
  departments: PpResearchDepartmentSummary[]
  remainingDepartmentIds: string[]
  frontier: PpFrontierScanSummary[]
  remainingStages: PpPipelineStage[]
  rss: { sources: number; fetched: number; fresh: number; routed: number; errors: { source: string; error: string }[] }
  costUsd: number
}

// One entry of the native activity feed (/post-pulse/activity): a
// department maintenance run (pp_department_research_runs, migration 029)
// or a frontier scan of a stage (pp_frontier_scans, migration 028). Post
// Pulse's research activity is visible ONLY here — it no longer writes
// into Pulse's briefings, home banner, or Listen Queue.
export interface PpActivityEntry {
  id: string
  kind: 'maintenance' | 'frontier'
  ranAt: string
  summary: string | null
  findingsCount: number
  queuedCount: number
  autoPublishedCount: number
  department: { id: string; name: string; slug: string } | null
  stage: PpPipelineStage | null
}

export const PP_PIPELINE_STAGES: { value: PpPipelineStage; label: string; short: string; description: string }[] = [
  {
    value: 'pre_production',
    label: 'Pre-production',
    short: 'Pre',
    description: 'Development, previs, planning. Nothing tracked yet.',
  },
  {
    value: 'production',
    label: 'Production',
    short: 'Prod',
    description: 'On-set capture and virtual production. Nothing tracked yet.',
  },
  {
    value: 'post_production',
    label: 'Post-production',
    short: 'Post',
    description: 'Where the VFX pipeline lives: assets, performance, rendering, comp.',
  },
  {
    value: 'finishing_delivery',
    label: 'Finishing & delivery',
    short: 'Finish',
    description: 'Grade, conform, mastering. Nothing tracked yet.',
  },
]

// Post-production's internal flow, in pipeline order.
export const PP_PIPELINE_SUBSTAGES: { value: PpPipelineSubstage; label: string; description: string }[] = [
  { value: 'asset_creation', label: 'Asset creation', description: 'Model and UV, texture and look dev, rig.' },
  { value: 'performance_simulation', label: 'Performance & simulation', description: 'Animate, deform, simulate, crowd.' },
  { value: 'rendering_capture', label: 'Rendering & capture', description: 'Render, denoise, capture the real world.' },
  { value: 'comp_generative', label: 'Comp & generative', description: 'Roto, track, composite, generate.' },
]

export interface PpTool {
  id: string
  department_id: string
  name: string
  tier: PpTier | null // null only when kind is not software (migration 039)
  kind: PpKind
  ai_involvement: PpAiInvolvement
  url: string | null
  pricing: string | null
  host_app: string | null
  status: PpStatus
  replacement_tool_id: string | null
  vendor: string | null
  blurb: string | null
  doc_anchor: string | null
  attributes: Record<string, unknown>
  source_urls: string[]
  last_verified_at: string | null
  confidence: PpConfidence
  created_at: string
  updated_at: string
}

// Since migration 025 a changelog row targets either a tool or a
// department (exactly one id set, matching target_type).
export interface PpChangelogEntry {
  id: string
  target_type: PpQueueTargetType
  tool_id: string | null
  department_id: string | null
  field_changed: string
  old_value: string | null
  new_value: string | null
  source: string | null
  created_at: string
}

// A proposal targets a tool row (the original case) or, since migration
// 023, a department row — new department, or a wholesale overview_doc edit.
export type PpQueueTargetType = 'tool' | 'department'

export interface PpQueueItem {
  id: string
  target_type: PpQueueTargetType
  proposed_tool_id: string | null
  proposed_department_id: string | null
  proposed_changes: Record<string, unknown>
  source: PpQueueSource
  source_urls: string[]
  status: PpQueueStatus
  created_at: string
  resolved_at: string | null
}

// Chat (spec §6): sessions are named and resumable; messages are a jsonb
// array of these. Assistant turns carry the web sources the model saw and
// the queue rows it filed during that turn (for the inline indicator).
export interface PpChatSource {
  title: string
  url: string
}

export interface PpChatQueued {
  id: string
  label: string
  targetType: PpQueueTargetType
  // The resolved identity of a tool proposal (migration 039 era), shown on
  // the chat's "Added to queue" line so the user can see which product was
  // filed, and which same-name products were not.
  identity?: {
    name: string
    vendor: string | null
    url: string | null
    pricing: string | null
    kind: PpKind | null
    aiInvolvement: PpAiInvolvement | null
    departmentName: string | null
    notThis: { name: string; vendor: string | null; url: string | null; why: string | null }[]
  }
  starred?: boolean // starred on add (settings.post_pulse_star_on_add)
  // What accepting would do, computed when filed (lib/post-pulse-effects.ts,
  // the same words as the catch-up panel's confirm). The server re-checks
  // everything on accept, so a stale line can only make accept refuse.
  effect?: string
  warning?: string | null
}

export interface PpChatMessage {
  role: 'user' | 'assistant'
  content: string
  created_at: string
  sources?: PpChatSource[]
  queued?: PpChatQueued[]
}

export interface PpChatSession {
  id: string
  name: string
  department_context_id: string | null
  messages: PpChatMessage[]
  proposed_queue_ids: string[]
  created_at: string
  updated_at: string
}

export const PP_CHAT_DEFAULT_NAME = 'New session'

// Workflow docs (spec §11, migration 030): a prompt-and-answer pair saved
// from chat, filed under one department. `stale` is computed at display
// time from pp_changelog (a referenced tool changed after the doc was
// saved or last verified) — never cached on the row.
export interface PpWorkflowDoc {
  id: string
  department_id: string // primary filing (anchors the URL)
  also_department_ids: string[] // migration 031: additional departments it is filed under
  title: string
  prompt: string // first user message of the saved slice (what Re-run asks again)
  content: string // last assistant answer of the slice
  messages: { role: 'user' | 'assistant'; content: string }[] // migration 032: the saved conversation slice ([] = single answer)
  referenced_tool_ids: string[]
  source_urls: string[]
  source_chat_session_id: string | null
  created_at: string
  last_verified_at: string | null
}

export interface PpWorkflowDocStaleChange {
  toolId: string
  toolName: string
  field: string
  changedAt: string
}

export interface PpWorkflowDocWithStatus extends PpWorkflowDoc {
  stale: boolean
  staleChanges: PpWorkflowDocStaleChange[]
  referencedTools: { id: string; name: string }[]
}

// Session list row: name + snippet of the last message, most recent first.
export interface PpChatSessionSummary {
  id: string
  name: string
  department_context_id: string | null
  updated_at: string
  created_at: string
  messageCount: number
  lastMessage: string | null
  lastRole: 'user' | 'assistant' | null
}

// Everything the /post-pulse shell needs: the dataset is small (tens of
// tools, a dozen departments) so the layout loads it once and the sidebar,
// list, and compare overlay work client-side from this snapshot.
export interface PpDataset {
  departments: PpDepartment[]
  tools: PpTool[]
  pendingQueueCount: number
  lastRunAt: string | null // newest research activity (either table), for the nav indicator
  runsLast24h: number
}

export const PP_TIERS: { value: PpTier; label: string; short: string; anchor: string; description: string }[] = [
  {
    value: 'automated',
    label: 'Tier 1 · Automated',
    short: 'Automated',
    anchor: 'tier-1',
    description: 'The tool does the work end to end; an artist reviews the output.',
  },
  {
    value: 'assisted',
    label: 'Tier 2 · AI-assisted',
    short: 'Assisted',
    anchor: 'tier-2',
    description: 'AI takes a real share of the work but an artist drives and finishes it.',
  },
  {
    value: 'artist_led',
    label: 'Tier 3 · Artist-led',
    short: 'Artist-led',
    anchor: 'tier-3',
    description: 'Still craft work; AI touches the edges at most.',
  },
]

export const PP_TIER_BY_VALUE = Object.fromEntries(PP_TIERS.map((t) => [t.value, t])) as Record<
  PpTier,
  (typeof PP_TIERS)[number]
>

export const PP_KINDS: { value: PpKind; label: string; plural: string; description: string }[] = [
  { value: 'software', label: 'Software', plural: 'software', description: 'An app, plugin, script or native toolset.' },
  { value: 'asset_library', label: 'Asset library', plural: 'asset libraries', description: 'Models, textures, scans or other ready-made assets.' },
  { value: 'learning_resource', label: 'Learning resource', plural: 'learning resources', description: 'A course, tutorial series or training.' },
  { value: 'reference', label: 'Reference', plural: 'references', description: 'Documentation, a paper, a site worth keeping.' },
]
export const PP_KIND_BY_VALUE = Object.fromEntries(PP_KINDS.map((k) => [k.value, k])) as Record<PpKind, (typeof PP_KINDS)[number]>

export const PP_AI_INVOLVEMENTS: { value: PpAiInvolvement; label: string; description: string }[] = [
  { value: 'core', label: 'AI core', description: 'AI is the product or does the central job.' },
  { value: 'assisted', label: 'AI assisted', description: 'AI features help with part of the work.' },
  { value: 'none', label: 'Non-AI', description: 'No AI or machine learning in it.' },
]
export const PP_AI_BY_VALUE = Object.fromEntries(PP_AI_INVOLVEMENTS.map((a) => [a.value, a])) as Record<
  PpAiInvolvement,
  (typeof PP_AI_INVOLVEMENTS)[number]
>

// Tools vs resources in counts: software counts as a tool, every other kind
// as a resource ("12 tools, 2 resources").
export function isResource(t: { kind?: PpKind | null }): boolean {
  return !!t.kind && t.kind !== 'software'
}

export function countLabel(list: { kind?: PpKind | null }[]): string {
  const resources = list.filter(isResource).length
  const tools = list.length - resources
  const t = `${tools} ${tools === 1 ? 'tool' : 'tools'}`
  if (!resources) return t
  const r = `${resources} ${resources === 1 ? 'resource' : 'resources'}`
  return tools ? `${t}, ${r}` : r
}

// Canonical host-app values from the spec. The column is free text so a
// tool can carry something else; the sidebar groups whatever it finds.
export const PP_HOST_APPS = ['Maya', 'Houdini', 'Nuke', 'standalone', 'web', 'plugin', 'native'] as const

export const PP_STATUSES: { value: PpStatus; label: string }[] = [
  { value: 'active', label: 'Active' },
  { value: 'discontinued', label: 'Discontinued' },
]

export const PP_QUEUE_SOURCES: Record<PpQueueSource, string> = {
  rss: 'RSS',
  search: 'Web search',
  chat: 'Chat',
  frontier: 'Frontier',
}

// Columns a queue item may propose. Anything else in proposed_changes is
// ignored on accept, so a malformed proposal can't write arbitrary columns.
export const PP_TOOL_EDITABLE_FIELDS = [
  'department_id',
  'name',
  'tier',
  'host_app',
  'status',
  'replacement_tool_id',
  'vendor',
  'blurb',
  'doc_anchor',
  'attributes',
  'source_urls',
  'kind', // migration 039
  'ai_involvement',
  'url',
  'pricing',
] as const

export type PpToolEditableField = (typeof PP_TOOL_EDITABLE_FIELDS)[number]

// Columns a department-targeted proposal may set. overview_doc is replaced
// wholesale on accept (spec §6a) — no prose diff.
export const PP_DEPARTMENT_EDITABLE_FIELDS = [
  'name',
  'slug',
  'overview_doc',
  'comparison_attributes',
  'pipeline_stage',
  'pipeline_substage',
] as const

export type PpDepartmentEditableField = (typeof PP_DEPARTMENT_EDITABLE_FIELDS)[number]

export const PP_SORTS = [
  { value: 'name', label: 'Name' },
  { value: 'tier', label: 'Tier' },
  { value: 'kind', label: 'Kind' },
  { value: 'host', label: 'Host app' },
  { value: 'vendor', label: 'Vendor' },
  { value: 'updated', label: 'Recently updated' },
] as const

export type PpSort = (typeof PP_SORTS)[number]['value']

// Display helpers shared by list, detail, and compare views.
export function hostAppLabel(host: string | null): string {
  if (!host) return '—'
  if (host === 'standalone') return 'Standalone'
  if (host === 'web') return 'Web'
  if (host === 'plugin') return 'Plugin'
  if (host === 'native') return 'Native'
  return host
}

export function formatAttributeValue(value: unknown, type: PpComparisonAttribute['type'] = 'text'): string {
  if (value === null || value === undefined || value === '') return '—'
  if (type === 'boolean' || typeof value === 'boolean') return value ? 'Yes' : 'No'
  if (Array.isArray(value)) return value.map(String).join(', ')
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

// Stable, URL-safe anchor from a heading. Mirrors the id generation in
// AnchoredMarkdown so seed docs and tool doc_anchor values line up.
export function slugifyHeading(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
}

// "New tool" / "New asset library" for a create proposal's title (migration
// 039), so a resource is never called a tool in the queue, panel or chat.
export function newEntryWord(kind: unknown): string {
  const k = typeof kind === 'string' ? PP_KIND_BY_VALUE[kind as PpKind] : undefined
  return k && k.value !== 'software' ? `New ${k.label.toLowerCase()}` : 'New tool'
}
