# Pulse - Project Documentation

## Overview

Pulse is a personal AI briefing platform. Users create **channels** — topic-based feeds like "AI & Machine Learning" or "Cybersecurity" — and Pulse generates rich, web-researched briefings on demand using Claude's web search tool. Think of it as a personalized intelligence briefing system.

## Tech Stack

- **Framework**: Next.js 16.1.6 (App Router, React 18)
- **Database**: Supabase (PostgreSQL via service-role key, server-side only)
- **AI**: Anthropic Claude API (`@anthropic-ai/sdk` 0.39.0) with web search beta
- **Styling**: Tailwind CSS 3.4 with custom warm/parchment color palette
- **Fonts**: Lora (serif body), Playfair Display (headings), Inter (UI/sans)
- **DnD**: `@dnd-kit` for drag-to-reorder channels and groups
- **Markdown**: `react-markdown` + `remark-gfm`
- **PDF Export**: `jspdf`
- **PWA**: Service worker + manifest.json
- **Deployment**: Vercel at https://mypulse-sepia.vercel.app

## How to Run

```bash
npm install
# Set env vars in .env.local:
#   NEXT_PUBLIC_SUPABASE_URL=https://lnuxspwttddbbpomcekg.supabase.co
#   SUPABASE_SERVICE_ROLE_KEY=<your key>
#   ANTHROPIC_API_KEY=<your key>
npm run dev
```

Run all migrations in `supabase/migrations/` in order (001 through 011) in the Supabase SQL editor. Optionally run `supabase/seed.sql` for sample channels.

## File Structure

```
app/
  layout.tsx                    — Root layout: PWA meta, fonts, SpeechProvider, SW registration
  page.tsx                      — Server component: fetches channels/settings/groups, renders HomeClient
  globals.css                   — Tailwind directives, parchment background, sheet animation
  channels/[id]/
    config/page.tsx             — Channel config page (or NewChannelClient for id="new")
    history/page.tsx            — Briefing history for a channel
  notes/page.tsx                — Saved notes/clips page (client component)
  share/[slug]/page.tsx         — Public shared briefing view (server component)
  settings/page.tsx             — Settings page wrapper
  digest-history/page.tsx       — Digest history page
  weekly-summary-history/page.tsx — Weekly summary history page
  api/
    briefings/[channelId]/route.ts       — POST: SSE stream briefing with web search
    briefings/[channelId]/[briefingId]/route.ts — DELETE briefing
    channels/route.ts                    — GET list, POST create (profile-scoped)
    channels/[id]/route.ts               — GET, PATCH, DELETE channel
    channels/[id]/copy/route.ts          — POST: copy channel to another profile
    channels/reorder/route.ts            — PATCH: reorder channels by position
    channel-groups/route.ts              — GET list, POST create (profile-scoped)
    channel-groups/[groupId]/route.ts    — PATCH rename, DELETE group
    channel-groups/reorder/route.ts      — PATCH: reorder groups
    config-chat/[channelId]/route.ts     — POST: SSE config chat stream (no web search)
    config-chat/[channelId]/synthesize/route.ts — POST: extract instructions+queries from chat
    config-conversations/[channelId]/route.ts   — GET/PUT conversation messages
    digest/route.ts                      — POST: SSE digest across channels with web search
    digests/[digestId]/route.ts          — DELETE digest
    weekly-summary/route.ts              — POST: SSE weekly summary (no web search)
    weekly-summaries/[summaryId]/route.ts — DELETE summary
    cross-channel/route.ts               — POST: SSE cross-channel thematic analysis
    discuss/route.ts                     — POST: SSE discussion chat with web search
    feedback/route.ts                    — POST: thumbs up/down on briefing
    share/route.ts                       — POST: create share link (slug)
    notes/route.ts                       — GET list, POST create note
    notes/[id]/route.ts                  — DELETE note
    usage/route.ts                       — GET: usage stats (totals, daily, by-channel)
    settings/route.ts                    — GET/PATCH settings (profile-scoped)
    profiles/route.ts                    — GET list, POST create profile

components/
  HomeClient.tsx              — Main home screen: channel grid, DnD, generate bar, profile switcher
  BriefingCard.tsx            — Briefing display: TTS, highlights, sharing, feedback, discuss
  BriefingSheet.tsx           — Bottom sheet overlay with tab bar for multiple briefings
  ChannelCard.tsx             — Selectable channel row with drag handle
  GroupSection.tsx            — Collapsible group container with rename/delete
  ChannelConfigClient.tsx     — Config editor: Settings tab + Chat tab
  NewChannelClient.tsx        — New channel creation form
  SettingsClient.tsx          — Global settings page with usage dashboard
  BriefingHistoryClient.tsx   — Full-page briefing history with search
  BriefingHistorySection.tsx  — Collapsible briefing history (used in config page)
  DigestHistoryClient.tsx     — Digest history with expand/PDF/delete
  WeeklySummaryHistoryClient.tsx — Weekly summary history
  MarkdownRenderer.tsx        — Shared markdown renderer (links open in new tab)
  SpeechProviderWrapper.tsx   — TTS context provider

lib/
  types.ts      — All TypeScript types and interfaces
  supabase.ts   — Server-only Supabase client (service_role key)
  anthropic.ts  — Anthropic client + DEFAULT_MODEL constant
  cost.ts       — Token cost calculation and formatting
  usage.ts      — Server-side usage logging to Supabase
  speech.ts     — stripMarkdown() and splitSentences() for TTS
```

## Architecture & Data Flow

### Server-Side Only Database Access
All Supabase calls use the service-role key and happen exclusively in:
- Server Components (page.tsx files)
- API Route Handlers (app/api/)

The `lib/supabase.ts` client must **never** be imported in `'use client'` files.

### SSE Streaming Pattern
Most AI features follow the same pattern:
1. Client POSTs to an API route
2. Route creates a `ReadableStream` with `text/event-stream` headers
3. Events are sent as `data: {json}\n\n` — types include: `searching`, `source`, `text_delta`, `rate_limited`, `done`, `error`
4. Client reads via `EventSource`-style parsing or `getReader()`

### Briefing Generation Flow
1. User selects channels on home screen, clicks "Generate"
2. HomeClient sends POST to `/api/briefings/[channelId]` for each channel
3. Channels are staggered 15 seconds apart to avoid rate limits
4. API route fetches: previous briefing, settings (model/density), other channels (if serendipity mode)
5. Constructs system prompt with density instructions, serendipity exclusions, watchlist terms
6. Streams via `anthropic.messages.stream()` with `web_search_20250305` tool
7. Captures search queries, web results (sources), and text deltas
8. Persists briefing + sources to `briefings` table, updates `last_briefed_at`
9. Logs usage to `usage_logs` table
10. On 429 rate limit: waits 65s and retries once automatically

### Digest Mode
Instead of per-channel briefings, generates a single unified digest across all selected channels. Uses the same web search tool but with a cross-channel system prompt.

## Claude API Integration

- **Default model**: `claude-sonnet-4-6` (configurable per profile in settings)
- **Web search**: Uses `web_search_20250305` tool with `anthropic-beta: web-search-2025-03-05` header
- **Streaming**: All generation uses `anthropic.messages.stream()` — never non-streaming
- **API calls that use web search**: briefings, digests, discuss
- **API calls without web search**: config-chat, synthesize, weekly-summary, cross-channel
- **Cost tracking**: Every API call logs to `usage_logs` with model, tokens, and cost

## Channel System

Channels are topic feeds with:
- **name** and **description** — what the channel covers
- **instructions** — system prompt for Claude when generating briefings
- **search_queries** — JSONB array of web search terms
- **group_id** — optional FK to `channel_groups` for organization
- **serendipity_mode** — boolean: excludes topics from other channels, seeks surprising content
- **position** — integer for drag-to-reorder

Channels are scoped to profiles via `profile_id`.

## Text-to-Speech (TTS)

- Uses browser `SpeechSynthesis` API (no server-side TTS)
- `SpeechProviderWrapper` provides context throughout the app
- `BriefingCard` has play/pause button and speed controls (0.5x-2x)
- `stripMarkdown()` cleans content for speech
- `splitSentences()` provides byte offsets for sentence-level highlighting during playback
- Settings: `tts_enabled`, `tts_voice` (browser voice name), `tts_speed`

## Cost Tracking

- `usage_logs` table records every API call with `call_type`, model, token counts, and cost
- Pricing in `lib/cost.ts`: Sonnet 4.6 ($3/$15 per M), Opus 4.6 ($15/$75 per M)
- Settings page shows: today/week/month/year/all-time totals, 30-day bar chart, per-channel breakdown
- History pages match costs to entries via timestamp proximity (within 120s)

## Multi-Profile Support

- `profiles` table with UUID primary keys
- Default profiles: Chris (`00000000-...0001`), Krista (`00000000-...0002`)
- Profile ID stored in cookie (`profile_id`), set by HomeClient on mount
- All data queries filter by profile: channels, groups, digests, weekly summaries, settings
- Settings table uses `id = profile UUID` as primary key
- "Copy channel to profile" feature on config page
- Profile switcher dropdown on home screen

## Serendipity Mode

Per-channel toggle. When enabled:
- Fetches all other channels' names and descriptions
- Appends exclusion list to system prompt
- Instructs Claude to avoid overlapping topics and seek surprising content

## Key Components

### HomeClient
- Profile selector, hamburger menu, mode toggle (Briefings/Digest)
- Channel grid with DnD reorder (channels + groups)
- Fixed generate bar at bottom with staggered generation
- BriefingSheet overlay for viewing results

### BriefingCard
- Markdown rendering with ReactMarkdown
- TTS playback with sentence highlighting
- Text selection → "Clip to Notes" highlight feature
- Thumbs up/down feedback
- Share link generation
- Inline "Discuss" chat panel with web search
- Source list, cost/token display, reading time

### ChannelConfigClient
- **Settings tab**: name, description, instructions, search queries (pill editor), group assignment, serendipity toggle, briefing history, copy to profile, delete
- **Chat tab**: Multi-turn conversation with Claude to develop channel instructions, "Save instructions" button calls synthesize endpoint

## Known Gotchas

1. **Next.js 16 async params**: Both `params` AND `cookies()`/`headers()` return `Promise<>` — must `await` them
2. **Next.js 16 config**: `eslint: {}` in `next.config.ts` is not a valid `NextConfig` property — will cause build error
3. **ESM packages**: `react-markdown` and `remark-gfm` are ESM-only — must be in `transpilePackages` in next.config.ts
4. **Service worker caching**: `sw.js` uses cache-first for static, network-first for API — check headers config in next.config.ts
5. **Rate limits**: Staggered 15s generation + automatic 65s retry on 429 — adjust if hitting limits
6. **Profile cookie**: Falls back to Chris's UUID (`00000000-...0001`) if not set
7. **Settings migration**: Settings `id` was `'default'`, now uses profile UUID — migration 011 handles conversion
8. **Web search beta**: Uses `anthropic-beta: web-search-2025-03-05` header — may change when GA
9. **Supabase server-only**: Never import `lib/supabase.ts` in client components — will leak service role key
