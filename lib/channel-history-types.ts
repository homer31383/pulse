// Client-safe shapes and helpers for the channel history page.

export interface ChannelHistoryEntry {
  kind: 'briefing' | 'digest'
  id: string
  createdAt: string
  read: boolean
  headline: string
  excerpt: string
  coversChannels: number        // digests: length of channel_ids; briefings: 1
}

// Reading-view origin: /read/{kind}/{id}?from=channel:<uuid> makes the back
// arrow return to /channels/<uuid>/history.
export const CHANNEL_FROM_PREFIX = 'channel:'
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function channelFromParam(channelId: string): string {
  return `from=${CHANNEL_FROM_PREFIX}${channelId}`
}

export function channelIdFromParam(from: string | undefined): string | null {
  if (!from?.startsWith(CHANNEL_FROM_PREFIX)) return null
  const id = from.slice(CHANNEL_FROM_PREFIX.length)
  return UUID_RE.test(id) ? id : null
}

// The page's filter / search / "load more" state, saved when a row is opened
// and restored (with the scroll position) when the page mounts again, since
// both the reading view's back arrow (a push) and browser Back remount it.
export const HISTORY_SNAPSHOT_KEY = 'pulse-channel-history'
export const HISTORY_SNAPSHOT_TTL_MS = 60 * 60 * 1000

export function clearHistorySnapshot() {
  try { sessionStorage.removeItem(HISTORY_SNAPSHOT_KEY) } catch { /* storage unavailable */ }
}
