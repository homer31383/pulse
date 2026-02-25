export interface ChannelGroup {
  id: string
  name: string
  position: number
  created_at: string
  updated_at: string
}

export interface Channel {
  id: string
  name: string
  description: string | null
  instructions: string
  search_queries: string[]
  last_briefed_at: string | null
  position: number
  group_id: string | null
  serendipity_mode: boolean
  created_at: string
  updated_at: string
}

export interface Briefing {
  id: string
  channel_id: string
  content: string
  sources: Source[]
  model: string
  created_at: string
}

export interface BriefingWithCost extends Briefing {
  cost_usd: number | null
  input_tokens: number | null
  output_tokens: number | null
}

export interface Digest {
  id: string
  content: string
  sources: Source[]
  channel_ids: string[]
  channel_names: string[]
  model: string
  created_at: string
}

export interface DigestWithCost extends Digest {
  cost_usd: number | null
  input_tokens: number | null
  output_tokens: number | null
}

export interface WeeklySummary {
  id: string
  content: string
  channel_names: string[]
  model: string
  week_start: string
  created_at: string
}

export interface WeeklySummaryWithCost extends WeeklySummary {
  cost_usd: number | null
  input_tokens: number | null
  output_tokens: number | null
}

export interface Source {
  title: string
  url: string
  snippet?: string
}

export interface ConfigConversation {
  id: string
  channel_id: string
  messages: ConversationMessage[]
  saved_instructions_at: string | null
  created_at: string
  updated_at: string
}

export interface ConversationMessage {
  role: 'user' | 'assistant'
  content: string
}

// SSE event shapes streamed from /api/config-chat/[channelId]
export type ConfigChatStreamEvent =
  | { type: 'text_delta'; text: string }
  | { type: 'done' }
  | { type: 'error'; error: string }

export interface UsageInfo {
  inputTokens:  number
  outputTokens: number
  costUsd:      number
}

// SSE event shapes streamed from /api/briefings/[channelId]
export type BriefingStreamEvent =
  | { type: 'text_delta'; text: string }
  | { type: 'source'; source: Source }
  | { type: 'searching'; query: string }   // Claude initiated a web search
  | { type: 'done'; briefingId?: string; usage?: UsageInfo }
  | { type: 'error'; error: string }

export type BriefingDensity = 'dense' | 'balanced' | 'narrative'

export interface AppSettings {
  model: string
  briefing_density: BriefingDensity
  // Feature flags — all default OFF
  digest_mode: boolean
  highlights_enabled: boolean
  sharing_enabled: boolean
  feedback_enabled: boolean
  cross_channel_enabled: boolean
  watchlist_enabled: boolean
  watchlist_terms: string[]
  email_enabled: boolean
  email_address: string | null
  notifications_enabled: boolean
  notification_time: string
  discuss_enabled: boolean
  briefing_retention_days: number | null
  tts_enabled: boolean
  tts_voice: string | null
  tts_speed: number
}

export interface BriefingState {
  channelId: string
  channelName: string
  content: string
  sources: Source[]
  searchQueries: string[]   // queries Claude ran during generation
  status: 'streaming' | 'done' | 'error'
  error?: string
  briefingId?: string       // set in done event for persisted briefings
  usage?: UsageInfo
}

export interface Note {
  id: string
  briefing_id: string | null
  channel_name: string | null
  content: string
  created_at: string
}
