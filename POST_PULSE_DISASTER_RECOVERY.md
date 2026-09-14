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
- `page.tsx` → `ToolList`: query-string state `?dept=slug | tier=… | host=…` (sidebar lens selection, mutually exclusive) `&status=&q=&sort=name|tier|host|vendor|updated`; rows show name, tier badge, host chip, status, blurb, vendor, replacement; checkboxes select up to 3 tools in one department → `CompareOverlay` (rows: tier/host/status/summary + the department's `comparison_attributes` + extras + "Why this tier" link).
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

- **Scheduled automation** (spec §5): RSS sources (CG Channel, SideFX, Foundry, ActionVFX, superrendersfarm, VP Land) + a `web_search` pass per department, every two weeks plus a manual trigger, Haiku for extraction/dedup and Sonnet for tier judgment, confidence-based auto-publish vs queue. Stub route + cron entry exist.
- **Research chat** (spec §6): Claude + `web_search`, scoped to the dataset; all proposals → `pp_queue`. Stub route + page exist. `pp_chat_sessions` may be replaced by a generic Pulse chat log.
- **Layer 1 overview doc**: no table or view yet.
- **Per-department `comparison_attributes` refinement** after first real use.
- **Phone layout verification** in a real browser (the automation profile couldn't resize the window).
