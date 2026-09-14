// Post Pulse — the ONE definition of what a queue proposal looks like.
// Client-safe (no Supabase import): the queue UI validates with it too.
//
// Every producer (chat's propose_change tool, the research job, the manual
// POST /api/post-pulse/queue) builds its row through buildProposal(), which
// validates and normalises at WRITE time, and the accept handler re-checks
// the stored row with validateStoredProposal(). A shape drift between a
// producer and the accept handler therefore fails loudly when the row is
// created, not weeks later when someone tries to review it. (The Beeble
// Canvas row of 2026-09-14 — a research new-tool proposal with no tier —
// is the case this exists for.)
import {
  PP_DEPARTMENT_EDITABLE_FIELDS,
  PP_HOST_APPS,
  PP_PIPELINE_STAGES,
  PP_PIPELINE_SUBSTAGES,
  PP_TIERS,
  PP_TOOL_EDITABLE_FIELDS,
  slugifyHeading,
  type PpQueueSource,
  type PpQueueTargetType,
} from '@/lib/post-pulse-types'

// A proposal that cannot be applied as-is: the producer could not resolve
// enough to propose a concrete row (ambiguous entity, missing tier…). It
// is stored so a human sees it, but Accept is refused; resolve it in chat
// (which files a complete proposal) or reject it.
export type PpProposalFlag = 'ambiguous' | 'incomplete'

export type PpProposalInput =
  | {
      kind: 'tool_create'
      department: { id: string; slug: string }
      fields: Record<string, unknown> // name + tier required; other PP_TOOL_EDITABLE_FIELDS optional
      note: string
      source: PpQueueSource
      sourceUrls?: string[]
      flag?: PpProposalFlag
    }
  | {
      kind: 'tool_update'
      toolId: string
      changes: Record<string, unknown> // subset of PP_TOOL_EDITABLE_FIELDS; may be empty for a "review this" note
      note: string
      source: PpQueueSource
      sourceUrls?: string[]
      flag?: PpProposalFlag
    }
  | {
      kind: 'department_create'
      fields: Record<string, unknown> // name required; slug defaults from name
      note: string
      source: PpQueueSource
      sourceUrls?: string[]
      flag?: PpProposalFlag
    }
  | {
      kind: 'department_update'
      departmentId: string
      changes: Record<string, unknown> // subset of PP_DEPARTMENT_EDITABLE_FIELDS
      note: string
      source: PpQueueSource
      sourceUrls?: string[]
      flag?: PpProposalFlag
    }

// What buildProposal needs to refuse a "new tool" that already exists
// somewhere in the dataset. Any object with these two lists qualifies —
// PpDataset does.
export interface PpProposalContext {
  tools: { id: string; name: string; department_id: string }[]
  departments: { id: string; name: string }[]
}

// Name normalisation for the cross-department collision check. Drops
// parentheticals ("Runway (Gen-4.5)"), punctuation, version-ish tokens
// (v7, 2.5, 3), and generic suffix words, so "Midjourney V7" and
// "Midjourney" collide while "Beeble Canvas" and "Beeble" do not (a real
// extra word means a distinct product — the producer must decide).
const GENERIC_TOKENS = new Set(['ai', 'pro', 'plus', 'studio', 'app', 'tool', 'gen', 'edition', 'version', 'the', 'for', 'and', 'of'])

export function normalizeToolName(name: string): string[] {
  return name
    .toLowerCase()
    .replace(/\([^)]*\)/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .filter((t) => t && !GENERIC_TOKENS.has(t) && !/^v?\d+(\.\d+)*$/.test(t))
}

export function findNameCollision(
  name: string,
  ctx: PpProposalContext,
  excludeToolId?: string | null
): { tool: PpProposalContext['tools'][number]; departmentName: string } | null {
  const tokens = normalizeToolName(name)
  if (!tokens.length) return null
  const key = tokens.join(' ')
  for (const tool of ctx.tools) {
    if (excludeToolId && tool.id === excludeToolId) continue
    if (normalizeToolName(tool.name).join(' ') !== key) continue
    const dept = ctx.departments.find((d) => d.id === tool.department_id)
    return { tool, departmentName: dept?.name ?? 'another department' }
  }
  return null
}

// The canonical stored row (pp_queue columns the producer sets).
export interface PpProposalRow {
  target_type: PpQueueTargetType
  proposed_tool_id: string | null
  proposed_department_id: string | null
  proposed_changes: Record<string, unknown>
  source: PpQueueSource
  source_urls: string[]
}

export type PpProposalKind = PpProposalInput['kind']

const TIER_VALUES = new Set<string>(PP_TIERS.map((t) => t.value))
const STAGE_VALUES = new Set<string>(PP_PIPELINE_STAGES.map((s) => s.value))
const SUBSTAGE_VALUES = new Set<string>(PP_PIPELINE_SUBSTAGES.map((s) => s.value))
const STATUS_VALUES = new Set(['active', 'discontinued'])

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v)
}

function pick(obj: Record<string, unknown>, keys: readonly string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const k of keys) if (k in obj && obj[k] !== undefined) out[k] = obj[k]
  return out
}

function httpUrls(list: unknown): string[] {
  if (!Array.isArray(list)) return []
  return Array.from(new Set(list.filter((u): u is string => typeof u === 'string' && /^https?:\/\//i.test(u))))
}

// Models capitalise enum values ("Standalone", "Assisted"); the dataset
// convention is the lowercase canonical list.
export function normalizeToolFields(changes: Record<string, unknown>): Record<string, unknown> {
  const out = { ...changes }
  if (typeof out.host_app === 'string') {
    const raw = out.host_app.trim()
    out.host_app = PP_HOST_APPS.find((h) => h.toLowerCase() === raw.toLowerCase()) ?? raw
  }
  if (typeof out.tier === 'string') out.tier = out.tier.trim().toLowerCase().replace(/[\s-]+/g, '_')
  if (typeof out.status === 'string') out.status = out.status.trim().toLowerCase()
  if (typeof out.name === 'string') out.name = out.name.trim()
  if ('source_urls' in out) out.source_urls = httpUrls(out.source_urls)
  return out
}

function normalizeDepartmentFields(changes: Record<string, unknown>): Record<string, unknown> {
  const out = { ...changes }
  if (typeof out.name === 'string') out.name = out.name.trim()
  if (typeof out.slug === 'string') out.slug = out.slug.trim().toLowerCase()
  if (typeof out.pipeline_stage === 'string') out.pipeline_stage = out.pipeline_stage.trim().toLowerCase()
  if (typeof out.pipeline_substage === 'string') out.pipeline_substage = out.pipeline_substage.trim().toLowerCase()
  return out
}

// ── Validation of field sets (shared by build and stored-row checks) ────

function validateToolFields(fields: Record<string, unknown>, create: boolean): string | null {
  if (create) {
    if (typeof fields.name !== 'string' || !fields.name.trim()) return 'a new tool needs a name'
    if (typeof fields.tier !== 'string' || !TIER_VALUES.has(fields.tier)) return 'a new tool needs tier = automated | assisted | artist_led'
  } else if ('tier' in fields && !TIER_VALUES.has(String(fields.tier))) {
    return 'tier must be automated | assisted | artist_led'
  }
  if ('status' in fields && !STATUS_VALUES.has(String(fields.status))) return 'status must be active | discontinued'
  if ('attributes' in fields && !isRecord(fields.attributes)) return 'attributes must be an object'
  if ('name' in fields && (typeof fields.name !== 'string' || !fields.name.trim())) return 'name must be a non-empty string'
  return null
}

function validateDepartmentFields(fields: Record<string, unknown>, create: boolean): string | null {
  if (create && (typeof fields.name !== 'string' || !fields.name.trim())) return 'a new department needs a name'
  if ('name' in fields && (typeof fields.name !== 'string' || !fields.name.trim())) return 'name must be a non-empty string'
  if ('pipeline_stage' in fields && fields.pipeline_stage !== null && !STAGE_VALUES.has(String(fields.pipeline_stage))) {
    return `pipeline_stage must be one of ${Array.from(STAGE_VALUES).join(' | ')}`
  }
  if ('pipeline_substage' in fields && fields.pipeline_substage !== null && !SUBSTAGE_VALUES.has(String(fields.pipeline_substage))) {
    return `pipeline_substage must be one of ${Array.from(SUBSTAGE_VALUES).join(' | ')}`
  }
  if ('comparison_attributes' in fields && !Array.isArray(fields.comparison_attributes)) return 'comparison_attributes must be an array'
  return null
}

// ── Build (write time) ──────────────────────────────────────────────────

export type BuildResult = { ok: true; row: PpProposalRow; kind: PpProposalKind } | { ok: false; error: string }

export function buildProposal(input: PpProposalInput, ctx?: PpProposalContext): BuildResult {
  const note = typeof input.note === 'string' ? input.note.trim() : ''
  if (!note) return { ok: false, error: 'a proposal needs a note (the rationale shown to the reviewer)' }
  const sourceUrls = httpUrls(input.sourceUrls)
  const flagged = input.flag ? { flag: input.flag } : {}

  switch (input.kind) {
    case 'tool_create': {
      if (!input.department?.id || !input.department?.slug) return { ok: false, error: 'a new tool needs a department' }
      const fields = normalizeToolFields(pick(isRecord(input.fields) ? input.fields : {}, PP_TOOL_EDITABLE_FIELDS))
      delete fields.department_id
      // A flagged note may be incomplete on purpose; a real create may not.
      const err = input.flag ? validateToolFields(fields, false) ?? (typeof fields.name === 'string' && fields.name ? null : 'a flagged note still needs a name') : validateToolFields(fields, true)
      if (err) return { ok: false, error: err }
      // Cross-department duplicate check (the Concept & Image Generation
      // incident, 2026-09-14): a "new tool" that is already tracked under
      // another department is refused at write time.
      if (ctx && typeof fields.name === 'string') {
        const clash = findNameCollision(fields.name, ctx)
        if (clash) {
          return {
            ok: false,
            error: `"${fields.name}" is already tracked as "${clash.tool.name}" in ${clash.departmentName} (id=${clash.tool.id}). Propose an update to that entry, or link the departments via related_department_ids, instead of duplicating it.`,
          }
        }
      }
      return {
        ok: true,
        kind: input.kind,
        row: {
          target_type: 'tool',
          proposed_tool_id: null,
          proposed_department_id: null,
          proposed_changes: { ...fields, department_id: input.department.id, department_slug: input.department.slug, note, ...flagged },
          source: input.source,
          source_urls: sourceUrls,
        },
      }
    }
    case 'tool_update': {
      if (!input.toolId) return { ok: false, error: 'a tool update needs toolId' }
      const changes = normalizeToolFields(pick(isRecord(input.changes) ? input.changes : {}, PP_TOOL_EDITABLE_FIELDS))
      const err = validateToolFields(changes, false)
      if (err) return { ok: false, error: err }
      return {
        ok: true,
        kind: input.kind,
        row: {
          target_type: 'tool',
          proposed_tool_id: input.toolId,
          proposed_department_id: null,
          proposed_changes: { ...changes, note, ...flagged },
          source: input.source,
          source_urls: sourceUrls,
        },
      }
    }
    case 'department_create': {
      const fields = normalizeDepartmentFields(pick(isRecord(input.fields) ? input.fields : {}, PP_DEPARTMENT_EDITABLE_FIELDS))
      const err = validateDepartmentFields(fields, true)
      if (err) return { ok: false, error: err }
      if (typeof fields.slug !== 'string' || !fields.slug) fields.slug = slugifyHeading(String(fields.name))
      return {
        ok: true,
        kind: input.kind,
        row: {
          target_type: 'department',
          proposed_tool_id: null,
          proposed_department_id: null,
          proposed_changes: { ...fields, note, ...flagged },
          source: input.source,
          source_urls: sourceUrls,
        },
      }
    }
    case 'department_update': {
      if (!input.departmentId) return { ok: false, error: 'a department update needs departmentId' }
      const changes = normalizeDepartmentFields(pick(isRecord(input.changes) ? input.changes : {}, PP_DEPARTMENT_EDITABLE_FIELDS))
      if (Object.keys(changes).length === 0) return { ok: false, error: 'a department update needs at least one editable field' }
      const err = validateDepartmentFields(changes, false)
      if (err) return { ok: false, error: err }
      return {
        ok: true,
        kind: input.kind,
        row: {
          target_type: 'department',
          proposed_tool_id: null,
          proposed_department_id: input.departmentId,
          proposed_changes: { ...changes, note, ...flagged },
          source: input.source,
          source_urls: sourceUrls,
        },
      }
    }
  }
}

// ── Validate a stored row (accept time, and the queue UI) ───────────────

export interface StoredProposalLike {
  target_type: PpQueueTargetType
  proposed_tool_id: string | null
  proposed_department_id: string | null
  proposed_changes: Record<string, unknown>
}

export type StoredValidation =
  | { ok: true; kind: PpProposalKind; flag: PpProposalFlag | null }
  | { ok: false; kind: PpProposalKind; flag: PpProposalFlag | null; error: string }

export function proposalKindOf(row: StoredProposalLike): PpProposalKind {
  if (row.target_type === 'department') return row.proposed_department_id ? 'department_update' : 'department_create'
  return row.proposed_tool_id ? 'tool_update' : 'tool_create'
}

export function validateStoredProposal(row: StoredProposalLike): StoredValidation {
  const kind = proposalKindOf(row)
  const changes = isRecord(row.proposed_changes) ? row.proposed_changes : {}
  const flag = changes.flag === 'ambiguous' || changes.flag === 'incomplete' ? (changes.flag as PpProposalFlag) : null
  if (flag) {
    return {
      ok: false,
      kind,
      flag,
      error:
        flag === 'ambiguous'
          ? 'This is an ambiguous review note, not an applicable proposal — resolve it in chat (which files a complete proposal) or reject it.'
          : 'This proposal is incomplete and cannot be applied as-is — resolve it in chat or reject it.',
    }
  }
  let err: string | null = null
  switch (kind) {
    case 'tool_create':
      err = validateToolFields(changes, true)
      if (!err && !changes.department_id && !changes.department_slug) err = 'a new tool needs a department (id or slug)'
      break
    case 'tool_update':
      err = validateToolFields(changes, false)
      break
    case 'department_create':
      err = validateDepartmentFields(changes, true)
      break
    case 'department_update':
      err = validateDepartmentFields(changes, false)
      if (!err && Object.keys(pick(changes, PP_DEPARTMENT_EDITABLE_FIELDS)).length === 0) err = 'a department update needs at least one editable field'
      break
  }
  return err ? { ok: false, kind, flag: null, error: `Malformed proposal (${err}). Re-run the producer that filed it.` } : { ok: true, kind, flag: null }
}
