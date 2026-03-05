# Pulse - Complete Rebuild Prompt

> Paste this entire document into Claude Code to rebuild the Pulse application from scratch.

## What You're Building

**Pulse** is a personal AI briefing platform. Users create topic-based "channels" (e.g., "AI & Machine Learning", "Cybersecurity") and Pulse generates rich, web-researched briefings on demand using Claude's web search capability. It's a PWA with a warm, editorial design aesthetic — think morning newspaper meets AI intelligence briefing.

Key capabilities:
- Per-channel AI briefings with live web search
- Unified digest mode across all channels
- Weekly summaries synthesized from past briefings
- Cross-channel thematic analysis
- Interactive "Discuss" chat on any briefing (with web search)
- Text-to-speech with sentence-level highlighting
- Multi-profile support (e.g., Chris and Krista each have their own channels)
- Drag-to-reorder channels and channel groups
- Channel configuration via AI chat (Claude helps you set up your channel)
- Serendipity mode (deliberately finds content outside your regular topics)
- Highlights/clips saved to notes
- Sharing, feedback, watchlist terms
- Full cost tracking dashboard

---

## Tech Stack & Dependencies

### package.json

```json
{
  "name": "pulse",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "next dev --turbopack",
    "build": "next build",
    "start": "next start",
    "lint": "next lint"
  },
  "dependencies": {
    "@anthropic-ai/sdk": "0.39.0",
    "@dnd-kit/core": "^6.3.1",
    "@dnd-kit/sortable": "^10.0.0",
    "@dnd-kit/utilities": "^3.2.2",
    "@supabase/supabase-js": "^2.47.0",
    "jspdf": "^4.2.0",
    "next": "16.1.6",
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "react-markdown": "^9.0.1",
    "remark-gfm": "^4.0.0"
  },
  "devDependencies": {
    "@types/node": "^20",
    "@types/react": "^18",
    "@types/react-dom": "^18",
    "eslint": "^8",
    "eslint-config-next": "14.2.18",
    "postcss": "^8.4.49",
    "tailwindcss": "^3.4.15",
    "typescript": "^5"
  }
}
```

### Environment Variables (.env.local)

```
NEXT_PUBLIC_SUPABASE_URL=<your-supabase-project-url>
SUPABASE_SERVICE_ROLE_KEY=<your-service-role-key>
ANTHROPIC_API_KEY=<your-anthropic-api-key>
```

---

## Supabase Schema (Full SQL)

Run these migrations in order in the Supabase SQL editor.

### Migration 001 — Initial Schema

```sql
-- Channels
CREATE TABLE channels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  instructions TEXT DEFAULT '',
  search_queries JSONB DEFAULT '[]'::jsonb,
  last_briefed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Briefings
CREATE TABLE briefings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id UUID NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  sources JSONB DEFAULT '[]'::jsonb,
  model TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_briefings_channel ON briefings(channel_id, created_at DESC);

-- Config conversations
CREATE TABLE config_conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id UUID NOT NULL UNIQUE REFERENCES channels(id) ON DELETE CASCADE,
  messages JSONB DEFAULT '[]'::jsonb,
  saved_instructions_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_config_conv_channel ON config_conversations(channel_id);

-- Auto-update updated_at trigger
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER channels_updated_at BEFORE UPDATE ON channels
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER config_conversations_updated_at BEFORE UPDATE ON config_conversations
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
```

### Migration 002 — Channel Position

```sql
ALTER TABLE channels ADD COLUMN position INTEGER;
UPDATE channels SET position = sub.rn - 1
FROM (SELECT id, ROW_NUMBER() OVER (ORDER BY created_at) AS rn FROM channels) sub
WHERE channels.id = sub.id;
```

### Migration 003 — Settings

```sql
CREATE TABLE settings (
  id TEXT PRIMARY KEY DEFAULT 'default',
  model TEXT DEFAULT 'claude-sonnet-4-6',
  briefing_density TEXT DEFAULT 'balanced',
  updated_at TIMESTAMPTZ DEFAULT now()
);
INSERT INTO settings (id) VALUES ('default');
```

### Migration 004 — Features

```sql
ALTER TABLE settings
  ADD COLUMN digest_mode BOOLEAN DEFAULT false,
  ADD COLUMN highlights_enabled BOOLEAN DEFAULT false,
  ADD COLUMN sharing_enabled BOOLEAN DEFAULT false,
  ADD COLUMN feedback_enabled BOOLEAN DEFAULT false,
  ADD COLUMN cross_channel_enabled BOOLEAN DEFAULT false,
  ADD COLUMN watchlist_enabled BOOLEAN DEFAULT false,
  ADD COLUMN watchlist_terms JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN email_enabled BOOLEAN DEFAULT false,
  ADD COLUMN email_address TEXT,
  ADD COLUMN notifications_enabled BOOLEAN DEFAULT false,
  ADD COLUMN notification_time TEXT DEFAULT '08:00',
  ADD COLUMN discuss_enabled BOOLEAN DEFAULT false;

CREATE TABLE notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  briefing_id UUID REFERENCES briefings(id) ON DELETE SET NULL,
  channel_name TEXT,
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE briefing_feedback (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  briefing_id UUID NOT NULL REFERENCES briefings(id) ON DELETE CASCADE,
  vote SMALLINT NOT NULL CHECK (vote IN (-1, 1)),
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE shared_briefings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  briefing_id UUID NOT NULL REFERENCES briefings(id) ON DELETE CASCADE,
  slug TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ DEFAULT now()
);
```

### Migration 005 — Usage Logs

```sql
CREATE TABLE usage_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  call_type TEXT NOT NULL,
  channel_id UUID,
  channel_name TEXT,
  model TEXT NOT NULL,
  input_tokens INTEGER NOT NULL,
  output_tokens INTEGER NOT NULL,
  cost_usd NUMERIC(10, 6) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_usage_created ON usage_logs(created_at DESC);
CREATE INDEX idx_usage_channel ON usage_logs(channel_id);
```

### Migration 006 — Briefing Retention

```sql
ALTER TABLE settings ADD COLUMN briefing_retention_days INTEGER;
```

### Migration 007 — Digests

```sql
CREATE TABLE digests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  content TEXT NOT NULL,
  sources JSONB DEFAULT '[]'::jsonb,
  channel_ids TEXT[] DEFAULT '{}',
  channel_names TEXT[] DEFAULT '{}',
  model TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);
```

### Migration 008 — Weekly Summaries

```sql
CREATE TABLE weekly_summaries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  content TEXT NOT NULL,
  channel_names TEXT[] DEFAULT '{}',
  model TEXT,
  week_start DATE,
  created_at TIMESTAMPTZ DEFAULT now()
);
```

### Migration 009 — Channel Groups

```sql
CREATE TABLE channel_groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  position INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE TRIGGER channel_groups_updated_at BEFORE UPDATE ON channel_groups
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE channels ADD COLUMN group_id UUID REFERENCES channel_groups(id) ON DELETE SET NULL;
```

### Migration 010 — TTS Settings

```sql
ALTER TABLE settings
  ADD COLUMN tts_enabled BOOLEAN DEFAULT false,
  ADD COLUMN tts_voice TEXT,
  ADD COLUMN tts_speed NUMERIC(3,1) DEFAULT 1.0;
```

### Migration 011a — Serendipity Mode

```sql
ALTER TABLE channels ADD COLUMN serendipity_mode BOOLEAN DEFAULT false;
```

### Migration 011b — Profiles & Multi-Profile Support

```sql
-- Profiles table
CREATE TABLE profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Default profiles
INSERT INTO profiles (id, name) VALUES
  ('00000000-0000-0000-0000-000000000001', 'Chris'),
  ('00000000-0000-0000-0000-000000000002', 'Krista');

-- Add profile_id to channels
ALTER TABLE channels ADD COLUMN profile_id UUID REFERENCES profiles(id) ON DELETE CASCADE;
UPDATE channels SET profile_id = '00000000-0000-0000-0000-000000000001';
ALTER TABLE channels ALTER COLUMN profile_id SET NOT NULL;
ALTER TABLE channels ALTER COLUMN profile_id SET DEFAULT '00000000-0000-0000-0000-000000000001';

-- Add profile_id to channel_groups
ALTER TABLE channel_groups ADD COLUMN profile_id UUID REFERENCES profiles(id) ON DELETE CASCADE;
UPDATE channel_groups SET profile_id = '00000000-0000-0000-0000-000000000001';
ALTER TABLE channel_groups ALTER COLUMN profile_id SET DEFAULT '00000000-0000-0000-0000-000000000001';

-- Add profile_id to digests
ALTER TABLE digests ADD COLUMN profile_id UUID REFERENCES profiles(id) ON DELETE CASCADE;
UPDATE digests SET profile_id = '00000000-0000-0000-0000-000000000001';
ALTER TABLE digests ALTER COLUMN profile_id SET DEFAULT '00000000-0000-0000-0000-000000000001';

-- Add profile_id to weekly_summaries
ALTER TABLE weekly_summaries ADD COLUMN profile_id UUID REFERENCES profiles(id) ON DELETE CASCADE;
UPDATE weekly_summaries SET profile_id = '00000000-0000-0000-0000-000000000001';
ALTER TABLE weekly_summaries ALTER COLUMN profile_id SET DEFAULT '00000000-0000-0000-0000-000000000001';

-- Migrate settings from id='default' to profile UUIDs
UPDATE settings SET id = '00000000-0000-0000-0000-000000000001' WHERE id = 'default';
INSERT INTO settings (id) VALUES ('00000000-0000-0000-0000-000000000002')
  ON CONFLICT (id) DO NOTHING;

-- Indexes
CREATE INDEX idx_channels_profile ON channels(profile_id, position);
CREATE INDEX idx_channel_groups_profile ON channel_groups(profile_id, position);
CREATE INDEX idx_digests_profile ON digests(profile_id, created_at DESC);
CREATE INDEX idx_weekly_summaries_profile ON weekly_summaries(profile_id, created_at DESC);
```

### Seed Data (Optional)

```sql
INSERT INTO channels (name, description, instructions, search_queries, profile_id) VALUES
('AI & Machine Learning',
 'Latest developments in artificial intelligence',
 'You are a senior AI research analyst. Search for and provide a comprehensive briefing on the latest developments in artificial intelligence and machine learning. Focus on: new model releases, breakthrough research papers, industry applications, regulatory developments, and notable funding/acquisitions.',
 '["artificial intelligence news today", "machine learning research breakthroughs", "AI industry developments", "large language model updates"]',
 '00000000-0000-0000-0000-000000000001'),
('Tech Industry',
 'Startups, funding rounds, and product launches',
 'You are a tech industry analyst. Search for and provide a comprehensive briefing on the technology industry. Cover: major product launches, funding rounds, IPOs, acquisitions, executive moves, and emerging trends.',
 '["tech industry news today", "startup funding rounds", "technology product launches", "tech acquisitions mergers"]',
 '00000000-0000-0000-0000-000000000001'),
('Cybersecurity',
 'Vulnerabilities, breaches, and threat intelligence',
 'You are a cybersecurity intelligence analyst. Search for and provide a briefing on cybersecurity developments. Focus on: new vulnerabilities (CVEs), data breaches, threat actor activity, security tool releases, and regulatory/compliance updates.',
 '["cybersecurity news today", "data breach reports", "CVE vulnerability disclosures", "threat intelligence updates"]',
 '00000000-0000-0000-0000-000000000001'),
('Finance & Markets',
 'Markets, economic data, and corporate finance',
 'You are a financial analyst. Search for and provide a briefing on financial markets and economic developments. Cover: major market movements, economic indicators, central bank actions, notable earnings, and sector trends.',
 '["financial markets news today", "stock market analysis", "economic indicators data", "corporate earnings reports"]',
 '00000000-0000-0000-0000-000000000001');
```

---

## Design System

### Color Palette (Tailwind)

```js
// tailwind.config.ts — extend colors
warm: {
  50: '#faf8f5', 100: '#f0ece5', 200: '#e0d8cc', 300: '#c8bba8',
  400: '#b09e85', 500: '#9a8568', 600: '#847155', 700: '#6b5c46',
  800: '#584c3b', 900: '#4a4033', 950: '#27211a',
},
brand: {
  50: '#f5f3ff', 100: '#ede9fe', 200: '#ddd6fe', 300: '#c4b5fd',
  400: '#a78bfa', 500: '#7c6fcd', 600: '#6d5dbd', 700: '#5b4ca8',
  800: '#4c3d8f', 900: '#3e3275', 950: '#271e4a',
},
cream: {
  50: '#fefdfb', 100: '#fdf9f3', 200: '#f5f0e8', 300: '#ede5d8',
  400: '#ddd2c0', 500: '#c8b99e',
},
ink: {
  50: '#a09585', 100: '#7a6e5e', 200: '#5c5347', 300: '#3d362e',
},
```

### Typography

```js
// Font families in tailwind.config.ts
fontFamily: {
  serif: ['var(--font-lora)', 'Georgia', 'serif'],
  display: ['var(--font-playfair)', 'Georgia', 'serif'],
  sans: ['var(--font-inter)', 'system-ui', 'sans-serif'],
}
```

- Body text: `font-serif` (Lora)
- Headings: `font-display` (Playfair Display)
- UI elements: `font-sans` (Inter)

### Theme

- Background: `bg-cream-200` (#f5f0e8) — warm parchment
- Cards: `bg-cream-50` with `border-cream-300/60` and subtle shadow
- Primary accent: `brand-500` (#7c6fcd) — soft violet
- Text: `ink-300` (dark), `ink-200` (medium), `ink-100` (light), `ink-50` (muted)
- Sticky headers: `bg-cream-200/95 backdrop-blur-sm`
- Rounded corners: `rounded-2xl` for cards, `rounded-xl` for buttons
- PWA theme color: `#7c6fcd`

### Global CSS

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

body {
  background: #f5f0e8;
}
/* Thin scrollbar */
::-webkit-scrollbar { width: 4px; height: 4px; }
::-webkit-scrollbar-thumb { background: #c8b99e; border-radius: 2px; }
/* Remove tap highlight on mobile */
* { -webkit-tap-highlight-color: transparent; }
/* Serif prose */
.prose { font-family: var(--font-lora), Georgia, serif; }
/* Sheet slide-up animation */
@keyframes slideUp { from { transform: translateY(100%); } to { transform: translateY(0); } }
.animate-slideUp { animation: slideUp 0.35s cubic-bezier(0.32, 0.72, 0, 1); }
/* Keyboard-aware sheet height */
.h-sheet { height: 90dvh; }
@supports not (height: 1dvh) { .h-sheet { height: 90vh; } }
/* Pulse dot animation */
@keyframes pulse-dot { 0%,100% { opacity: 1; } 50% { opacity: 0.4; } }
```

---

## Detailed View & Feature Specifications

### 1. Home Screen (`app/page.tsx` + `components/HomeClient.tsx`)

**Server Component** (`page.tsx`):
- Reads `profile_id` cookie (fallback: first profile or `00000000-...0001`)
- Fetches: channels (ordered by position), settings, channel groups, profiles
- If `briefing_retention_days` is set, deletes old briefings and digests
- Passes all data as props to `HomeClient`

**Client Component** (`HomeClient.tsx`):
- **Header**: Profile selector dropdown (left), app name "Pulse" with EKG heartbeat SVG icon (center), hamburger menu (right)
- **Hamburger menu items**: Weekly Summary, Cross-Channel Analysis, Notes, Digest History, Settings
- **Mode toggle**: Briefings / Digest pill toggle (only shown if `digest_mode` enabled in settings)
- **Selection bar**: "Select All" link, channel count, "+ Channel" link to `/channels/new/config`
- **Channel grid**: 1-column layout, each channel rendered via `ChannelCard`
- **Groups**: Channels can be organized into collapsible `GroupSection` containers
- **Drag-to-reorder**: dnd-kit with `SortableContext`, supports both channels and groups. Uses `group:` prefixed IDs for group items with `data.type` distinguishing groups from channels
- **"+ Group" button**: Creates new group inline
- **Fixed generate bar**: Bottom bar with "Generate" button showing count of selected channels. Triggers staggered generation (15s intervals between channels). Shows progress status.
- **Staggered generation**: For multiple channels, each starts 15 seconds after the previous. Shows "Queued" and "Starting in Xs" status. On 429 rate limit, shows "Rate limited - retrying in 65s" and auto-retries.
- **BriefingSheet overlay**: Opens when briefings are being generated or viewed
- **Weekly Summary button**: Always visible, highlighted violet on Sundays
- **Profile switching**: Sets cookie + localStorage, calls `router.refresh()` for instant SSR re-render

### 2. Channel Card (`components/ChannelCard.tsx`)

- Drag handle (grip icon, top-left)
- Config gear icon link (top-right, links to `/channels/[id]/config`)
- Channel name (bold)
- Description (muted text, truncated)
- Last briefed timestamp (relative: "2h ago", etc.)
- Green dot indicator when briefing exists
- Selection: click toggles selection, visual highlight when selected
- Checkbox behavior for multi-select

### 3. Briefing Sheet (`components/BriefingSheet.tsx`)

- Full-screen overlay with dark backdrop (click to close)
- Slide-up animation (`animate-slideUp`)
- Drag handle bar at top
- **Tab bar**: Horizontally scrollable strip of tabs, one per open briefing. Shows channel name + status dot (queued=gray, streaming=amber pulse, done=green, error=red). Active tab auto-scrolls into view.
- Close button (X)
- Content area renders `BriefingCard` for the active tab
- Closes on Escape key

### 4. Briefing Card (`components/BriefingCard.tsx`)

- **Header**: Channel name, date, reading time (~N min at 200 WPM)
- **Status states**: Queued (with countdown timer), Rate Limited (with retry countdown), Streaming (pulsing dots), Error, Done
- **Content**: Rendered via `ReactMarkdown` with `remark-gfm`, all links open in new tab
- **TTS** (when `tts_enabled`): Play/pause button, speed controls (0.5x-2x step 0.25), sentence-level highlighting using `SpeechSynthesis` boundary events. Uses `stripMarkdown()` and `splitSentences()` from `lib/speech.ts`.
- **Highlights** (when `highlights_enabled`): On text selection, shows "Clip to Notes" tooltip. POSTs to `/api/notes` with selected text, briefing ID, and channel name.
- **Feedback** (when `feedback_enabled`): Thumbs up/down buttons. POSTs to `/api/feedback`.
- **Sharing** (when `sharing_enabled`): Share button POSTs to `/api/share` to get a slug, then copies `{origin}/share/{slug}` to clipboard.
- **Discuss** (when `discuss_enabled`): "Discuss" button opens inline chat panel. Multi-turn conversation about the briefing with Claude, including web search capability. POSTs to `/api/discuss`.
- **Sources list**: Shows up to 5 sources with title and URL (links open in new tab)
- **Cost footer**: Shows input tokens, output tokens, and cost in USD
- Two rendering modes: `mode="sheet"` (larger, in BriefingSheet) and `mode="card"` (compact, in history views)

### 5. Channel Config (`app/channels/[id]/config/page.tsx` + `components/ChannelConfigClient.tsx`)

**Server Component**: Fetches channel, config conversation, briefings with cost data, groups, profiles

**Client Component** — Two tabs:

**Settings Tab**:
- Channel name input
- Group assignment dropdown (select from existing groups or "None")
- Description textarea
- Instructions textarea (monospace font, taller)
- Search queries: pill editor with add/remove, each query is an editable pill
- Serendipity mode toggle with description
- Briefing history section (collapsible, shows past briefings with expand/PDF export/delete)
- "Copy to Profile" section (dropdown to select target profile, copy button)
- Danger zone: Delete channel with two-step confirmation ("Delete" → "Confirm Delete")
- Fixed "Save Changes" button at bottom

**Chat Tab**:
- Multi-turn conversation with Claude about configuring the channel
- SSE streaming via `/api/config-chat/[channelId]`
- Auto-saves conversation to DB after each exchange via PUT to `/api/config-conversations/[channelId]`
- "Save instructions from this chat" button: calls `/api/config-chat/[channelId]/synthesize` which asks Claude to extract `{instructions, search_queries}` JSON from the conversation, then saves to channel and marks `saved_instructions_at`

### 6. New Channel (`components/NewChannelClient.tsx`)

- Simple form: channel name (required), description (optional)
- Create button (fixed at bottom)
- POSTs to `/api/channels`, then redirects to `/channels/[id]/config`

### 7. Settings Page (`app/settings/page.tsx` + `components/SettingsClient.tsx`)

Sections:
- **Model**: Radio buttons for Sonnet 4.6 / Opus 4.6
- **Briefing Depth**: Dense / Balanced / Narrative radio buttons
- **Briefing Format**: Digest mode toggle
- **History**: Retention days input (null = keep forever)
- **Content Tools**: Toggles for highlights, sharing, feedback, discuss
- **Intelligence**: Cross-channel analysis toggle, watchlist toggle + term pill editor
- **Audio**: TTS toggle, voice selector (browser voices), speed slider
- **Delivery**: Email toggle + address, push notifications toggle + time
- **Usage Dashboard**: Today/week/month/year/all-time cost totals, 30-day bar chart (pure CSS), per-channel breakdown table

Each setting change PATCHes `/api/settings` immediately with status indicator.

### 8. Notes Page (`app/notes/page.tsx`)

- Client component, fetches from `/api/notes`
- List of saved clips with channel name, content, timestamp
- Delete button (hover-reveal)
- Empty state when no notes

### 9. Shared Briefing (`app/share/[slug]/page.tsx`)

- Server component
- Resolves slug → briefing via `shared_briefings` table
- Renders briefing content with `MarkdownRenderer`
- Shows channel name, date, "Shared via Pulse" badge
- 404 fallback for invalid slugs

### 10. Briefing History (`app/channels/[id]/history/page.tsx`)

- Server component fetches all briefings for channel
- Renders `BriefingHistoryClient`: search bar, expandable accordion cards with ReactMarkdown, sources

### 11. Digest History (`app/digest-history/page.tsx`)

- Server component fetches digests + matched usage logs
- `DigestHistoryClient`: expandable cards, channel name tags, PDF export, delete, cost info, reading time

### 12. Weekly Summary History (`app/weekly-summary-history/page.tsx`)

- Server component fetches summaries + matched usage logs
- `WeeklySummaryHistoryClient`: week range display, channel tags (violet), expand/PDF/delete, cost info

### 13. Group Section (`components/GroupSection.tsx`)

- Collapsible container for channels
- Drag handle for group reordering
- Inline rename (click name → input)
- Delete group with confirmation (channels become ungrouped)
- Collapse/expand toggle

---

## API Route Specifications

### Briefing Generation (`POST /api/briefings/[channelId]`)
- Accepts `{ channel: Channel }` in body
- Reads profile from cookie for settings
- Fetches: previous briefing (for continuity), settings (model/density), other channels (if serendipity)
- Builds system prompt: channel instructions + density instruction + serendipity exclusions + watchlist terms
- User message includes: search queries, today's date, previous briefing context (truncated to 5000 chars)
- Streams with `web_search_20250305` tool via `anthropic-beta` header
- SSE events: `searching` (query), `source` (title+url), `text_delta`, `rate_limited` (retryIn), `done` (briefingId+usage), `error`
- Persists to `briefings` table, updates `last_briefed_at`, logs to `usage_logs`
- On 429: waits 65s, retries once

### Digest Generation (`POST /api/digest`)
- Accepts `{ channels: Channel[] }`
- Generates unified digest across all channels with web search
- System prompt includes channel list with search queries
- Max 12 search queries combined
- Persists to `digests` table with channel_ids and channel_names arrays

### Weekly Summary (`POST /api/weekly-summary`)
- No request body needed (uses profile from cookie)
- Fetches last 7 days of briefings from profile's channels
- Groups by channel (max 3 per channel, truncated to 2000 chars each)
- No web search — synthesis only
- Persists to `weekly_summaries` table

### Cross-Channel Analysis (`POST /api/cross-channel`)
- No request body (uses profile from cookie)
- Fetches last 7 days of briefings, identifies 3-5 thematic connections
- No web search — analysis only
- Does NOT persist (streaming only)

### Discuss (`POST /api/discuss`)
- Accepts `{ messages, briefingContent, channelName }`
- Multi-turn chat with briefing as context (truncated to 8000 chars)
- Uses web search for follow-up questions
- Logs usage, does not persist conversation

### Config Chat (`POST /api/config-chat/[channelId]`)
- Accepts `{ messages, channel }`
- No web search
- Helps user configure channel instructions and search queries

### Synthesize (`POST /api/config-chat/[channelId]/synthesize`)
- Accepts `{ messages, channel }`
- Asks Claude to extract `{instructions, search_queries}` JSON
- Saves to channels table and marks `saved_instructions_at` on config_conversations

### Settings (`GET/PATCH /api/settings`)
- Scoped by profile_id cookie
- PATCH accepts any subset of settings fields

### All other CRUD routes
- Channels: GET list (profile-scoped), POST create, GET/PATCH/DELETE by ID
- Channel groups: GET (profile-scoped), POST create, PATCH rename, DELETE, PATCH reorder
- Profiles: GET list, POST create (auto-creates settings row)
- Notes: GET list, POST create, DELETE by ID
- Feedback: POST (upsert vote)
- Share: POST (create or return existing slug)
- Usage: GET (totals, daily chart, per-channel breakdown)
- Delete routes for briefings, digests, weekly summaries

---

## Shared Components

### MarkdownRenderer
- Wraps `ReactMarkdown` with `remarkGfm`
- Forces all links to `target="_blank" rel="noopener noreferrer"`
- Exports `MARKDOWN_COMPONENTS` constant

### SpeechProviderWrapper
- Client component wrapping children in TTS context
- Provides speech synthesis state management

---

## Configuration Files

### next.config.ts
```typescript
import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  transpilePackages: ['react-markdown', 'remark-gfm'],
  headers: async () => [
    {
      source: '/sw.js',
      headers: [
        { key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' },
        { key: 'Content-Type', value: 'application/javascript; charset=utf-8' },
      ],
    },
  ],
}
export default nextConfig
```

### .eslintrc.json
```json
{ "extends": "next/core-web-vitals" }
```

### PWA Manifest (public/manifest.json)
```json
{
  "name": "Pulse",
  "short_name": "Pulse",
  "description": "AI-powered interest channel briefings",
  "start_url": "/",
  "display": "standalone",
  "background_color": "#f5f0e8",
  "theme_color": "#7c6fcd",
  "categories": ["news", "productivity"],
  "icons": [
    { "src": "/icons/icon.svg", "type": "image/svg+xml", "sizes": "any" },
    { "src": "/icons/icon-192.png", "type": "image/png", "sizes": "192x192" },
    { "src": "/icons/icon-512.png", "type": "image/png", "sizes": "512x512" },
    { "src": "/icons/icon-512-maskable.png", "type": "image/png", "sizes": "512x512", "purpose": "maskable" }
  ]
}
```

### Service Worker (public/sw.js)
- Cache name: `pulse-v1`
- Precaches: `/`, `/manifest.json`
- **Cache-first** for static assets (icons, fonts, CSS, JS)
- **Network-first** for API routes and page navigations

---

## Library Modules

### lib/supabase.ts
- Creates Supabase client with `createClient(url, serviceRoleKey)`
- **SERVER-SIDE ONLY** — never import in `'use client'` files

### lib/anthropic.ts
- Creates Anthropic client with API key from env
- Exports `DEFAULT_MODEL = 'claude-sonnet-4-6'`

### lib/cost.ts
- `calculateCost(model, inputTokens, outputTokens)`: Returns USD number
- Pricing: Sonnet 4.6 = $3 input / $15 output per million. Opus 4.6 = $15 input / $75 output per million.
- `formatCost(usd)`: Formats to 2-4 decimal places
- `formatTokens(n)`: Locale-formatted number

### lib/usage.ts
- `logUsage({callType, channelId?, channelName?, model, inputTokens, outputTokens, costUsd})`: Inserts row into `usage_logs`
- Call types: `briefing`, `digest`, `weekly_summary`, `cross_channel`, `discuss`, `config_chat`, `synthesize`

### lib/speech.ts
- `stripMarkdown(text)`: Removes code blocks, headings markers, bold/italic, links, images, list markers, blockquotes
- `splitSentences(text)`: Returns `{ sentences: string[], offsets: number[] }` — splits on `.!?` followed by space+uppercase

### lib/types.ts
Key types:
- `Profile { id, name, created_at }`
- `ChannelGroup { id, name, position, profile_id, created_at, updated_at }`
- `Channel { id, name, description, instructions, search_queries, last_briefed_at, position, group_id, profile_id, serendipity_mode, created_at, updated_at }`
- `Briefing { id, channel_id, content, sources: Source[], model, created_at }`
- `Source { title, url, snippet? }`
- `Digest { id, content, sources, channel_ids, channel_names, model, profile_id, created_at }`
- `WeeklySummary { id, content, channel_names, model, week_start, profile_id, created_at }`
- `AppSettings { model, briefing_density, digest_mode, highlights_enabled, sharing_enabled, feedback_enabled, cross_channel_enabled, watchlist_enabled, watchlist_terms, email_enabled, email_address, notifications_enabled, notification_time, discuss_enabled, briefing_retention_days, tts_enabled, tts_voice, tts_speed }`
- `BriefingDensity = 'dense' | 'balanced' | 'narrative'`
- `BriefingState { channelId, channelName, status, content, sources, usage?, briefingId?, error?, startedAt?, queuedAt?, rateLimitRetryAt? }`
- `BriefingStreamEvent` with types: `text_delta`, `source`, `searching`, `done`, `error`, `rate_limited`, `queued`
- `Note { id, briefing_id, channel_name, content, created_at }`
- `*WithCost` variants add `cost_usd, input_tokens, output_tokens` (nullable)

---

## Build Order

Follow this sequence:

1. **Project setup**: `npx create-next-app@latest pulse` with TypeScript, Tailwind, App Router, src=no
2. **Install dependencies**: All packages from package.json above
3. **Configure**: next.config.ts (transpilePackages + sw.js headers), tailwind.config.ts (full color palette + fonts + typography plugin), postcss.config.mjs, .eslintrc.json, globals.css
4. **Supabase schema**: Run all migrations 001-011 in order
5. **Environment**: Create .env.local with three keys
6. **Library modules**: `lib/supabase.ts`, `lib/anthropic.ts`, `lib/types.ts`, `lib/cost.ts`, `lib/usage.ts`, `lib/speech.ts`
7. **Root layout**: `app/layout.tsx` with fonts, PWA meta, SpeechProviderWrapper, SW registration
8. **PWA files**: `public/manifest.json`, `public/sw.js`, icon SVG
9. **Shared components**: `MarkdownRenderer.tsx`, `SpeechProviderWrapper.tsx`
10. **API routes** (in dependency order):
    - Settings, profiles, channels, channel-groups (CRUD)
    - Usage, notes, feedback, share
    - Config-conversations, config-chat, synthesize
    - Briefings (with web search + rate limit retry)
    - Digest, weekly-summary, cross-channel, discuss
11. **Channel management UI**: `ChannelCard`, `GroupSection`, `NewChannelClient`, `ChannelConfigClient` (with `BriefingHistorySection`)
12. **Briefing display**: `BriefingCard` (with TTS, highlights, discuss, feedback, sharing), `BriefingSheet`
13. **Home screen**: `HomeClient` (DnD, generate bar, staggered generation, profile switcher), `app/page.tsx`
14. **History pages**: `BriefingHistoryClient`, `DigestHistoryClient`, `WeeklySummaryHistoryClient` + their page.tsx wrappers
15. **Secondary pages**: Notes, Share, Settings (with `SettingsClient` usage dashboard)

---

## Critical Implementation Notes

1. **Next.js 16**: `params` AND `cookies()`/`headers()` are async — must `await` them everywhere
2. **No `eslint` key in next.config.ts** — it's not a valid NextConfig property in Next.js 16
3. **ESM packages**: react-markdown and remark-gfm must be in `transpilePackages`
4. **Server-only Supabase**: Use service_role key in `lib/supabase.ts`, never import in client components
5. **Web search tool**: Use `{ type: 'web_search_20250305', name: 'web_search' }` in tools array with `{ headers: { 'anthropic-beta': 'web-search-2025-03-05' } }` as second arg to `.stream()`
6. **SSE pattern**: All streaming routes return `new Response(stream, { headers: { 'Content-Type': 'text/event-stream; charset=utf-8', ... } })` with `ReadableStream` using `data: {json}\n\n` format
7. **Profile scoping**: Every list query must filter by `profile_id` from cookie. Default fallback: `'00000000-0000-0000-0000-000000000001'`
8. **Usage logging**: Fire-and-forget with `.catch(() => {})` — never block the response
9. **Cost matching**: History pages match usage_logs to entities by timestamp proximity (log created within 120s after entity)
10. **Staggered generation**: 15-second delays between channel briefing starts to avoid rate limits
11. **Rate limit handling**: On 429, send `rate_limited` event with `retryIn: 65`, sleep, then retry once
12. **Density instructions**: Appended to system prompt based on user's `briefing_density` setting
13. **Serendipity mode**: Fetches other channel names/descriptions, appends exclusion list to system prompt
14. **Previous briefing context**: Truncated to 5000 chars, included in user message for continuity
