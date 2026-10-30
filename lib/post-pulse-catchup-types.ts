// Client-safe shapes for the Post-Pulse "While you were away" panel. The
// server side is lib/post-pulse-catchup.ts (compile only) and
// lib/post-pulse-catchup-summary.ts (the one on-demand model call).

export interface CatchupEntry {
  kind: 'briefing' | 'digest'
  id: string
  key: string               // `${kind}:${id}` — one item can appear under two channels (a split digest)
  headline: string
  excerpt: string
  createdAt: string
  dateLabel: string         // formatted on the server in ET so SSR and client agree
  scheduled: boolean
  unread: boolean
  older: boolean            // beyond the long-absence cap: hidden behind "Show N older"
}

export interface CatchupChannel {
  id: string
  name: string
  entries: CatchupEntry[]
}

// A pending Post-Pulse review-queue proposal (pp_queue). The queue is a
// to-do list, not a feed: every pending item shows regardless of
// post_pulse_last_seen, and "Mark all as seen" never hides one. isNew is
// only a tag (created after last_seen). pp_queue is shared, not
// profile-scoped: resolving an item resolves it for every profile.
export interface CatchupReviewItem {
  id: string
  title: string             // "New tool: Wrap" / "Update Houdini Otis" / "New department: …"
  department: string | null
  sourceLabel: string       // RSS / Web search / Chat / Frontier
  frontier: boolean
  effect: string            // what accepting would do, built from the item's own fields
  blocked: string | null    // why accept will be refused (name already tracked, target gone), else null
  warning: string | null    // what accept would REMOVE (attribute keys, a replaced overview doc), shown in the confirm
  note: string              // the proposal's rationale, truncated
  createdAt: string
  dateLabel: string
  isNew: boolean
  href: string              // where the review happens: /post-pulse/queue#q-<id>
}

export interface CatchupReview {
  items: CatchupReviewItem[]   // every ACTIONABLE pending item: new since last_seen first, then the rest, newest first in each
  newCount: number             // actionable items created after last_seen (a subset of items, never added to the briefing count)
  // Pending items accept would refuse by design (flagged ambiguous /
  // incomplete, or otherwise invalid): no rows, one "N need resolving in
  // chat" line. Counted separately so the header doesn't mislead.
  needsResolving: number
}

// Count-only lines under the list ("Plus 3 older unread · Archive"). v1 has
// one; research runs would be a further counter in CATCHUP_COUNTERS
// (lib/post-pulse-catchup.ts), with no panel change. The review queue needs
// rows, so it is a sibling (CatchupReview), not a counter.
export interface CatchupFooterLine {
  key: string
  text: string
  href: string
  linkLabel: string
}

export interface CatchupSummary {
  content: string
  model: string
  costUsd: number
  createdAt: string
}

export interface CatchupEstimate {
  model: string
  modelLabel: string
  items: number             // items fed to the summary (capped)
  inputChars: number
  typicalUsd: number
  maxUsd: number            // if the call used its whole max_tokens
}

export interface Catchup {
  snapshotAt: string        // upper bound of this snapshot; every "seen" write sends it
  itemKey: string           // hash of the summary's item set; `summary` is cached for exactly this key
  since: string             // lower bound (exclusive): last_seen, or 7 days back on a first visit
  firstVisit: boolean
  longAbsence: boolean
  sinceLabel: string        // "since Tuesday", "in the last 7 days"
  newCount: number          // distinct new briefings/digests (review items are counted in review.newCount)
  unreadCount: number       // distinct new briefings/digests with read_at null
  olderCount: number        // distinct items hidden behind "Show N older"
  channels: CatchupChannel[]
  footer: CatchupFooterLine[]
  review: CatchupReview
  collapsed: boolean
  summary: CatchupSummary | null   // cached for exactly this item set
  estimate: CatchupEstimate | null
}

export const CATCHUP_FROM_PARAM = 'from=post-pulse'
