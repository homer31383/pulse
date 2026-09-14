# Post Pulse — Disaster Recovery

*Last updated: September 14, 2026. Covers the first build pass (spec §3–§4, §7, §10; stubs for §5–§6).*

Post Pulse is a view inside Pulse (`/post-pulse`) that tracks AI tools across the commercial VFX pipeline: what exists, which department it belongs to, how much of the job it takes over (tier), what host app it runs in, what it replaced, and what changed. It replaces the "redo this research every couple of months" cycle with a structured, queryable dataset that a review queue keeps current.

It is **not** a separate app. It shares Pulse's Next.js 16 codebase, Supabase project, Vercel deployment, and the cream/ink utility palette. Its tables are prefixed `pp_` and are not profile-scoped: one shared dataset.

---

## 1. Where everything lives

| Concern | Location |
|---|---|
| Spec | `POST_PULSE_SPEC.md` |
| Build prompt used | `POST_PULSE_CLAUDE_CODE_PROMPT.md` |
| Rebuild prompt | `POST_PULSE_REBUILD_PROMPT.md` |
| Schema | `supabase/migrations/021_post_pulse.sql` |
| Data | `supabase/seed_post_pulse.sql` (13 departments, 34 tools) and `WorkingDocs/POST_PULSE_SEED_DATA.json` (earlier, less complete export of the same research) |
| Types (client-safe) | `lib/post-pulse-types.ts` |
| Data access (server-only) | `lib/post-pulse.ts` |
| Pages | `app/post-pulse/**` |
| API | `app/api/post-pulse/**`, `app/api/cron/post-pulse-sync/route.ts` |
| Components | `components/post-pulse/*` |
| Cron schedule | `vercel.json` (`/api/cron/post-pulse-sync`, `0 12 1,15 * *`) |
| Entry link | Home hamburger menu in `components/HomeClient.tsx` |
| Project notes | `CLAUDE.md` → "Post Pulse (migration 021)" |

Environment: the same `.env.local` / Vercel variables as Pulse (`NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`; `CRON_SECRET` gates the cron stub when set). No new secrets.

---

## 2. Content model (three layers)

1. **Overview doc** — a top-level "state of the field" synthesis. *Not built yet; there is no table for it.* The landing view is the tool list.
2. **Department docs** — `pp_departments.overview_doc`, markdown. Convention: an untitled opening paragraph, then three anchored sections:
   ```
   ## Tier 1 — Automated {#tier-1}
   ## Tier 2 — AI-assisted {#tier-2}
   ## Tier 3 — Artist-led {#tier-3}
   ```
   The `{#id}` suffix is stripped on render and becomes the heading's element id. Headings without one get a slugified id. This is where reasoning lives.
3. **Tool entries** — `pp_tools` rows: structured fields + one-line blurb + `doc_anchor` (defaults to the tier anchor). No long-form text; the detail page links into the department doc for the "why".

Tiers: `automated` (Tier 1, tool does the work, artist reviews), `assisted` (Tier 2, AI takes a real share, artist drives), `artist_led` (Tier 3, craft work).

---

## 3. Schema (migration 021, additive only)

```
pp_departments  id uuid pk, slug text unique, name, overview_doc text, comparison_attributes jsonb [{key,label,type:text|boolean|number}], created_at, updated_at
pp_tools        id uuid pk, department_id fk→pp_departments (cascade), name, tier check(automated|assisted|artist_led),
                host_app text (Maya|Houdini|Nuke|standalone|web|plugin|native by convention), status check(active|discontinued),
                replacement_tool_id fk→pp_tools (set null), vendor, blurb, doc_anchor, attributes jsonb {},
                source_urls text[], last_verified_at, confidence check(verified|queued), created_at, updated_at
                UNIQUE (department_id, name)   -- lets the seed upsert
pp_changelog    id, tool_id fk→pp_tools (cascade), field_changed, old_value, new_value, source, created_at
pp_queue        id, proposed_tool_id fk→pp_tools (set null, NULL = new tool), proposed_changes jsonb, source check(rss|search|chat),
                source_urls text[], status check(pending|accepted|rejected), created_at, resolved_at
pp_chat_sessions id, messages jsonb, proposed_queue_ids uuid[], created_at   -- stub, unused
```
`pp_set_updated_at()` trigger on departments and tools. Indexes on tools(department_id, tier, status), changelog(tool_id, created_at desc), queue(status).

**Migration 022** (`022_post_pulse_pipeline_stages.sql`) adds to `pp_departments`:
```
pipeline_stage    text check in (pre_production | production | post_production | finishing_delivery)
pipeline_substage text check in (asset_creation | performance_simulation | rendering_capture | comp_generative), only when stage = post_production
```
Values for the 13 seeded departments: `supabase/post_pulse_pipeline_stages_seed_update.sql` (all post_production; asset_creation = modeling, texturing, lookdev, rigging; performance_simulation = mocap-animation, muscle-skinning, simulation-fx, crowds; rendering_capture = rendering-denoising, capture-splats-photogrammetry; comp_generative = roto-tracking, compositing, generative-comfyui). The other three stages are intentionally empty until that research is done. Run it after 022; `seed_post_pulse.sql` never touches these columns.

---

## 4. Data invariants

- **Discontinued tools are never deleted.** They stay in every view with a badge and strikethrough; `replacement_tool_id` points at the successor. Canonical row: Ziva VFX → Houdini Otis (organic tissue solver); Maya ML Deformer is named in Ziva's blurb as the Maya-side successor (single FK, one canonical link).
- **The review queue is the only write path into `pp_tools`** other than the seed. Accepting a queue item applies only the columns in `PP_TOOL_EDITABLE_FIELDS` (`department_id, name, tier, host_app, status, replacement_tool_id, vendor, blurb, doc_anchor, attributes, source_urls`), writes one `pp_changelog` row per field that actually changed (values stringified; objects as JSON), stamps `last_verified_at` and `confidence='verified'`, and marks the row `accepted`. A `department_slug` in `proposed_changes` is resolved to an id. A `note` key is displayed but not written. Rejecting only sets `status='rejected'` + `resolved_at`.
- **Chat proposals must always queue** (spec §6) — no auto-publish from a conversational pass, even live. Only the future scheduled pull may auto-publish, and only for RSS-from-known-vendor or confirmations of verified entries (spec §5).
- `attributes` keys follow the department's `comparison_attributes`; extra keys are shown (italic) but not in the compare schema.
- Seed `last_verified_at` = `2026-09-14T12:00Z` (noon UTC so it reads as Sept 14 in US zones).

---

## 5. Routes and UI

**Pages** (`app/post-pulse/`, all `force-dynamic`):
- `layout.tsx` — loads the whole dataset (`fetchPostPulseDataset()`), renders `PostPulseShell` (desktop sidebar / phone drawer) and provides `usePostPulse()`. Shows a "run migration 021" notice instead of a 500 if the tables are missing.
- `page.tsx` → `PipelineMap` (landing): four stage boxes with department counts; click expands in place (component state). Post-production expands to a row of four sub-group boxes, each expanding to department chips (→ department doc); the other stages expand directly to their chip list, currently an empty state. NULL-stage departments are listed under "Not placed on the pipeline yet". Post-production is open by default.
- `tools/page.tsx` → `ToolList`: query-string state `?dept=slug | tier=… | host=…` (sidebar lens selection, mutually exclusive) `&status=&q=&sort=name|tier|host|vendor|updated`; rows show name, tier badge, host chip, status, blurb, vendor, replacement; checkboxes select up to 3 tools in one department → `CompareOverlay` (rows: tier/host/status/summary + the department's `comparison_attributes` + extras + "Why this tier" link). Reached from a department doc, the sidebar, or the map's "Browse all tools" link.
- `tools/[id]` — badges, discontinued banner with replacement link, "Replaces …" back-link, blurb, "Why it sits here" card → `/post-pulse/departments/[slug]#<doc_anchor>`, attributes table, alternatives (same department) as tags, sources, verified stamp, per-tool changelog.
- `departments/[slug]` — tier roster (from `pp_tools`, not the doc) + `AnchoredMarkdown` of `overview_doc`.
- `queue` → `QueueClient`: pending items with old → new diff, sources, Accept / Reject.
- `changes` — `pp_changelog` newest first, grouped by day.
- `chat` — disabled shell (stub).

**API**:
- `GET /api/post-pulse/queue` pending items; `POST` `{proposedToolId?, proposedChanges, source, sourceUrls?}` → 201 `{id}`.
- `PATCH /api/post-pulse/queue/[id]` `{action: 'accept'|'reject'}` → `{ok, toolId, changedFields}` or 400/404/409/500.
- `POST /api/post-pulse/chat` → 501 (stub).
- `GET /api/cron/post-pulse-sync` → `{ok, stub:true}`; requires `Authorization: Bearer $CRON_SECRET` when the variable is set.

**Sidebar** (`Sidebar.tsx`): search box (debounced to `?q=`), three lens toggles (Department default / Tier / Host App) reorganizing the same tools with counts, chevron-expandable nodes listing tools, "All tools", then Review queue (pending badge), What changed, Research chat (soon).

---

## 6. Restore procedures

**Lost the database, still have the repo**
1. Run `supabase/migrations/021_post_pulse.sql` in the Supabase SQL editor.
2. Run `supabase/seed_post_pulse.sql`. It is idempotent (upserts), so re-running after edits refreshes docs and attributes without touching queue-made changes to other columns.
3. Anything accepted through the queue after the seed is lost unless you have a `pp_changelog` export — there is no automated backup of `pp_*`. Consider a periodic `select * from pp_tools` / `pp_changelog` export.

**Lost the repo, still have the database**
Follow `POST_PULSE_REBUILD_PROMPT.md` inside a Pulse checkout (or a rebuilt Pulse per `PULSE_REBUILD_PROMPT.md`). The schema in §3 above and the route/UI contract in §5 are what the rebuild must reproduce; the data is already there.

**Lost both**
Rebuild Pulse (`PULSE_REBUILD_PROMPT.md`), then Post Pulse (`POST_PULSE_REBUILD_PROMPT.md`), then run the migration and seed. The seed carries the full Sept 2026 research state.

**Applying the seed without the SQL editor**
Only the REST key is available in some environments. The seed can be applied through `@supabase/supabase-js` by parsing the two `VALUES` blocks (a fixed layout) and upserting with `onConflict: 'slug'` / `'department_id,name'`, then running the three derived-column updates. This was done once on Sept 14 2026 (the script lived in a scratchpad; the SQL file remains canonical).

---

## 7. What is deferred

- **Per-department cadence**: uniform 14 days until `last_researched_at` data shows how uneven the pace is (spec §5).
- **Layer 1 overview doc**: no table or view yet.

## 8. Research chat (built Sept 14 2026, migration 023)

- **Schema (023)**: `pp_chat_sessions` gains `name` (default 'Untitled session'), `department_context_id` (fk → pp_departments, set null), `updated_at` (+ trigger, index); `pp_queue` gains `target_type` ('tool' | 'department', default 'tool') and `proposed_department_id` (fk, set null).
- **Engine**: `lib/post-pulse-chat.ts` → `runChatTurn({session, userMessage, onEvent})`. Model `claude-sonnet-5`, adaptive thinking, effort `PULSE_PP_CHAT_EFFORT` (default medium), `max_tokens` 8000, `web_search_20260209` with `max_uses` 6, plus the client-side `propose_change` tool `{target_type, action: create|update, target_id?, department_slug?, changes, rationale, source_urls?}`. Loop: stream → `finalMessage()` → `tool_use` (validate + `enqueueProposal` + tool_result) / `pause_turn` (append assistant content) / else stop; max 8 rounds. System prompt is rebuilt from the database each turn (`buildSystemPrompt`). Persists user + assistant messages (`{role, content, created_at, sources?, queued?}`), auto-names the session from the first message, logs `usage_logs.call_type='pp_chat'`.
- **Routes**: `POST /api/post-pulse/chat` (SSE), `GET/POST /api/post-pulse/chat/sessions`, `GET/PATCH{name}/DELETE /api/post-pulse/chat/sessions/[id]`. Pages: `/post-pulse/chat` (list), `/post-pulse/chat/[id]` (thread), `/post-pulse/chat/start?dept=slug[&fresh=1]` (resume-or-create, then redirect).
- **Rules the prompt enforces**: confidence before proposals (ambiguity → clarifying question, no queue write); every proposal queues immediately (no in-chat confirm); department context is a default frame, not a filter; `overview_doc` edits are whole-doc replacements.
- **Restore**: run 023 after 021/022; nothing else to seed. Sessions are user data with no backup beyond the table.

## 9. Research runs (built Sept 14 2026, spec §5, migration 024)

- **Files**: `lib/post-pulse-rss.ts` (sources, minimal RSS/Atom parser, `fetchRssItems`, `isKnownSourceUrl`), `lib/post-pulse-research.ts` (`runResearch`, `isDepartmentDue`, `composeBriefing`, `PP_RESEARCH_CADENCE_DAYS`), `app/api/post-pulse/research/route.ts` (POST `{departmentId?, timeBudgetMs?}`), `app/api/cron/post-pulse-sync/route.ts` (GET, `CRON_SECRET`, `dueOnly`), `components/post-pulse/ResearchButton.tsx`, `vercel.json` (`0 12 * * *`).
- **Flow per run**: RSS (21-day lookback, dedup against known URLs) → Haiku `route_items` → per department (concurrency 4, time budget) Sonnet + web_search (`max_uses` = 5 + 3 headroom, one search at a time) → `report_findings` → publish (auto: high confidence, factual fields only, known domain or verified entry, via `applyToolUpdate`; else `pp_queue` with source rss|search; confirmation → `last_verified_at` only; `complete:false` → failed, no stamp) → `last_researched_at` stamp → briefing row in the `Post Pulse Research` channel (`scheduled: true`, Listen Queue, `last_briefed_at`) → `usage_logs` `pp_research`.
- **Feeds** (checked Sept 2026): CG Channel `https://www.cgchannel.com/feed/`, VP Land `https://www.vp-land.com/feed`. No feed: SideFX, Foundry, superrendersfarm. ActionVFX blocks bots (429). Their domains still count as known sources.
- **Env**: `PULSE_PP_RESEARCH_PROFILE_ID` (briefing owner, default profile 1), `PULSE_PP_RESEARCH_CONCURRENCY` (4), `PULSE_PP_RESEARCH_EFFORT` (medium), `CRON_SECRET`.
- **Costs measured**: one department ≈ $0.15–0.25 and 60–70s; five in parallel ≈ $0.94 and 100s. A full 14-department sweep ≈ $3 spread over one or two daily runs.
- **Known limits**: briefings are profile-scoped, so research briefings land in one profile; the research channel is an ordinary channel (a manual Generate on it produces a normal briefing). No lock against a cron run and a manual sweep overlapping — the stamp makes the second mostly a no-op but both would spend.

## 10. Later migrations

- **024** `pp_departments.last_researched_at` (timestamptz, nullable) — stamped by research runs; unused by the UI so far.
- **025** `pp_changelog` generalised: `tool_id` nullable, `target_type` ('tool' | 'department', default 'tool'), `department_id` (fk, cascade), check constraint that exactly one id is set to match `target_type`, index on `department_id`. `acceptQueueItem` logs department accepts with the same field/old/new shape as tool rows (`overview_doc` rows hold the whole before/after text). Run 024 and 025 after 023.
- **Per-department `comparison_attributes` refinement** after first real use.
- **Phone layout verification** in a real browser (the automation profile couldn't resize the window).
