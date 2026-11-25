// What accepting a queue proposal would do, in words. Client-safe and pure
// (no Supabase), shared by the catch-up panel's review rows and the research
// chat's inline Accept, so both confirms say the same thing. Mirrors
// acceptQueueItem: only editable fields apply, unchanged values are skipped,
// and an `attributes` proposal REPLACES the whole map.
import {
  PP_DEPARTMENT_EDITABLE_FIELDS,
  PP_KIND_BY_VALUE,
  PP_PIPELINE_STAGES,
  PP_TOOL_EDITABLE_FIELDS,
  type PpDataset,
  type PpKind,
  type PpQueueItem,
} from './post-pulse-types'

const TIER_WORDS: Record<string, string> = { automated: 'automated', assisted: 'AI-assisted', artist_led: 'artist-led' }
const FIELD_WORDS: Record<string, string> = {
  host_app: 'host app',
  replacement_tool_id: 'replacement',
  doc_anchor: 'doc anchor',
  source_urls: 'sources',
  ai_involvement: 'AI involvement',
  url: 'URL',
  department_id: 'department',
  overview_doc: 'overview doc',
  comparison_attributes: 'comparison attributes',
  pipeline_stage: 'pipeline stage',
  pipeline_substage: 'pipeline substage',
}

function listWords(items: string[]): string {
  if (items.length <= 1) return items.join('')
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`
}

function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null)
}

// What accepting would do, from the item's own fields and the current row —
// mirroring acceptQueueItem: only editable fields apply, unchanged values are
// skipped, and an `attributes` proposal REPLACES the whole map (keys it
// leaves out are removed, so the line names them).
export function describeEffect(item: PpQueueItem, dataset: PpDataset): string {
  const c = item.proposed_changes
  const deptName = (id: unknown) => dataset.departments.find((d) => d.id === id)?.name

  if (item.target_type === 'department') {
    if (!item.proposed_department_id) {
      const stage = PP_PIPELINE_STAGES.find((s) => s.value === c.pipeline_stage)?.label
      return `Adds a new department${typeof c.name === 'string' ? ` "${c.name}"` : ''}${stage ? ` to ${stage}` : ''}`
    }
    const current = dataset.departments.find((d) => d.id === item.proposed_department_id)
    if (!current) return 'Updates a department that no longer exists'
    const row = current as unknown as Record<string, unknown>
    const fields = PP_DEPARTMENT_EDITABLE_FIELDS.filter((f) => f in c && !same(row[f], c[f]))
    if (fields.length === 0) return `No changes to ${current.name}`
    if (fields.length === 1 && fields[0] === 'overview_doc') return `Replaces the ${current.name} overview doc`
    return `Changes ${listWords(fields.map((f) => FIELD_WORDS[f] ?? f))} on ${current.name}`
  }

  if (!item.proposed_tool_id) {
    const dept = deptName(c.department_id) ?? dataset.departments.find((d) => d.slug === c.department_slug)?.name
    const tier = typeof c.tier === 'string' ? TIER_WORDS[c.tier] ?? c.tier : null
    // Migration 039: name the kind for non-software entries and say when an
    // entry is non-AI, so the line never calls an asset library "a tool".
    const kind = typeof c.kind === 'string' ? PP_KIND_BY_VALUE[c.kind as PpKind] : null
    const what = kind && kind.value !== 'software' ? `a new ${kind.label.toLowerCase()}` : 'a new tool'
    const ai = c.ai_involvement === 'none' ? ', non-AI' : ''
    return `Adds ${what}${dept ? ` to ${dept}` : ''}${tier ? `, ${tier} tier` : ''}${ai}`
  }
  const tool = dataset.tools.find((t) => t.id === item.proposed_tool_id)
  if (!tool) return 'Updates a tool that no longer exists'
  const row = tool as unknown as Record<string, unknown>
  const fields = PP_TOOL_EDITABLE_FIELDS.filter((f) => f in c && !same(row[f], c[f]))
  if (fields.length === 0) return `Marks ${tool.name} verified; no field changes`
  const parts: string[] = []
  const plain = fields
    .filter((f) => f !== 'attributes')
    .map((f) => (f === 'department_id' ? `department to ${deptName(c.department_id) ?? 'another'}` : FIELD_WORDS[f] ?? f))
  if (plain.length) parts.push(`changes ${listWords(plain)}`)
  if (fields.includes('attributes') && c.attributes && typeof c.attributes === 'object') {
    const before = tool.attributes ?? {}
    const after = c.attributes as Record<string, unknown>
    const added = Object.keys(after).filter((k) => !(k in before))
    const changed = Object.keys(after).filter((k) => k in before && !same(before[k], after[k]))
    const removed = Object.keys(before).filter((k) => !(k in after))
    const bits = [
      added.length ? `adds ${listWords(added)}` : '',
      changed.length ? `changes ${listWords(changed)}` : '',
      removed.length ? `removes ${listWords(removed)}` : '',
    ].filter(Boolean)
    parts.push(`attributes: ${bits.join('; ') || 'same values, reordered'}`)
  }
  const line = `${parts.join('; ')} on ${tool.name}`
  return line.charAt(0).toUpperCase() + line.slice(1)
}

// The part of accept that destroys something, for the confirm's warning:
// an `attributes` proposal replaces the whole map (keys it omits are gone),
// and a department overview_doc is replaced wholesale. Both stay in
// pp_changelog, but nothing restores them.
export function describeRemoval(item: PpQueueItem, dataset: PpDataset): string | null {
  const c = item.proposed_changes
  if (item.target_type === 'department') {
    const current = item.proposed_department_id ? dataset.departments.find((d) => d.id === item.proposed_department_id) : undefined
    if (!current || typeof c.overview_doc !== 'string' || same(current.overview_doc, c.overview_doc)) return null
    const before = (current.overview_doc ?? '').length
    return before ? `Replaces the whole ${current.name} overview doc (${before.toLocaleString()} → ${c.overview_doc.length.toLocaleString()} chars)` : null
  }
  const tool = item.proposed_tool_id ? dataset.tools.find((t) => t.id === item.proposed_tool_id) : undefined
  if (!tool || !c.attributes || typeof c.attributes !== 'object') return null
  const after = c.attributes as Record<string, unknown>
  const removed = Object.keys(tool.attributes ?? {}).filter((k) => !(k in after))
  if (!removed.length) return null
  return `Removes ${listWords(removed)} from ${tool.name}'s attributes`
}
