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
#   ELEVENLABS_API_KEY=<your key>   # optional: premium TTS; without it the app falls back to browser speech
npm run dev
```

Run all migrations in `supabase/migrations/` in order (001 through 029) in the Supabase SQL editor. Optionally run `supabase/seed.sql` for sample channels (run it once only — the channel insert has no conflict target) and `supabase/seed_post_pulse.sql` + `supabase/post_pulse_pipeline_stages_seed_update.sql` for the Post Pulse reference dataset (both idempotent, re-run to refresh).

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
  listen/page.tsx               — Listen Queue page
  read/[kind]/[id]/page.tsx     — Reading view for one briefing/digest (queue "Read" links land here)
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
    tts/elevenlabs/route.ts              — GET: premium-audio cost estimate / cached track; POST: generate (or fetch cached) audio
    tts/elevenlabs/voices/route.ts       — GET: curated + live premade ElevenLabs voices
    queue/route.ts                       — Listen Queue: GET list + cost summary, POST add, PATCH reorder
    queue/[id]/route.ts                  — PATCH progress/played (played also marks read), DELETE
    queue/[id]/content/route.ts          — GET item text for playback
    settings/route.ts                    — GET/PATCH settings (profile-scoped)
    profiles/route.ts                    — GET list, POST create profile
    cron/scheduled-briefings/route.ts    — GET (Vercel Cron, hourly): pre-generate scheduled briefings/digests
    cron/post-pulse-sync/route.ts        — GET (Vercel Cron, 1st+15th): STUB for the Post Pulse RSS/search pull
    post-pulse/queue/route.ts            — GET pending proposals, POST file a proposal (the only write path into pp_tools)
    post-pulse/queue/[id]/route.ts       — PATCH {action: accept|reject}: accept applies to pp_tools + logs pp_changelog
    post-pulse/chat/route.ts             — POST: STUB (501) for the Post Pulse research chat
  post-pulse/                   — Post Pulse (see section below): layout.tsx loads the pp_* dataset once
    page.tsx                    — Landing: pipeline map (four stages, post-production sub-groups, department chips)
    tools/page.tsx              — Tool list (client-side filter/sort over the dataset; state in the query string)
    tools/[id]/page.tsx         — Tool detail: attributes, alternatives, discontinued banner, doc deep link, changelog
    departments/[slug]/page.tsx — Department doc: tier roster + anchored markdown
    queue/page.tsx              — Review queue (accept/reject)
    changes/page.tsx            — pp_changelog, newest first
    activity/page.tsx           — Research activity feed: department runs + frontier scans (the only place research surfaces)
    chat/page.tsx               — Research chat shell (stub)

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
  ListenQueueClient.tsx       — /listen page body: Play all/Resume, cost line, QueueList, Played section
  ReadArticleClient.tsx       — /read/[kind]/[id] reading view: Listen bar + article + end-of-article read sentinel
  press/
    AudioPlayer.tsx           — Per-article Listen bar (both TTS providers) + SpokenArticle highlight wrapper + Queue toggle
    MiniPlayer.tsx            — Docked mini player (visible whenever the queue is non-empty)
    ExpandedPlayer.tsx        — Full player sheet: transport, scrub, speed, queue list
    QueueList.tsx             — Sortable "up next" list (jump / Read / remove) + QueueCostLine
    PlayerDock.tsx            — Mini + Expanded, mounted once in the root layout
    Masthead.tsx              — PULSE nameplate, subtitle, dateline rules
    TickerBar.tsx             — Key-figures bar under the masthead (settings.ticker_items)
      PressNav.tsx              — Bottom nav: Today/History/Listen/Pinned/Channels/Settings
    PressArticle.tsx          — Broadsheet article renderer: section rules, analyst-note asides, two-column, per-section pin (PRESS_MD_COMPONENTS exported for reuse)
  SpeechProviderWrapper.tsx   — TTS context provider
  post-pulse/
    Shell.tsx                 — Two-pane shell (desktop sidebar / phone drawer) + usePostPulse() dataset context
    PipelineMap.tsx           — Landing flowchart: stage row → in-place expansion → post-production sub-groups → department chips
    Sidebar.tsx               — Search, Department/Tier/Host App lens toggles, collapsible tree with counts, queue badge; exports listHref()
    ToolList.tsx              — Dense list rows, filter selects, sort, compare selection bar
    CompareOverlay.tsx        — Side-by-side 2–3 tools on the department's comparison_attributes
    AnchoredMarkdown.tsx      — react-markdown with heading ids ({#id} suffix or slugified text) for deep links
    QueueClient.tsx           — Pending proposals with old → new diff and accept/reject
    Badges.tsx                — TierBadge / TierDot / StatusBadge / HostChip

lib/
  post-pulse-types.ts — Client-safe Post Pulse types + constants (tiers, host apps, editable fields, sorts)
  post-pulse.ts       — Server-only Post Pulse data access: dataset, detail, changelog, queue accept/reject, enqueueProposal
  types.ts      — All TypeScript types and interfaces
  supabase.ts   — Server-only Supabase client (service_role key)
  anthropic.ts  — Anthropic client + DEFAULT_MODEL constant
  generation.ts — Shared briefing/digest generation (prompts, web-search stream, persist, usage) used by SSE routes AND the cron route
  cost.ts       — Token cost calculation and formatting
  press-sections.ts — Shared markdown parser: headline + ## sections + aside detection (renderer and speech)
  speechScript.ts   — Spoken script builder: signposts + chapter markers for both TTS providers
  elevenlabs.ts — Client-safe ElevenLabs constants (models, prices, curated voices), chunkText(), cost estimate
  tts.ts        — Server-only ElevenLabs synthesis, Supabase Storage audio cache, TTS usage logging, cleanup
  queue.ts      — Server-only Listen Queue: enqueue, list (+cost), reorder, progress, batch sort, cleanup
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
- **Effort** (`output_config.effort`; `BRIEFING_EFFORT` / `DIGEST_EFFORT` in `lib/generation.ts`, default `'medium'`, overridable per deployment with env `PULSE_BRIEFING_EFFORT` / `PULSE_DIGEST_EFFORT`): the lever on adaptive-thinking spend. At the API default (`high`), every channel spent 5k–10k output tokens per briefing beyond the ~1.5k–4k tokens of article, and a Sept 2026 Classic Movies run burned ~10.9k of its 12k writing-pass cap on thinking before truncating. Single-sample A/B on Classic Movies (Sept 3 2026): `low` 6,994 output tokens, `medium` 14,690, historical `high` 5.3k–13.8k — run-to-run variance in the search/filter loop swamps one sample, so judge a level on a week of cron runs via the `[generation] done:` log line (splits output into article / tool code / remainder ≈ thinking) and `usage_logs`. Even at `medium` the writing pass thinks >2.5k tokens before the first article character
- **Token caps** (`max_tokens`): 16000 briefings / 14000 digests (`BRIEFING_MAX_TOKENS` / `DIGEST_MAX_TOKENS`; env `PULSE_BRIEFING_MAX_TOKENS` / `PULSE_DIGEST_MAX_TOKENS` override them to force a truncation in tests). **`max_tokens` bounds each sampling pass of the server-side web-search loop, not the request** — `usage.output_tokens` sums every pass, so a request can legitimately report more output tokens than its cap (measured: a 450-token cap produced 1,540 output tokens in one request; the Sept 2026 truncation reported 13,993 against a 12,000 cap with zero continuations). The cap therefore only bites on the final writing pass (thinking + article), and headroom is free. Pause_turn continuations are separate requests with a fresh cap
- **Output guards** (`runWebSearchStream`): content under 300 chars ("no article text") or `stop_reason === 'max_tokens'` ("truncated") throws instead of persisting a stub/cut-off briefing — live routes surface the error, the cron's hourly catch-up regenerates. A truncated briefing is worse than none because nothing flags it as broken. The truncation warning reports the per-pass cap, the article's estimated tokens, the derived thinking share of the final pass (the API returns no `output_tokens_details` on these requests), and the article's first two lines ("Opening: …") so a Special Edition is recognisable in the log
- **Narration strip** (`stripPreHeadingNarration`, applied before the guards): Sonnet 5 sometimes narrates between tool calls ("I have great material now. Let me write the briefing.") and that text streams out ahead of the headline — sometimes glued to it on the same line. Every briefing opens with a Markdown heading, so everything before the first one is dropped from the persisted content (logged as `[generation] stripped N chars…`). The live SSE stream is unaffected. Present in archived briefings from at least Aug 5 to Sept 3 2026
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

Two backends behind one player (`contexts/SpeechContext.tsx`): the free browser `SpeechSynthesis` engine (default) and premium ElevenLabs audio (opt-in). The UI is `components/press/AudioPlayer.tsx` — a "Listen" bar (play/pause, stop, speed pills, premium cost confirmation) that is **always rendered on every finished article**: the live BriefingSheet card, the Daily Edition (archive), channel history, and digest history. `SpokenArticle` wraps the `PressArticle` on each surface and swaps in the sentence-highlighted view while that article is being read. There is no enable gate: `settings.tts_enabled` is a legacy column, no longer read (it used to hide the button — the reason "no audio controls" was reported on Sept 4 2026). Surfaces that don't already hold the profile's settings fetch them once via `useTtsSettings()`.

- **Standard (browser)**: `SpeechSynthesisUtterance`; sentence highlighting from `onboundary` char offsets over `splitSentences(stripMarkdown(content))`. Stops on tab hide (ghost-audio workaround).
- **Premium (ElevenLabs)**: settings `tts_provider = 'elevenlabs'` + `tts_elevenlabs_voice_id` (migration 018). Card flow: click play → `speech.prepareAudio()` synchronously (loading state + plays a silent WAV to unlock iOS autoplay) → `GET /api/tts/elevenlabs` → cached track plays immediately, otherwise an inline estimate ("7,842 characters · about $0.39 with Flash v2.5 · Rachel") with Generate / Standard voice buttons → `POST` generates → `speech.playAudio()` drives a single hidden `<audio>` element. Speed = `playbackRate` (never a regeneration). Keeps playing when the tab is hidden. Cards without a persisted id (still streaming) and servers without `ELEVENLABS_API_KEY` fall back to the browser voice.
- **Model**: `ELEVENLABS_DEFAULT_MODEL = eleven_flash_v2_5` ($0.05/1K chars, 40k-char cap → a briefing is one request). `ELEVENLABS_MODELS` carries per-model caps/prices; switching to Multilingual v2 (10k) or v3 (5k, $0.10/1K) makes `chunkText()` kick in automatically.
- **Chunking** (`lib/elevenlabs.ts` `chunkText`): paragraph boundaries first, sentence boundaries for oversize paragraphs, balanced chunk sizes (no tiny tail — voice consistency is per request). Chunks are synthesized sequentially with `previous_text`/`next_text`/`previous_request_ids` (ElevenLabs request stitching), MP3 segments concatenated (ID3 headers stripped) into one file, and per-chunk timings shifted by cumulative duration.
- **Highlighting**: exact, from the `with-timestamps` endpoint's character alignment reduced server-side to per-sentence start times over `chunks.join('\n\n')`. The `tts_audio` row stores both the sentences and their times; the client displays the server's sentences during premium playback so the two can never drift.
- **Playback URL**: `/api/tts/audio/[tts_audio.id]` streams the cached MP3 same-origin with HTTP Range support (206 + `Content-Range` + `Accept-Ranges`). Supabase's signed-download URL answers a Range request with 206 but no `Content-Range`/`Accept-Ranges`, which Chrome's media pipeline treats as a stalled load — never hand the storage URL to `<audio>` directly. (`signedAudioUrl` remains for server-side use.) Note: the Claude-in-Chrome automation profile cannot play any media element (blob and data URIs stall too), so premium playback is only verifiable in a normal browser; the standard voice and the queue layer were verified there
- **Cache**: private Storage bucket `tts-audio` (created on first use, 64 kbps mono MP3 ≈ 4 MB per 9-minute briefing), keyed `{kind}/{id}/{voice}.{model}.mp3`, one row per (kind, item_id, voice_id, model_id) in `tts_audio`. Re-listening never regenerates. Storage has no cascade: the briefing/digest/channel DELETE routes and the retention cleanup in `app/page.tsx` call `deleteTtsAudio()`.
- **Cost**: logged to `usage_logs` as `call_type = 'tts'`, `model = 'elevenlabs/<model>'`, `input_tokens` = characters billed, with the channel name — so it appears in the dashboard totals and per-channel breakdown. The settings-page estimator filters to `briefing`/`digest` and ignores it.
- Settings: `tts_voice` (browser voice URI), `tts_speed`, `tts_provider`, `tts_elevenlabs_voice_id` (`tts_enabled` is legacy/unused). Curated voice ids live in `ELEVENLABS_VOICES` (verified against the account's `/v1/voices` on 2026-09-04; Rachel is no longer premade); the picker merges the account's live premade voices when the key is set.
- **Account tier matters**: the free ElevenLabs tier caps API usage at ~10k characters/month (one briefing) and returns 402 `paid_plan_required` for library (non-premade) voices. Real use needs a paid plan; the $0.05/1K Flash rate is the paid API price.
- Test hooks: `synthesizeItem({ chunkCap })` forces chunking below the model cap; the e2e script (scratchpad `tts-e2e.mts`, run via `npx tsx` from `scripts/`) generates on a throwaway id, checks voices/timings/MP3/cache/cleanup, and removes everything it made.

## Cost Tracking

- `usage_logs` table records every API call with `call_type`, model, token counts, and cost. Migration 015 adds `cache_creation_tokens`, `cache_read_tokens`, `web_search_count` — the web-search server loop bills most of its tokens as cache writes/reads (invisible pre-015, so older `cost_usd` values vastly underreport web-search calls). `logUsage` falls back to the pre-015 columns if the migration isn't applied yet
- `calculateCost` prices cache writes at 1.25x input, cache reads at 0.1x input, and web searches at $10/1K
- **Failed runs are logged too**: a truncated, timed-out, or mid-stream-errored generation logs a `briefing_failed` / `digest_failed` row with whatever usage the API reported up to the failure (`runWebSearchStream` tracks `message_start`/`message_delta` usage for the in-flight request and attaches the snapshot to the thrown error; `getPartialUsage(err)` reads it). The usage dashboard sums all rows, so totals include this spend; the settings-page cost estimator filters to `briefing`/`digest` and ignores it. Zero-usage failures (a 429 before any work) are skipped
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

## Listen Queue (migration 019)

The queue is "what's next" — each item can be listened to or read — and the persistent player is the primary way through it. One playback system: article Listen buttons route through the queue.
- **Table `listen_queue`**: (profile_id, kind, item_id) unique; `position` (play order), `source` ('scheduled' | 'live' | 'manual'), `played_at` (NULL = unplayed), resume state on the row (`progress_sentence` browser voice / `progress_seconds` premium, `last_played_at`). Current position across devices is derived: the unplayed row touched most recently, else the first. Polymorphic (no FK): the briefing/digest/channel DELETE routes and the retention sweep call `removeQueueItemsFor()`; `listQueue()` drops orphans; played rows prune after 30 days.
- **Auto-queue**: `lib/generation.ts` enqueues every persisted briefing/digest (scheduled and live); the cron calls `sortBatch()` afterwards so a batch plays in edition order (digest first, briefings by channel position) behind older unplayed items.
- **On-demand audio**: nothing is generated when a batch lands. An uncached premium item generates (and caches) the first time it is played, with a loading state in the player; a generation failure falls back to the standard voice so the queue keeps moving. No per-item cost prompt — the expanded player shows the remaining uncached estimate above the list (`QueueCostLine`, via `estimateTtsCost`).
- **API**: `GET /api/queue` (items + cost summary), `POST` add {kind, itemId} (re-queues a played item at the end), `PATCH` reorder {orderedIds}; `/api/queue/[id]` PATCH progress / `played: true` (also sets `read_at` — listening to the end counts as reading) and DELETE; `/api/queue/[id]/content` returns the text when playback starts.
- **Tree**: `RootLayout → SpeechProvider (transport engine: status, sentence index, progress, seek/skip, ended signal) → QueueProvider (list, current item, auto-advance, resume, expanded/collapsed) → page + PlayerDock`. `contexts/QueueContext.tsx` is the single playback entry point (`playFromArticle`, `playItem`, `playAll`, `togglePlay`, `next/prev`); progress saves every 15s and on pause/tab hide/unload.
- **Player**: `components/press/MiniPlayer.tsx` — docked bottom bar visible whenever the queue is non-empty (above the home generate bar): monogram, title, "3 of 7", progress line along the top edge, prev / play-pause / next; tapping the bar expands. `ExpandedPlayer.tsx` — bottom sheet (same slide-up as the briefing sheet): large monogram, title, "channel · 3 of 7", scrubbable progress with elapsed/remaining (browser voice: sentences), rewind/forward 15s (browser: ±2 sentences), prev/play/next, speed pill, then the queue (`QueueList`: tap = jump, "Read" = open `/read/{kind}/{id}` without touching playback, × = remove, drag = reorder). Expand/collapse is UI state only. **End of queue**: the bar shows "Queue finished · N played, marked read" with a dismiss ×, rather than vanishing mid-interaction; it hides on dismiss, and an empty queue hides the bar.
- **Completion gotcha**: `prepareAudio()` plays a 0-sample data-URI WAV to unlock iOS audio, and that clip fires the element's `ended` event a few ms later — before the real track arrives. The engine ignores `ended` while `src` is a data URI or status is `loading`, and the queue only treats `ended` as completion after it has seen the item `playing` (`currentStarted`). Without both guards, pressing play on a Premium item jumped straight to "Queue finished" while audio was starting (Sept 4 2026 bug).
- **Reading mode**: `/read/[kind]/[id]` (`ReadArticleClient`) is the per-item reading view; reaching the end of the article marks it read (IntersectionObserver sentinel → `/api/read`). Reading does **not** complete the queue item — only listening to the end does; the Listen bar's "In queue · Remove" and the row × are the "skimmed it, don't need the audio" override.
- **Spoken script + chapters** (`lib/speechScript.ts`, both providers): the TTS input is a script built from the article's structure (`lib/press-sections.ts`, the same parser the broadsheet renderer uses), not the raw text. Verbal signposts are inserted as their own sentences: the headline as a beat, "Analyst note." before an aside, "First story: {channel}." / "Next story: …" before each digest story, a briefing's section title as a beat, and `#` sub-headlines inside a section body (multi-film Special Editions) as beats. The preceding paragraph is terminated with a period if it trails off, so a label always starts its own sentence. Leaked pre-headline narration in old archived briefings is dropped from speech. Stored content and display are untouched; the sentence-highlight view shows the labels because it is built from the same script. `chapters` = `{label, sentenceIndex}[]`; a digest's channel names are passed as `neverAside` so a channel called "… Outlook" is a story, not an analyst note.
- **Jump-to**: `speech.seekToSentence(i)` — Premium seeks `audio.currentTime` to the cached `sentence_times[i]`; Standard restarts the utterance at sentence `i`. The expanded player shows chapter chips under the scrub bar (current chapter derived from the current sentence). Premium cache rows carry `chapters` and `script_version` (migration 020); `SPEECH_SCRIPT_VERSION` is part of the cache lookup, so audio generated from an older script regenerates on next play (same storage path, overwritten). After chunking, chapters are re-located by matching label sentences (`locateChapters`).
- **Article bar** (`AudioPlayer`): Listen/Pause shortcut (Listen = queue it if needed + play through the queue), length, provider, sentence position, and the queue toggle. No inline transport — that lives in the player. `SpokenArticle` swaps in the highlighted view while an article is being read aloud, on every surface.
- `/listen` is the full-page version of the queue (Play all/Resume, cost line, list, Played section with Re-queue), linked from PressNav.

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

## Post Pulse (migrations 021–029)

A second, unrelated dataset inside the same app: a structured reference of AI tools across the commercial VFX pipeline (what exists, which department, how much of the job it takes over, what replaced what). Spec: `POST_PULSE_SPEC.md`; build prompt: `POST_PULSE_CLAUDE_CODE_PROMPT.md`; recovery: `POST_PULSE_DISASTER_RECOVERY.md` + `POST_PULSE_REBUILD_PROMPT.md`. Lives at `/post-pulse` (linked from the home hamburger menu). **Not profile-scoped** — the `pp_*` tables are one shared dataset. **Utility palette** (cream/ink + `press-accent`), not the broadsheet design.

- **Landing page = the pipeline map** (`components/post-pulse/PipelineMap.tsx`, Sept 14 2026): four stage boxes in a row (Pre-production, Production, Post-production, Finishing & delivery) with department counts, from `pp_departments.pipeline_stage` (migration 022; `pipeline_substage` only for post-production, enforced by check constraints). Clicking a stage expands it **in place** (component state, no route change, like the compare overlay). Post-production is two-level: a row of four sub-group boxes (asset_creation → performance_simulation → rendering_capture → comp_generative, `PP_PIPELINE_SUBSTAGES`), each expanding to department chips that link to `/post-pulse/departments/[slug]`. The other stages expand straight to a chip list — pre-production has one department since Sept 14 2026, production and finishing are an honest "nothing tracked here yet" empty state (0 departments is accurate, not an error). Departments with a NULL stage are listed under "Not placed on the pipeline yet" so nothing is hidden. Post-production opens by default. The mapping for the 13 seeded departments is `supabase/post_pulse_pipeline_stages_seed_update.sql` (run after 022; `seed_post_pulse.sql` doesn't touch these columns).
- **The tool list moved to `/post-pulse/tools`** (same query-string state). It is reached from a department doc ("N tools tracked"), from the sidebar (`listHref()` in `Sidebar.tsx` targets it), or the map's "Browse all tools" link. Breadcrumbs: department doc → "Pipeline / Department"; tool detail → "All tools / Department".

- **Content model, three layers**: (1) a top-level overview (not built yet — no table); (2) one long-form markdown doc per department (`pp_departments.overview_doc`) structured as `## Tier 1 — Automated {#tier-1}` / `{#tier-2}` / `{#tier-3}` sections — the reasoning lives here; (3) tool rows (`pp_tools`) with a short blurb, attributes, and `doc_anchor` pointing into the department doc. Tools never duplicate the "why".
- **Tables** (`pp_departments`, `pp_tools`, `pp_changelog`, `pp_queue`, `pp_chat_sessions` stub): `pp_tools.tier` ∈ automated | assisted | artist_led; `status` ∈ active | discontinued; `replacement_tool_id` self-FK (Ziva VFX → Houdini Otis is the canonical row); `attributes` jsonb keyed by the department's `comparison_attributes` (`[{key,label,type}]`, so compare is data-driven per department); `confidence` verified | queued; `(department_id, name)` is unique so the seed can upsert. `pp_changelog` gets a row per changed field. Discontinued tools stay in every view (badge + strikethrough), never deleted — the changelog is the point.
- **Data flow**: `app/post-pulse/layout.tsx` calls `fetchPostPulseDataset()` (all departments + tools + pending count, ~40 rows) and provides it via `usePostPulse()`; the sidebar, list, and compare overlay work client-side from that snapshot. Detail/doc/queue/changes pages fetch their own fresh rows. `router.refresh()` after a queue action re-fetches the layout.
- **URL state**: `/post-pulse/tools?dept=slug|tier=…|host=…&status=…&q=…&sort=…`. The sidebar's three lenses (Department / Tier / Host App) are UI state; clicking a tree node sets exactly one of `dept`/`tier`/`host` (clearing the others); the list's filter selects add the rest. Compare selection is component state (max 3, same department only).
- **One proposal shape for every producer** (`lib/post-pulse-proposals.ts`, client-safe, Sept 14 2026): `PpProposalInput` is a discriminated union — `tool_create` (department + fields; **name and tier required**), `tool_update` (toolId + changes), `department_create` (fields; name required, slug defaults), `department_update` (departmentId + changes) — plus an optional `flag: 'ambiguous' | 'incomplete'` for review notes that a human must resolve. `buildProposal()` validates and normalises (enum lower-casing, `source_urls` filtered) and returns the canonical `pp_queue` row; `enqueueProposal()` accepts only a `PpProposalInput`, so chat's `propose_change`, the research job, and `POST /api/post-pulse/queue` all fail loudly at **write time** (422) on a malformed proposal. `validateStoredProposal()` is the same rule set applied to a stored row: `acceptQueueItem` runs it first (422 with the reason instead of applying), and `QueueClient` runs it to disable Accept and show why. Flagged rows are never applicable — resolve them in chat (which files a complete proposal) or reject them. Origin: a research `new_tool` finding with no tier was written as a bare `{name, department}` row and blew up on accept days later (Beeble Canvas, Sept 14 2026); the research producer now stores a tier-less new tool as an `incomplete` note.
- **Cross-department duplicates** (migration 026 `pp_departments.related_department_ids uuid[]`, Sept 14 2026): departments can cross-reference each other without sharing tool rows (Concept & Image Generation ↔ Generative Media Models & Platforms is the pair that forced it — the research pass for Concept burned its budget rediscovering Runway/Veo/Kling, which live one department over). The department doc shows a "Related departments" section with a live preview of the related roster. `findNameCollision()` (`lib/post-pulse-proposals.ts`, token-normalised: parentheticals, punctuation, version tokens, and generic words like AI/Pro dropped, so "Midjourney V7" = "Midjourney" but "Beeble Canvas" ≠ "Beeble") runs in `buildProposal` for every `tool_create` against the whole dataset — a duplicate name is refused at write time with the existing entry named; `acceptToolItem` re-checks older rows; the queue UI warns; the research job turns such findings into updates to the existing entry and lists related departments' tools in its prompt as "already tracked, never new". `enqueueProposal(input, context?)` takes the dataset as context (or fetches it).
- **The only write path is the queue.** Nothing (UI, automation, chat) writes `pp_tools` directly except the seed. `POST /api/post-pulse/queue` (or `enqueueProposal()` server-side) files `{proposed_tool_id?, proposed_changes, source: rss|search|chat, source_urls}`; `PATCH /api/post-pulse/queue/[id] {action}` — **accept** applies only `PP_TOOL_EDITABLE_FIELDS` from `proposed_changes` (a `department_slug` is resolved to an id; unknown keys are ignored), writes one `pp_changelog` row per field that actually changed, stamps `last_verified_at`/`confidence='verified'`, and resolves the row; a proposal with no `proposed_tool_id` creates a tool (needs name + department + tier) and logs `created`. **reject** only resolves. Verified end-to-end on Sept 14 2026.
- **Research chat** (spec §6/§6a, migration 023, `lib/post-pulse-chat.ts`, Sept 14 2026): `POST /api/post-pulse/chat {sessionId?, departmentContextId?, message}` streams SSE (`session`, `searching`, `source`, `text_delta`, `queued`, `done {name, message}`, `error`). One turn = a manual tool loop on **`claude-sonnet-5`** (spec says Sonnet; adaptive thinking, `output_config.effort` from `PULSE_PP_CHAT_EFFORT`, default `medium`) with `web_search_20260209` (`max_uses` 6, shrunk on continuations) and a client-side **`propose_change`** tool. Every `propose_change` call is validated against the live dataset (unknown ids, duplicate names, unknown department slugs, missing name/tier all come back as `is_error` tool results) and then **written to `pp_queue` in the same turn** — no in-chat confirmation; review happens once, in the Queue view. `target_type` tool|department, `proposed_tool_id`/`proposed_department_id` for updates, `proposed_changes` = the fields + `note` (rationale), `source='chat'`, `source_urls` = the tool's URLs ∪ the turn's search results. The **system prompt is built from the database every turn**: every department (slug, id, stage/substage, compare-attribute keys) with its tools and ids, the tier framework (Tier 3 = directed creative judgment, not "AI can't"), the pipeline stages, the **hard confidence rule** (ambiguous entity → ask a clarifying question, never propose; the Fable case), proposal conventions, the search budget note, and, when the session has `department_context_id`, that department's name + overview_doc as a *default frame only* (unrelated questions still get full answers). `pause_turn` and `tool_use` both continue the loop (max 8 rounds). Both sides of the exchange persist to `pp_chat_sessions.messages` (assistant entries carry `sources` and `queued`), `updated_at` is touched, an untitled session is auto-named from its first message, and usage logs as `call_type='pp_chat'` (measured ≈ $0.09–0.16 per turn at medium effort with 1–3 searches). Verified live on Sept 14 2026: Wrap (Faceform) → queued as a new Rigging tool with 9 sources; "What about Fable?" → clarifying question, no queue row. Host-app/tier/status enum values from the model are lower-cased to the dataset convention before queueing.
- **Chat UI**: `/post-pulse/chat` (session list by `updated_at`, name + snippet + department chip, New session with optional scope, delete) → `/post-pulse/chat/[id]` (`ChatClient`: thread, rename-on-blur title, composer, streaming with "Searching: …" lines, per-message **"Added to queue · Review →"** indicator, collapsible sources). In-context launch: the department doc's "Research this department" button → `/post-pulse/chat/start?dept=slug`, which **resumes that department's most recent scoped session** (or creates "<Dept> research"); `?fresh=1` forces a new one. Decision: resume rather than always-create, so the department's research accumulates and empty sessions don't litter the list.
- **Department-targeted queue items** (§6a): accept updates/creates `pp_departments` with `PP_DEPARTMENT_EDITABLE_FIELDS`; `overview_doc` is replaced wholesale and the queue UI shows it as a collapsible block, not a diff. **Changelog (migration 025)**: `pp_changelog` rows target either a tool or a department — `target_type` ('tool' | 'department'), `tool_id` nullable, `department_id`, with a check constraint that exactly one id is set. Department accepts write one row per changed field (an `overview_doc` edit stores the full before/after text) plus a `created` row for new departments, `source = '<queue source>:<queue id>'`. The changes feed (`fetchRecentChanges`) joins both targets and summarises `overview_doc` rows as "replaced (N → M chars)"; `fetchDepartmentChangelog(id)` exists for a per-department view. Verified end to end on Sept 14 2026 (queue accept via the UI → row with `target_type='department'`, `tool_id` null → doc rendered the change → test rows removed). Migration 024 adds `pp_departments.last_researched_at` (stamped by future research runs; not read anywhere yet).
- **Research runs** (spec §5, `lib/post-pulse-research.ts` + `lib/post-pulse-rss.ts`, Sept 14 2026): `runResearch({trigger, departmentIds?, dueOnly?, timeBudgetMs?})` is shared by three triggers — the daily cron `/api/cron/post-pulse-sync` (`vercel.json` `0 12 * * *`; `dueOnly`: departments with `last_researched_at` null or ≥ `PP_RESEARCH_CADENCE_DAYS` = 14 days, oldest first — so each department is researched once a fortnight and a big sweep can span two daily runs), the global button on the pipeline map (`POST /api/post-pulse/research {}`), and the per-department button on a department doc (`{departmentId}`). Mechanism: (1) RSS pull (`PP_RSS_SOURCES`; **only CG Channel and VP Land publish feeds** — SideFX, Foundry, superrendersfarm have none and ActionVFX returns 429 to bots (checked Sept 2026), so those four are `feedUrl: null` and count as *known domains* for auto-publish while web search covers them), 21-day lookback, items whose link already appears in `pp_tools.source_urls`/`pp_queue.source_urls` are skipped; (2) **Haiku** (`claude-haiku-4-5`, forced `route_items` tool) routes fresh items to departments/tools; (3) per department, **Sonnet** + `web_search_20260209` verifies that department's RSS leads then runs queries derived from the doc and tool names, and reports via a `report_findings` tool (`kind` new_tool | update | confirmation | ambiguous | noop, `confidence`, `source_urls`, `from_lead`, `complete`); (4) publishing: `update` with `confidence='high'`, only `AUTO_PUBLISH_FIELDS` (vendor, blurb, source_urls, attributes, host_app) and a known-domain source or a verified entry → `applyToolUpdate()` (same write path as queue accept, changelog `source='research:<rss|search>:<run>'`); everything else — new tools, tier/status/name changes, ambiguous, medium/low confidence — → `pp_queue` with `source` rss (verified an RSS lead) or search; `confirmation` only re-stamps `last_verified_at` (no changelog row — confirmations aren't changes); (5) `last_researched_at` stamped on departments whose pass **completed** (a pass the model marks `complete:false`, or that throws, is `failed`: no stamp, retried next day); (6) **a native run record, not a Pulse briefing**: each completed department pass inserts `pp_department_research_runs` (migration 029: summary, findings/queued/auto-published counts), each frontier scan inserts `pp_frontier_scans`, and `/post-pulse/activity` (`fetchActivity`) is the single chronological feed of both; the sidebar "Activity" item shows runs in the last 24h or the last-run age (`PpDataset.lastRunAt` / `runsLast24h`). The first build wrote briefings into a `Post Pulse Research` channel (home banner, Listen Queue); reversed Sept 14 2026 per spec §5 — the channel's eight briefings were backfilled into the run tables and the channel deleted. **Post Pulse must not surface anything in Pulse** (no channel, briefing, banner, or queue presence). Usage logs as `call_type='pp_research'`. Departments run `PULSE_PP_RESEARCH_CONCURRENCY` (4) at a time within the time budget (230–240s under Vercel's 300s); unreached ones stay due. Measured: one department ≈ 60–70s / $0.15–0.25; five departments in parallel ≈ 100s / $0.94.
- **Frontier scans** (spec §5a, migration 028, Sept 14 2026): a second research mode in `lib/post-pulse-research.ts` (`frontierScan`, `publishFrontierFindings`, `fetchDueFrontierStages`). Scope = one `pipeline_stage`; queries are capability questions per sub-group ("what AI exists for <problem> that the roster lacks") from `frontierQueryPlan`, trade sources first; for the three empty stages it is pure discovery driven by `stageBrief()`. The `report_frontier` tool returns `new_tool` (needs `department_slug` in the stage + tier), `new_department` (name, slug, overview → a scaffolded tier doc via `scaffoldDepartmentDoc`, `pipeline_stage`, optional substage), `existing`, `noop`. Post-production findings are deduped with `findNameCollision` against every tracked tool; duplicates are reported as "already tracked", never re-proposed. **Everything queues as `source='frontier'`** (028 widened the `pp_queue.source` check — verified functionally: 'frontier' accepted, unknown values rejected); nothing auto-publishes. Cadence is per stage from `pp_frontier_scans` (latest `ran_at`; only completed scans are recorded, so a failed scan stays due). Triggers: the daily cron adds due stages after the due departments (same fit-the-time-budget start check); `POST /api/post-pulse/research {stage}` from the "Frontier scan this stage" button in the pipeline map's expansion panel (all four stages, including the empty ones). Results are recorded in `pp_frontier_scans` and shown in `/post-pulse/activity` with a Frontier pill (no Pulse briefing). Queue UI: a filled accent "Frontier" pill instead of the plain source label.
- **Search budget & plan** (Sept 14 2026): `PULSE_PP_RESEARCH_SEARCHES` (soft budget the prompt states; default **15**, was 5) and `PULSE_PP_RESEARCH_SEARCH_HEADROOM` (default 5, so `max_uses` 20) are env-tunable like `PULSE_PP_CHAT_EFFORT`. Cost scales ~linearly with searches: expect $0.45-0.70 per department at 15 and a full cycle in the $6-9 range, a deliberate thoroughness-over-cost call; dial the env var down if usage says otherwise. The per-department search plan (`buildQueryPlan`) is ORDERED: (0) the department's `follow_up_sources`, (1) trade sources (vp-land.com/tools, fxguide, CG Channel, befores & afters) searched by name, (2) vendor release notes / changelogs for the tracked players (vendors and tool names come from the department's own roster), (3) generic queries last, with "stop after two unproductive generic searches". **Follow-ups** (migration 027 `pp_departments.follow_up_sources jsonb`): `report_findings.follow_up_sources`, the model's concrete "check these next" list, is saved on the department after every pass (complete or not) via `saveDepartmentFollowUps()` (warns and skips until 027 is applied), fed to the next pass as plan step 0, shown on the department doc ("Next pass starts from: ..."), and included in a department-scoped chat's system prompt.
- **Research/chat gotcha — resuming after a client tool call in a search turn**: when a round used `web_search_20260209` and ended with OUR `tool_use` (chat's `propose_change`), the resume must carry the code-execution **container id** or the API returns 400 "container_id is required when there are pending tool uses generated by code execution with tools". The SDK's `finalMessage()` returns `container: null`, but the raw `message_start` / `message_delta` events carry it — `containerIdFromEvent()` captures it in the event loop and the next round passes `container:`. Three rules, all verified Sept 14 2026: replay the assistant turn **unchanged** (dropping the server-tool blocks around multiple thinking blocks is rejected as "thinking blocks … cannot be modified" — the first workaround, now removed); keep `web_search` declared on the resume (the container is only accepted while a code-execution-backed tool is present); and `pause_turn` resumes the same way. `web_search_20260209` runs the model's searches inside a code-execution step and Sonnet batches several per step — with `max_uses` equal to the stated budget the first run burned all five searches and read nothing. The prompt now states the budget (5), demands one search at a time, and `max_uses` carries +3 headroom. The briefing-generator's "budget note is load-bearing" lesson applies here too. The Pulse-briefing crossover and its profile-scoping mismatch are gone (see run records above).
- **Stubs for the next pass**: none in Post Pulse — automation and chat are both live. Per-department cadence is deliberately uniform until `last_researched_at` data shows how uneven the pace is.
- **Seed**: `supabase/seed_post_pulse.sql` — 14 departments (full pipeline; Hair, Groom & Feathers and Concept & Image Generation — the first pre-production department — added Sept 14 2026 via `supabase/post_pulse_department_hair_groom_2026-09-14.sql` / `supabase/post_pulse_department_concept_2026-09-14.sql`; since the Sept 14 2026 taxonomy change Look Development is part of "Texturing & Look Development" and Modeling is "Modeling & UVs" — `supabase/post_pulse_taxonomy_2026-09-14.sql` applied it to the live DB, the seed files match) and 34 tools from the Sept 2026 research session; upserts on `slug` / `(department_id, name)`, then sets `doc_anchor` from tier, stamps `last_verified_at`, and links Ziva → Otis. Keep it in its own file: `seed.sql`'s channel insert is not idempotent. The `{#anchor}` heading suffix is stripped by `AnchoredMarkdown` and becomes the element id; headings without one get a slugified id.
- **Gotchas**: `AnchoredMarkdown` re-scrolls to the hash after a short delay because Next's post-navigation scroll runs after commit; `:target` styling only fires on full loads (pushState doesn't update it). The queue page shows "no change" for a proposed value equal to the current one, and accept skips those fields. `ResearchButton` waits on a 1–3 minute fetch; Vercel's 300s function limit is the ceiling. Claude-in-Chrome could not resize the window, so the phone layout (drawer under `md:`) is unverified in a real browser.

## Unimplemented / Stub Features

These settings exist in the UI but have **no backend implementation**:
- **Email delivery** (`email_enabled`, `email_address`) — toggle and input exist, no sending logic
- **Push notifications** (`notifications_enabled`, `notification_time`) — toggle exists, no subscription/push logic
- **Briefing retention cleanup** runs in `app/page.tsx` on every page load — works but would be better as a cron/edge function
- **Post Pulse automation** (`/api/cron/post-pulse-sync`) and **research chat** (`/api/post-pulse/chat`, `/post-pulse/chat`) — stubs only; see the Post Pulse section

## Companion Files

- **`PULSE_REBUILD_PROMPT.md`** — Self-contained prompt to rebuild the entire app from scratch. Includes full schema SQL, design system, all features, and build order. Use if the codebase is lost.
- **`POST_PULSE_SPEC.md`** / **`POST_PULSE_CLAUDE_CODE_PROMPT.md`** — The Post Pulse spec and the build prompt it was implemented from (Sept 14 2026)
- **`POST_PULSE_DISASTER_RECOVERY.md`** — What Post Pulse is, its schema, data, routes, and how to restore it; **`POST_PULSE_REBUILD_PROMPT.md`** — prompt to rebuild the feature inside Pulse from scratch
- **`Pulse_DisasterRecovery/`** — Unrelated project notes (micropayment protocol), not Pulse recovery docs
