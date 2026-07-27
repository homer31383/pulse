# Pulse - Project Documentation

## Overview

Pulse is a personal AI briefing platform. Users create **channels** — topic-based feeds like "AI & Machine Learning" or "Cybersecurity" — and Pulse generates rich, web-researched briefings on demand using Claude's web search tool. Think of it as a personalized intelligence briefing system.

## Tech Stack

- **Framework**: Next.js 16.1.6 (App Router, React 18)
- **Database**: Supabase (PostgreSQL via service-role key, server-side only)
- **AI**: Anthropic Claude API (`@anthropic-ai/sdk` 0.115.0) with web search
- **Styling**: Tailwind CSS 3.4. Reading/home/archive views use the broadsheet "press" design (lavender paper `#F0ECF4`, indigo accent `#6B5CA5`, Georgia serif); utility pages (settings, channel config, notes) keep the older warm/parchment palette
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

Run all migrations in `supabase/migrations/` in order (001 through 017) in the Supabase SQL editor. Optionally run `supabase/seed.sql` for sample channels.

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
  pinned/page.tsx               — Pinned insights page (client component)
  briefing-history/page.tsx     — "The Archive": briefings + digests grouped by day (DailyArchiveClient)
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
    pins/route.ts                        — GET list, POST create pinned insight (profile-scoped)
    pins/[id]/route.ts                   — DELETE pinned insight
    read/route.ts                        — POST: batch mark briefings/digests read
    usage/route.ts                       — GET: usage stats (totals, daily, by-channel)
    settings/route.ts                    — GET/PATCH settings (profile-scoped)
    profiles/route.ts                    — GET list, POST create profile
    cron/scheduled-briefings/route.ts    — GET (Vercel Cron, hourly): pre-generate scheduled briefings/digests

components/
  HomeClient.tsx              — Main home screen: channel grid, DnD, generate bar, profile switcher
  BriefingCard.tsx            — Briefing display: TTS, highlights, sharing, feedback, discuss
  BriefingSheet.tsx           — Bottom sheet overlay with tab bar for multiple briefings
  ChannelCard.tsx             — Selectable channel row with drag handle
  GroupSection.tsx            — Collapsible group container with rename/delete
  ChannelConfigClient.tsx     — Config editor: Settings tab + Chat tab
  NewChannelClient.tsx        — New channel creation form
  SettingsClient.tsx          — Global settings page with usage dashboard
  BriefingHistoryClient.tsx   — Per-channel briefing history with search (used by /channels/[id]/history)
  DailyArchiveClient.tsx      — Day-grouped archive: one row per day ("July 25 — 12 briefings, 1 digest"), chevron expands individual entries inline, "Read all" opens a full-screen Daily Edition overlay (all entries in sequence, double-rule channel dividers, per-section collapse). Day boundaries use America/New_York so SSR and client group identically.
  BriefingHistorySection.tsx  — Collapsible briefing history (used in config page)
  DigestHistoryClient.tsx     — Digest history with expand/PDF/delete
  WeeklySummaryHistoryClient.tsx — Weekly summary history
  MarkdownRenderer.tsx        — Shared markdown renderer (links open in new tab; used by utility pages)
  press/
    Masthead.tsx              — PULSE nameplate, subtitle, dateline rules
    TickerBar.tsx             — Key-figures bar under the masthead (settings.ticker_items)
    PressNav.tsx              — Bottom nav: Today/History/Pinned/Channels/Settings
    PressArticle.tsx          — Broadsheet article renderer: section rules, analyst-note asides, two-column, per-section pin (PRESS_MD_COMPONENTS exported for reuse)
  SpeechProviderWrapper.tsx   — TTS context provider

lib/
  types.ts      — All TypeScript types and interfaces
  supabase.ts   — Server-only Supabase client (service_role key)
  anthropic.ts  — Anthropic client + DEFAULT_MODEL constant
  generation.ts — Shared briefing/digest generation (prompts, web-search stream, persist, usage) used by SSE routes AND the cron route
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

- **Default model**: `claude-sonnet-5` (configurable per profile in settings; premium option `claude-opus-4-8`). Legacy IDs (`claude-sonnet-4-6`, `claude-opus-4-6`) in old settings rows are mapped to their successors by `resolveModel()` in `lib/anthropic.ts`
- **Web search (briefings/digests)**: `web_search_20260209` tool (GA, no beta header) with dynamic filtering; `max_uses` caps the search loop at 6 per briefing / 10 per digest — each search iteration re-processes all prior results, so cost grows superlinearly with search count. Discuss/other routes still use the older `web_search_20250305` + beta header
- **Search budget prompt note is load-bearing**: the system prompt tells the model its `max_uses` limit. Without it, Sonnet 5 treats the "server tool use limit exceeded" error on search N+1 as an outage, retries with sandbox sleeps (minutes of silent wall-clock), and writes an apology instead of the briefing
- **Generation timeouts** (`runWebSearchStream`): 300s overall deadline + 120s stream-idle watchdog via AbortController — a stalled/grinding request throws "Generation timed out" instead of hanging until a platform limit
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

- `usage_logs` table records every API call with `call_type`, model, token counts, and cost. Migration 015 adds `cache_creation_tokens`, `cache_read_tokens`, `web_search_count` — the web-search server loop bills most of its tokens as cache writes/reads (invisible pre-015, so older `cost_usd` values vastly underreport web-search calls). `logUsage` falls back to the pre-015 columns if the migration isn't applied yet
- `calculateCost` prices cache writes at 1.25x input, cache reads at 0.1x input, and web searches at $10/1K
- Pricing in `lib/cost.ts`: Sonnet 5 ($3/$15 per M), Opus 4.8 ($5/$25 per M), plus legacy Sonnet 4.6 / Opus 4.6 entries
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

## Scheduled Briefings (Vercel Cron)

Pre-generates briefings server-side so they're ready when the app opens:
- **Settings** (migrations 013 + 016, per profile): `schedule_enabled`, `schedule_time` ('HH:MM' Eastern Time), `schedule_interval_days` (1 = daily, 2/3/4, 7 = weekly, 14 = bi-weekly), `schedule_channel_ids` (empty = all channels), `schedule_output` ('briefings' | 'digest' | 'both'). UI in the settings page ("Scheduled Briefings" section): "Generate every [interval] at [time]".
- **Per-channel schedule** (migration 017): `channels.schedule_interval_days` and `channels.schedule_output` ('briefing' | 'digest' | 'both'), both nullable — NULL inherits the profile-level settings. Per-row selects in the Settings channel list PATCH `/api/channels/[id]`.
- **Interval gate (per channel)**: briefing due-ness anchors to the channel's newest scheduled briefing; digest participation anchors to the newest scheduled digest whose `channel_ids` includes the channel. ET *calendar-day* comparison (not elapsed ms, so a 05:02 run stays eligible at 05:00 N days later). `daysSince === 0` falls through so catch-up runs complete a partial day; `0 < daysSince < interval` = not due; no anchor = due now.
- **Digest composition**: the digest covers exactly the digest-output channels due that day ("thin days are fine"); no digest-channels due → no digest. Still one digest per 20h dedupe window.
- **Cron**: `vercel.json` fires `/api/cron/scheduled-briefings` hourly (`0 * * * *`). The route requires `Authorization: Bearer $CRON_SECRET` (set `CRON_SECRET` in Vercel env vars — Vercel sends it automatically). A profile is eligible from its `schedule_time` **hour** (America/New_York, minutes ignored) through the next `CATCH_UP_HOURS` (3) hourly runs. All remaining items (channels + digest) generate **in parallel via `Promise.allSettled`** — per-item error isolation, per-item console logging. The `scheduled` flag is the progress tracker: each run queries which channels/digest already exist in the 20h dedupe window and only generates what's missing, so a timed-out or partially-failed run is completed by the next hourly invocation instead of being skipped. `maxDuration = 300`. Note: Vercel Hobby plan crons may be limited to daily — if so, change the schedule to e.g. `0 10 * * *` (6 AM EDT), though that loses catch-up retries.
- **Marking**: `briefings.scheduled` / `digests.scheduled` boolean columns (migration 013). Live generation omits the column (safe pre-migration).
- **Surfacing**: `app/page.tsx` fetches scheduled content from the last 18h (newest per channel + latest digest) and passes it to HomeClient. The banner is **read-state driven** (no localStorage, no dismiss button): prominent with an unread count ("3 unread briefings and a digest") while `read_at IS NULL` items remain, muted "All read · Reopen" once everything is read. "Read now" opens the BriefingSheet and POSTs `/api/read` for the batch.
- **Refactor note**: the briefing/digest SSE routes are now thin wrappers around `generateChannelBriefing` / `generateProfileDigest` in `lib/generation.ts` — edit prompts there, not in the routes.

## Broadsheet Press Design

The reading experience (BriefingCard/BriefingSheet), home screen, history/archive pages, and pinned page use a newspaper aesthetic. **Do not apply to settings, channel config, notes, or other utility pages.**
- **Palette**: `press.*` colors in tailwind.config (paper #F0ECF4, accent #6B5CA5, ink #2C2522, body #48404A, muted #7A7070, faint #9A9098, pin #B8B0C0, up #1D6E56, down #993C1D, hair = hairline rgba). Fonts: `font-georgia` for ALL editorial content, `font-chrome` (system sans) for ALL UI chrome.
- **CSS utilities** (globals.css): `.paper-page` (lavender bg + CSS-only grain, directional lighting, inset edge darkening), `.press-label` (9px uppercase accent label), `.press-rule-h` (0.5px hairline), `.press-fold` (faint fold line), `.press-columns` (two-column text with rule, ≥768px only).
- **PressArticle** splits briefing markdown by `##` headings: leading `#` → Georgia headline; sections titled like "Key Takeaways"/analysis → "Analyst note" aside (tinted bg, accent left border); other sections get a label+rule header with a bookmark pin (posts to `/api/pins`); long sections flow into two CSS columns on desktop; a fold line appears mid-article when ≥5 sections. No cards anywhere in reading views — hairline rules only.
- **TickerBar**: figures under the home masthead from `settings.ticker_items` (migration 014, JSONB `{label, value, change}`), edited manually in Settings → Ticker Bar. Hidden when empty.
- **PressNav**: bottom nav on press pages. "Channels" links to `/channels/new/config`.

## Read/Unread Tracking

- `briefings.read_at` / `digests.read_at` (migration 017), NULL = unread; `is_read` is derived, never stored. Per-item state is effectively per-user because content is profile-owned.
- **Marked read when**: live generation completes (born read — inserted with `read_at` set in `lib/generation.ts`); the home banner batch is opened; an archive/history entry is expanded; a Daily Edition is opened (whole day marked — "opening the paper reads the paper").
- `POST /api/read { briefingIds, digestIds }` batch-marks, only touching rows where `read_at IS NULL` (first-read time is kept). Clients keep an optimistic `localReadIds` Set.
- **Indicators**: press-accent dot + ink-weight preview on unread entries (DailyArchiveClient, BriefingHistoryClient, DigestHistoryClient); day rows show "N unread"; home banner shows unread counts.

## Pinned Insights

A lightweight reference shelf (no editing, no folders — pin and review only):
- Pin buttons live in `PressArticle` (one per article section, bookmark icon top-right of the section rule). Used in `BriefingCard` (live briefings + digests, once generation is done), `BriefingHistoryClient`, and `DigestHistoryClient`.
- `pinned_insights` table (migration 012): content, channel_name, source_date (date of the source briefing/digest), profile_id, created_at.
- `/pinned` page: chronological ruled list with per-item delete, linked from the home hamburger menu and PressNav. API: GET/POST `/api/pins`, DELETE `/api/pins/[id]` — profile-scoped via cookie.

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
8. **Web search versions**: Briefings/digests use GA `web_search_20260209` (no header); discuss and other routes still use `web_search_20250305` + `anthropic-beta: web-search-2025-03-05` header
9. **Supabase server-only**: Never import `lib/supabase.ts` in client components — will leak service role key

## Unimplemented / Stub Features

These settings exist in the UI but have **no backend implementation**:
- **Email delivery** (`email_enabled`, `email_address`) — toggle and input exist, no sending logic
- **Push notifications** (`notifications_enabled`, `notification_time`) — toggle exists, no subscription/push logic
- **Briefing retention cleanup** runs in `app/page.tsx` on every page load — works but would be better as a cron/edge function

## Companion Files

- **`PULSE_REBUILD_PROMPT.md`** — Self-contained prompt to rebuild the entire app from scratch. Includes full schema SQL, design system, all features, and build order. Use if the codebase is lost.
- **`DisasterRecovery/`** — Older recovery notes (predates PULSE_REBUILD_PROMPT.md, may be redundant)
