// Post-Pulse stars ("very interested"), client-safe part. Migration 038.
//
// Two levels only: no row = unmarked, a pp_interest row = starred. Stars are
// per profile on top of the shared pp_* dataset. Targets: a tracked tool, a
// department, or a pending review-queue proposal (queue_item).
//
// Proposal stars are GROUP stars, derived at read time: proposals about the
// same thing (same tool, same department, or the same new name) form a
// group, and a proposal shows as starred when any pending member of its
// group has a star row. Separately, a proposal whose target tool or
// department is starred carries a "starred tool" / "starred department" tag
// and sorts with the starred ones (after the directly starred).

import { findNameCollision, normalizeToolName, validateStoredProposal } from './post-pulse-proposals'
import type { PpDataset, PpQueueItem, PpTool } from './post-pulse-types'

export type PpInterestTarget = 'tool' | 'department' | 'queue_item'
export const PP_INTEREST_TARGETS: readonly PpInterestTarget[] = ['tool', 'department', 'queue_item']

// A starred proposal stays starred for this long after a dismiss, so the
// dismiss undo (reopen, REOPEN_WINDOW_MS in lib/post-pulse.ts) brings the
// star back with it. Afterwards the listing's cleanup deletes the row.
export const PP_INTEREST_DISMISS_GRACE_MS = 60_000

// Every pending proposal, reduced to what stars need: group and target keys
// for the derivation, title and flags for "Your starred".
export interface PpPendingStarInfo {
  id: string
  title: string
  department: string | null
  flagged: boolean          // validateStoredProposal refuses it: "needs resolving in chat"
  groupKey: string
  targetKey: string | null  // 'tool:<id>' | 'department:<id>' when it is about a tracked one
  createdAt: string
}

export interface PpInterestState {
  tools: string[]
  departments: string[]
  queueItems: string[]      // pending proposals with their OWN star row (group stars are derived)
  pending: PpPendingStarInfo[]
  collapsed: boolean        // "Your starred" on the landing page (settings.post_pulse_starred_collapsed)
}

type DatasetLike = Pick<PpDataset, 'tools' | 'departments'>

function nameOf(item: PpQueueItem): string | null {
  const n = item.proposed_changes?.name
  return typeof n === 'string' && n.trim() ? n.trim() : null
}

// What the proposal is about, when that is something already tracked. A new
// tool whose name collides with a tracked one (findNameCollision, the check
// accept itself runs) is about that tool.
export function queueTargetKey(item: PpQueueItem, dataset: DatasetLike): string | null {
  if (item.target_type === 'department') {
    return item.proposed_department_id ? `department:${item.proposed_department_id}` : null
  }
  if (item.proposed_tool_id) return `tool:${item.proposed_tool_id}`
  const name = nameOf(item)
  const clash = name ? findNameCollision(name, dataset) : null
  return clash ? `tool:${clash.tool.id}` : null
}

// Proposals with the same key are one group: same tracked target, or the
// same new name (tool names normalised like the duplicate check).
export function queueGroupKey(item: PpQueueItem, dataset: DatasetLike): string {
  const target = queueTargetKey(item, dataset)
  if (target) return target
  const name = nameOf(item)
  if (item.target_type === 'department') {
    return name ? `newdept:${name.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()}` : `item:${item.id}`
  }
  const tokens = name ? normalizeToolName(name) : []
  return tokens.length ? `newtool:${tokens.join(' ')}` : `item:${item.id}`
}

// Same wording as QueueClient's and the catch-up panel's row titles.
export function queueItemTitle(item: PpQueueItem, dataset: DatasetLike): string {
  const name = nameOf(item)
  if (item.target_type === 'department') {
    const dept = item.proposed_department_id ? dataset.departments.find((d) => d.id === item.proposed_department_id) : null
    if (dept) return `Update department ${dept.name}`
    return item.proposed_department_id ? 'Update to a department that no longer exists' : `New department${name ? `: ${name}` : ''}`
  }
  const tool = item.proposed_tool_id ? dataset.tools.find((t) => t.id === item.proposed_tool_id) : null
  if (tool) return `Update ${tool.name}`
  return item.proposed_tool_id ? 'Update to a tool that no longer exists' : `New tool${name ? `: ${name}` : ''}`
}

export function pendingStarInfo(item: PpQueueItem, dataset: DatasetLike): PpPendingStarInfo {
  const c = item.proposed_changes ?? {}
  const tool = item.proposed_tool_id ? dataset.tools.find((t) => t.id === item.proposed_tool_id) : null
  const department =
    item.target_type === 'department'
      ? null
      : (typeof c.department_id === 'string' && dataset.departments.find((d) => d.id === c.department_id)?.name) ||
        (typeof c.department_slug === 'string' && dataset.departments.find((d) => d.slug === c.department_slug)?.name) ||
        (tool && dataset.departments.find((d) => d.id === tool.department_id)?.name) ||
        null
  return {
    id: item.id,
    title: queueItemTitle(item, dataset),
    department,
    flagged: !validateStoredProposal(item).ok,
    groupKey: queueGroupKey(item, dataset),
    targetKey: queueTargetKey(item, dataset),
    createdAt: item.created_at,
  }
}

// ── Cross-platform tag ──────────────────────────────────────────────────────
//
// A tool row has one department and one host_app (Maya / Houdini / Nuke /
// standalone / web / plugin), so "runs in several hosts" only exists in the
// free-form attributes. The rule, kept deliberately literal: read only the
// attribute keys below (plus the host_app column), drop text in parentheses
// ("Standalone (exports to Blender, Maya, ...)" names export targets, not
// hosts), and count the distinct host applications named from this fixed
// list. Two or more = cross-platform. The tag's tooltip lists them.
const HOST_ATTRIBUTE_KEYS = ['host_app', 'hosts', 'platforms', 'native_dcc', 'host_software']
const HOST_VOCABULARY: [string, RegExp][] = [
  ['Maya', /\bmaya\b/i],
  ['Houdini', /\bhoudini\b/i],
  ['Nuke', /\bnuke\b/i],
  ['Blender', /\bblender\b/i],
  ['3ds Max', /\b3ds ?max\b/i],
  ['Cinema 4D', /\bcinema ?4d\b|\bc4d\b/i],
  ['Unreal Engine', /\bunreal\b/i],
  ['Unity', /\bunity\b/i],
  ['DaVinci Resolve', /\bresolve\b/i],
  ['Fusion', /\bfusion\b/i],
  ['Flame', /\bflame\b/i],
  ['Natron', /\bnatron\b/i],
  ['After Effects', /\bafter effects\b/i],
  ['Premiere Pro', /\bpremiere\b/i],
  ['Final Cut Pro', /\bfinal cut\b/i],
  ['Avid Media Composer', /\bavid\b|\bmedia composer\b/i],
  ['Katana', /\bkatana\b/i],
  ['Mari', /\bmari\b/i],
  ['Substance', /\bsubstance\b/i],
  ['ZBrush', /\bzbrush\b/i],
  ['Photoshop', /\bphotoshop\b/i],
  ['Gaffer', /\bgaffer\b/i],
  ['Clarisse', /\bclarisse\b/i],
  ['Modo', /\bmodo\b/i],
  ['MotionBuilder', /\bmotionbuilder\b/i],
  ['iClone', /\biclone\b/i],
  ['Character Creator', /\bcharacter creator\b/i],
  ['Pro Tools', /\bpro tools\b/i],
  ['Baselight', /\bbaselight\b/i],
  ['ComfyUI', /\bcomfyui\b/i],
]

export function toolHostApps(tool: Pick<PpTool, 'host_app' | 'attributes'>): string[] {
  const parts: string[] = []
  if (tool.host_app) parts.push(tool.host_app)
  const attrs = tool.attributes ?? {}
  for (const key of HOST_ATTRIBUTE_KEYS) {
    const v = attrs[key]
    if (typeof v === 'string') parts.push(v)
    else if (Array.isArray(v)) parts.push(v.filter((x) => typeof x === 'string').join(', '))
  }
  const text = parts.join(', ').replace(/\([^)]*\)/g, ' ')
  return HOST_VOCABULARY.filter(([, re]) => re.test(text)).map(([label]) => label)
}

// Starred tools grouped by name, for "Your starred": tool rows are one per
// department, so a product tracked in two departments would be two rows.
// Today no name repeats across departments; the grouping makes it list once.
export function toolNameKey(name: string): string {
  const tokens = normalizeToolName(name)
  return tokens.length ? tokens.join(' ') : name.toLowerCase()
}
