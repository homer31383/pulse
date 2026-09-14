# Post Pulse — Rebuild Prompt

> Paste this into Claude Code inside a working Pulse checkout (Next.js 16 App Router, Supabase via `lib/supabase.ts`, Tailwind with the cream/ink/press palettes). It rebuilds the Post Pulse feature from scratch. `POST_PULSE_SPEC.md` is the product spec; this prompt is the implementation contract that the Sept 2026 build followed. Read `CLAUDE.md` first.

## What you're building

"Post Pulse": a reference view at `/post-pulse` tracking AI tools across the commercial VFX pipeline. Departments hold long-form docs split into three tiers (automated / AI-assisted / artist-led); tools are structured rows that deep-link into those docs. A review queue is the only way data changes; every change is logged. Not profile-scoped. Utility palette (`bg-cream-200` page, `bg-cream-50` cards, `border-cream-300/400`, `text-ink-300/200/100/50`, accent `press-accent` `#6B5CA5`; `font-display` for titles, `font-serif` for doc body, sans for UI). Do not use the broadsheet press design.

## 1. Schema — `supabase/migrations/021_post_pulse.sql`

Additive only. Tables `pp_departments`, `pp_tools`, `pp_changelog`, `pp_queue`, `pp_chat_sessions` (stub) exactly as in `POST_PULSE_DISASTER_RECOVERY.md` §3: check constraints on `tier`, `status`, `confidence`, queue `source`/`status`; `pp_tools.replacement_tool_id` self-FK `on delete set null`; **`unique (department_id, name)` on `pp_tools`** and `slug unique` on departments (the seed upserts on these); `pp_set_updated_at()` trigger on departments and tools; indexes on tools(department_id/tier/status), changelog(tool_id, created_at desc), queue(status). Guard the unique constraint with a `do $$ … $$` block so the file is safe to re-run.

## 2. Seed — `supabase/seed_post_pulse.sql`

Separate file (Pulse's `seed.sql` channel insert is not idempotent). `insert … on conflict (slug) do update` for 13 departments: Roto & Tracking · Compositing · Modeling · Texturing · Look Development · Rigging · Muscle & Skinning · Simulation (FX) · Crowds · Rendering & Denoising · Capture (Gaussian Splats & Photogrammetry) · Generative / ComfyUI Workflows · Mocap & Animation. Each `overview_doc` (dollar-quoted `$doc$…$doc$`) = opening synthesis paragraph, then `## Tier 1 — Automated {#tier-1}`, `## Tier 2 — AI-assisted {#tier-2}`, `## Tier 3 — Artist-led {#tier-3}` with reasoning (a placeholder sentence is fine for an empty tier). Each department carries `comparison_attributes` as `[{key,label,type}]` tailored to it (e.g. rigging: host_app, mocap_compatible:boolean, future_proofing; rendering: denoiser, gpu_cpu, pricing).

Tools `insert … on conflict (department_id, name) do update` with `attributes` keyed to the department schema. Then: `update pp_tools set doc_anchor = case tier … end where doc_anchor is null`; stamp `last_verified_at` where null (noon UTC); link Ziva VFX → Houdini Otis via `replacement_tool_id`. Required facts to preserve: Ziva VFX is `discontinued` (Unity), replacements Houdini Otis (Houdini-native tissue solver, SideFX's stated migration path) and Maya ML Deformer; Golaem is Autodesk-owned (acquired Aug 2024) and ships in the Maya M&E Collection; denoising (OptiX/OIDN) and Meshy texturing are Tier 1; simulation and lookdev are Tier 3. If the original seed file exists, keep its rows verbatim.

## 3. Library

- `lib/post-pulse-types.ts` (client-safe): `PpTier`, `PpStatus`, `PpConfidence`, `PpQueueSource/Status`, `PpComparisonAttribute`, `PpDepartment`, `PpTool`, `PpChangelogEntry`, `PpQueueItem`, `PpDataset {departments, tools, pendingQueueCount}`; `PP_TIERS` (value/label "Tier 1 · Automated"/short/anchor/description), `PP_TIER_BY_VALUE`, `PP_HOST_APPS`, `PP_STATUSES`, `PP_QUEUE_SOURCES`, `PP_TOOL_EDITABLE_FIELDS`, `PP_SORTS`; helpers `hostAppLabel`, `formatAttributeValue(value, type)` (booleans → Yes/No, empty → "—"), `slugifyHeading`.
- `lib/post-pulse.ts` (server-only, imports `@/lib/supabase`): `fetchPostPulseDataset()`, `fetchTool(id)`, `fetchDepartmentBySlug(slug)`, `fetchToolChangelog(toolId)`, `fetchRecentChanges(limit)` (joins tool name/department), `fetchPendingQueue()`, `acceptQueueItem(id)`, `rejectQueueItem(id)`, `enqueueProposal({proposedToolId?, proposedChanges, source, sourceUrls?})`. Accept semantics: only editable fields; resolve `department_slug` → id; diff against the current row (stringified) and insert a `pp_changelog` row per changed field with `source = "<queue source>:<queue id>"`; set `last_verified_at` + `confidence='verified'`; a proposal without `proposed_tool_id` inserts a tool (needs name, department, tier) and logs `created`; finally set the queue row `accepted` + `resolved_at` + `proposed_tool_id`. 409 if not pending.

## 4. API routes

- `app/api/post-pulse/queue/route.ts` — GET pending; POST validates `proposedChanges` is an object and `source ∈ rss|search|chat` → `enqueueProposal`, 201.
- `app/api/post-pulse/queue/[id]/route.ts` — PATCH `{action}` (await `params`).
- `app/api/post-pulse/chat/route.ts` — POST → 501 with a note that chat proposals must land in `pp_queue`.
- `app/api/cron/post-pulse-sync/route.ts` — GET, `maxDuration = 300`, bearer `CRON_SECRET` check when set, returns `{ok:true, stub:true}`. Add `{ "path": "/api/cron/post-pulse-sync", "schedule": "0 12 1,15 * *" }` to `vercel.json`.

## 5. Pages — `app/post-pulse/`

All `export const dynamic = 'force-dynamic'`.
- `layout.tsx`: `metadata.title = 'Post Pulse'`; try `fetchPostPulseDataset()`, on error render a "run migration 021 + seed" notice; else `<PostPulseShell data>`.
- `page.tsx`: `<PipelineMap />` — the landing flowchart (see §6). Requires migration `022_post_pulse_pipeline_stages.sql` (`pp_departments.pipeline_stage` / `pipeline_substage` with check constraints) and `supabase/post_pulse_pipeline_stages_seed_update.sql`; types `PpPipelineStage`, `PpPipelineSubstage`, `PP_PIPELINE_STAGES`, `PP_PIPELINE_SUBSTAGES` in `post-pulse-types.ts`.
- `tools/page.tsx`: `<Suspense><ToolList /></Suspense>` (useSearchParams needs Suspense). `listHref()` and every breadcrumb/"N tools tracked" link target `/post-pulse/tools`.
- `tools/[id]/page.tsx`: fetch tool + changelog + dataset; `notFound()` if missing. Breadcrumb (All tools / Department), title, `TierBadge long`, `HostChip`, `StatusBadge`, vendor; discontinued banner (press-down tint) with replacement link; "Replaces …" line for tools whose `replacement_tool_id` is this one; blurb (serif); "Why it sits here" card linking to `/post-pulse/departments/[slug]#${doc_anchor ?? tier anchor}`; attributes `<dl>` in schema order + extras; alternatives (same department, active first, discontinued struck through) as pill links; sources + "Last verified"; per-tool changelog timeline.
- `departments/[slug]/page.tsx`: breadcrumb, "Department doc" label, title, updated date + tool count; three tier cards listing that tier's tools (links) and anchoring to `#tier-n`; `<AnchoredMarkdown content={overview_doc} />`.
- `queue/page.tsx` → `<QueueClient items />`; `changes/page.tsx` → changelog grouped by day; `chat/page.tsx` → disabled textarea + "Not wired up yet".

## 6. Components — `components/post-pulse/`

- `PipelineMap.tsx` ('use client'): reads `usePostPulse()`. Header ("The pipeline", intro, "Browse all N tools →", pending-queue link). `<ol>` of four stage buttons (`grid-cols-2 lg:grid-cols-4`, chevrons between on desktop): "Stage n", label, "N departments"; empty stages get a dashed border, never hidden. One `openStage` at a time (post_production by default); the open box gets a caret and a full-width panel below with title, description, Collapse. Post-production panel: `<ol>` of four sub-group buttons ("n of 4", label, count) with one `openSub`; below it the open sub-group's `DepartmentChips` (pill links to `/post-pulse/departments/[slug]` with tool count), plus a "Not in a sub-group yet" list for post-production rows with NULL substage. Other stages: `DepartmentChips` directly, whose empty state reads "Nothing tracked here yet. Departments for this stage are future research, not a gap in the data." Under the map, list NULL-stage departments as "Not placed on the pipeline yet".
- `Shell.tsx` ('use client'): `DatasetContext` + `usePostPulse()`; phone header (back, title, "Browse" button with pending badge) + slide-in drawer (`animate-[slideIn_180ms_ease-out]`, add the keyframe to `globals.css`), closes on route change/Escape; desktop `aside` 272–300px sticky full-height with `<Sidebar />`; `main` max-w-4xl.
- `Sidebar.tsx`: exports `listHref(params, patch)` (null deletes a param; returns `/post-pulse?…`). Search input debounced 250ms → `?q=`. Lens segmented control (Department default; initial lens follows URL). Tree nodes per lens with counts: departments (by slug), `PP_TIERS`, distinct `host_app` values; "All tools" clears `dept/tier/host`; node link sets exactly one of them; chevron expands to the node's tools (links to detail, struck through if discontinued). Footer: Review queue (pending badge), What changed, Research chat "soon".
- `ToolList.tsx`: filters from URL (`dept`→department id, `tier`, `host`, `status`, `q` over name/vendor/blurb/department, `sort`); heading = department name / tier label / host label / "All tools" + count; department description line + "Read the department doc →"; filter selects (Tier/Host/Status/Sort) + "Clear filters"; rows with checkbox (max 3), name link, badges, department link when unfiltered, blurb (line-clamp), vendor, "Replaced by X", "Unverified" if `confidence='queued'`; sticky bottom pill "N of 3 selected · Compare · ×" (Compare enabled only for 2–3 tools in one department); `<CompareOverlay>`.
- `CompareOverlay.tsx`: fixed overlay (Escape closes, body scroll locked), grid `minmax(120px,1fr) repeat(n, minmax(150px,1.4fr))`, header cells (name link, vendor), rows Tier / Host app / Status (+ "→ replacement") / Summary, then `comparison_attributes` (boolean cells tinted), then extra keys (italic label), then "Why this tier" doc links.
- `AnchoredMarkdown.tsx`: react-markdown + remark-gfm; `h1–h4` overrides compute the id from a trailing `{#id}` (stripped) or `slugifyHeading(text)`, render `<hN id class="scroll-mt-20 target:text-press-accent">` with a self-link; `useEffect` re-scrolls to `location.hash` after ~60ms (Next scrolls to top after commit).
- `QueueClient.tsx`: list of pending items; header (source label, "Update <tool>" / "New tool: name", department, date); optional `note`; `<dl>` of proposed fields showing current (struck) → proposed, "(no change)" when equal, department/replacement ids rendered as names; ignored keys listed; source URLs; Accept/Reject → `PATCH`, remove from list, `router.refresh()`.
- `Badges.tsx`: `TierDot`, `TierBadge {long?}` (automated = press-up, assisted = press-accent, artist_led = neutral), `StatusBadge` (discontinued = press-down pill), `HostChip`.

## 7. Wiring

- Add a "Post Pulse" link to the home hamburger menu in `components/HomeClient.tsx` (after Pinned).
- Update `CLAUDE.md` (file structure, a "Post Pulse (migration 021)" section, stubs, companion files) and `PULSE_REBUILD_PROMPT.md` build order step 16.

## 8. Verification

`npx tsc --noEmit`, `npx eslint app/post-pulse components/post-pulse lib/post-pulse*.ts app/api/post-pulse`, `npx next build`. Then: list renders 34 tools; department lens filters; select three Muscle & Skinning tools → Compare shows the department's Approach / Support Status rows; Ziva detail shows the discontinued banner → Houdini Otis; "Why it sits here" lands on `#tier-2`; `POST /api/post-pulse/queue` twice (an update to Golaem and a new tool with `department_slug`), accept both in `/post-pulse/queue`, confirm `/post-pulse/changes` shows three rows and the sidebar count went to 35; then delete the test tool and revert the Golaem fields.
