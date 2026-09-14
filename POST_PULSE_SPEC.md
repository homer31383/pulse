# Post Pulse — Spec

A view inside Pulse for tracking AI tools across the commercial VFX pipeline: what exists, where it fits, what it replaces, and what's changed. Built to replace the "redo this research every month or two" cycle with a structured, queryable, continuously-updated reference.

Shares Pulse's Supabase project, Vercel deployment, and design system. Not a separate app.

## 1. Content model — three layers

**Layer 1: Overview doc.** One living document, top-level "state of the field" synthesis. Updated whenever a department doc changes meaningfully. Read-first landing content.

**Layer 2: Department docs.** One long-form living doc per department (see §2 for the list). Each structured as: what's fully automated (Tier 1), what's AI-assisted (Tier 2), what's still artist-led (Tier 3), with reasoning, not just a list. This is where synthesis and judgment live. Stored as markdown with stable anchor IDs so tool entries can deep-link into specific sections.

**Layer 3: Tool entries.** Structured data + a short blurb. No long-form explanation duplicated here — entries link back to their anchor in the department doc for the "why." This is what makes the list/compare views fast and scannable.

## 2. Departments (full pipeline scaffolded at launch, placeholders OK)

Roto & Tracking · Compositing · Modeling · Texturing · Look Development · Rigging · Muscle & Skinning · Simulation (FX) · Crowds · Rendering & Denoising · Capture (Gaussian Splats, Photogrammetry) · Generative / ComfyUI Workflows · Mocap & Animation

Departments are addable later via the chat feature (§6) without a schema change — department is a row, not a hardcoded type.

### 2a. Pipeline stage mapping

Every department maps to one of four standard filmmaking stages via `pipeline_stage`: `pre_production`, `production`, `post_production`, `finishing_delivery`. As of this pass, `pre_production`, `production`, and `finishing_delivery` are intentionally empty — nothing tracked yet covers previs/bidding (pre-production), on-set tools like LIDAR capture or virtual production (production), or color/mastering/deliverable QC (finishing & delivery). Leave them visible-but-empty rather than hiding them; the gap is real information, not a bug.

`post_production` holds all 13 current departments and additionally uses `pipeline_substage` to group them into the pipeline's internal flow:

- **`asset_creation`**: Modeling, Texturing, Look Development, Rigging
- **`performance_simulation`**: Mocap & Animation, Muscle & Skinning, Simulation (FX), Crowds
- **`rendering_capture`**: Rendering & Denoising, Capture (Gaussian Splats, Photogrammetry)
- **`comp_generative`**: Roto & Tracking, Compositing, Generative / ComfyUI Workflows

`pipeline_substage` is null for departments outside `post_production`.

## 3. Data model (Supabase, prefixed `pp_`)

**`pp_departments`**
`id, slug, name, overview_doc (markdown), comparison_attributes (jsonb — ordered list of {key, label, type}), pipeline_stage (pre_production | production | post_production | finishing_delivery), pipeline_substage (nullable, only set within post_production — see §2a), created_at, updated_at`

**`pp_tools`**
`id, department_id (fk), name, tier (enum: automated | assisted | artist_led), host_app (Maya | Houdini | Nuke | standalone | web | plugin | native), status (active | discontinued), replacement_tool_id (fk, nullable, self-reference), vendor, blurb (short), doc_anchor (string, points into department overview_doc), attributes (jsonb, matches department's comparison_attributes schema), source_urls (text[]), last_verified_at, confidence (verified | queued), created_at, updated_at`

**`pp_changelog`**
`id, tool_id (fk), field_changed, old_value, new_value, source, created_at` — every tier shift, status flip, or attribute change writes a row here. This is what powers "what changed since I last looked."

**`pp_queue`**
`id, proposed_tool_id (fk, nullable if new), proposed_changes (jsonb), source (rss | search | chat), source_urls (text[]), status (pending | accepted | rejected), created_at, resolved_at` — everything from automation or chat lands here unless it meets the auto-publish bar (§5).

**`pp_chat_sessions`** *(optional v1, may just reuse a generic Pulse chat log if one exists)*
`id, messages (jsonb), proposed_queue_ids (uuid[]), created_at`

## 4. Navigation & UI

**Landing page: pipeline map.** Replaces the tool list as the front door. Four stage boxes (Pre-production, Production, Post-production, Finishing & delivery) rendered as a flowchart, each showing a department count. Empty stages stay visible with a "0 departments" state rather than being hidden. Clicking a stage expands it in place. Post-production, since it currently holds all 13 departments, expands to its four sub-groups (§2a) rather than a flat chip list; clicking a sub-group reveals its department chips. Clicking a department chip navigates into that department's doc view (§ below). The other three stages expand directly to an empty state, no sub-group needed until they're populated.

**Sidebar** (Palomar-style collapsible tree, purpose-built for this data, not copied wholesale), reachable from within a department rather than being the landing view: three toggles — **Department**, **Tier**, **Host App** — each expandable with counts, same underlying tool set reorganized under a different lens. Search bar always visible, filters independent of which toggle is active. A **Queue** section shows pending-review count as a badge.

**Main panel:** dense list/card hybrid, not a visual grid — name, tier badge, host app, status, one-line blurb, all visible without clicking. Sortable, filterable.

**Detail view:** full tool record, attributes, alternatives as clickable tags, "discontinued → replaced by X" banner when applicable, deep link into the department doc's relevant anchor.

**Compare mode:** lightweight overlay (not a page nav), select 2–3 tools within the same department, side-by-side on that department's `comparison_attributes` (tailored per department — rigging and rendering don't compare on the same fields).

**Queue view:** pending items awaiting review, each showing proposed change, source, and accept/reject actions. Accepting writes to `pp_tools` and logs to `pp_changelog`.

## 5. Automation

**Sources, two kinds:**
- RSS-able: CG Channel, SideFX news/changelog, Foundry blog, ActionVFX blog, superrendersfarm, VP Land.
- Search-based: Anthropic API with the `web_search` tool, run against a fixed query set per department (queries seeded from this project's research, refined over time).

**Cadence:** every 2 weeks via scheduled job (Vercel cron or Supabase edge function), uniform across all departments for now — deliberately not differentiated per department yet, even though pace clearly isn't even (Generative Media Models moves weekly, Muscle & Skinning barely moved this whole project). Revisit per-department cadence once there's actual data on how uneven it gets in practice, rather than guessing now. In the meantime: a global manual trigger button (run the full sweep now) plus a **per-department manual trigger** on each department's doc page ("research this department now") — runs the same RSS+search mechanism scoped to just that department's sources and queries, for when you want a targeted check without waiting for the cycle or opening a chat session.

**Every research run** — scheduled, global manual trigger, or per-department manual trigger — **stamps `last_researched_at` on each department it touched.** Not used for cadence logic yet (see above), but surfaced on the department doc ("last checked: 4 days ago") and gives future cadence work real data to work from instead of a guess.

**Every research run is recorded natively in Post Pulse, not in Pulse.** Revised 2026-09-14, reversing the first build: the original plan routed each run's summary into Pulse's briefing/channel mechanism (a "Post Pulse Research" channel, home-banner presence, Listen Queue). That crossover was built, then deliberately undone — Post Pulse is a reference tool with its own review loop, and research summaries showing up as editorial briefings next to the day's channels blurred two very different things and put profile-scoped artifacts around a shared dataset. Now each department maintenance pass writes a row to `pp_department_research_runs` (summary, findings, queued, auto-published) and each frontier scan writes to `pp_frontier_scans`; `/post-pulse/activity` is the single chronological feed of both, with a passive indicator in the Post Pulse nav. The old channel and its briefings were backfilled into those tables and deleted. Nothing Post Pulse does surfaces in Pulse itself.

**Publishing logic — confidence-based:**
- Source is RSS from a known vendor/publication, or the finding directly matches/confirms an existing verified entry → auto-publish, log to changelog.
- Source is ambiguous, a new tool not previously tracked, or a tier/status judgment call → lands in `pp_queue` for review. Same ambiguity rule as chat (§6): an unresolvable match produces a note flagged for review, not a guessed publish.

**Classification pass:** after each pull, a Claude call (Haiku for extraction/dedup, Sonnet for tier judgment calls) reads new findings against existing `pp_tools` rows and decides: new entry, update, or no-op. Same pattern as the existing Memoria extraction job.

## 5a. Frontier scans

A second research mode, distinct from the maintenance pass above. Maintenance research asks "what's changed about tools we already track" — it can't discover a technique category nobody's named yet, since its queries are derived from existing department docs and tool lists. A frontier scan asks the open question instead: "what AI help exists for problem X," scoped to a whole pipeline stage (Post-production, Production, etc.), not a department's existing roster. This is how the three empty stages (Pre-production, Production, Finishing & Delivery) ever get populated — they have nothing for maintenance research to refresh, but a frontier scan scoped to "all of Production" can surface a real finding and propose it as a brand-new department, using the same department-target queue path chat already writes through.

**Cadence:** same 14-day cycle as maintenance, tracked separately per pipeline stage (not per department, since some stages have none) in a small dedicated table, not overloaded onto `pp_departments`.

**Scope:** one full pipeline stage per scan. For Post-production specifically, still dedupe against tracked tools (same mechanism as maintenance) so a scan doesn't "discover" Runway again, but the query style stays broad/problem-oriented rather than vendor-list-derived.

**Distinguishing findings:** `pp_queue.source = 'frontier'`, visually tagged distinctly in the queue UI, so an exploratory finding is never mistaken for a routine confirmed update. This matters more here than for rss/search, frontier findings are inherently less certain, they're answering "does anything exist for this" rather than "did this known thing change."

## 6. Chat feature

A chat surface for researching tools, deciding where they fit, and proposing additions or updates — backed by Claude with the `web_search` tool, same mechanism as the scheduled job, same department-doc and tool-entry conventions. Built and validated manually once already in this project (the Wan/Nano Banana/Astra/Fable research pass) before being specced here, so the behavior below reflects what that pass actually required, not a guess.

**Sessions, not one continuous thread.** Named, resumable, listed by most recent activity. A user can start a new session or pick up an old one. `pp_chat_sessions` needs `name`, `messages` (jsonb), `department_context_id` (nullable fk), `updated_at`.

**Context-aware, not context-locked.** Launching chat from within a department doc scopes the session's `department_context_id` to that department by default — the system prompt includes that department's name and overview for framing ambiguous references ("this tool," "here"). This is a default, not a filter: a question about an unrelated department must still get answered normally, not redirected or refused. Chat is reachable two ways: a dedicated page (session list, start fresh), and launched in-context from any department doc (pre-scoped to that department).

**Auto-queue on every proposal.** Unlike the confirm-before-queue pattern considered and rejected during spec'ing: the moment the assistant proposes a new tool, a new department, or a change to an existing entry, it writes to `pp_queue` immediately — no separate in-chat confirmation step. Review happens once, at the Queue view, same place automation-sourced proposals get reviewed. This keeps the chat conversation itself lightweight (research and discussion) and the queue as the single review surface (accept/reject), rather than splitting review across two places.

**Ambiguity must produce a question, not a guess.** This is the behavior the Fable case exposed directly: when a named entity can't be confidently resolved from search results — multiple unrelated things share a name, sources conflict, or nothing matches — the assistant asks a clarifying question in chat and does *not* write a queue proposal. A wrong guess seeded as a queue row is worse than no row at all, since it looks equally credible to a rushed accept as a verified one.

**Queue proposals can now target a department, not just a tool.** The original `pp_queue` schema only supported tool-row proposals (`proposed_tool_id`). Chat surfaced a real need beyond that — proposing an entirely new department (as happened with Generative Media Models & Platforms) or an edit to a department's `overview_doc`. See §3a for the schema change this requires.

## 6a. Queue schema change (§3 update)

`pp_queue` gains `target_type` (`tool` | `department`, default `tool` for backward compatibility) and `proposed_department_id` (nullable fk, mirrors `proposed_tool_id`'s pattern — set when target_type is `department`). `proposed_changes` continues to hold the actual field values/diff for either case. Department-doc edits (a proposed change to `overview_doc` prose, not just structured fields) replace the affected content wholesale on accept — no diff view in the queue UI, full section replacement — relying on `pp_changelog` for history if it's ever needed. Decided this way deliberately: a diff view for long-form prose is real UI complexity for a case that comes up rarely, and the changelog already gives an audit trail.

## 7. Discontinued tools

Stay visible in all views with a "discontinued" badge. `replacement_tool_id` links to whatever superseded it (the canonical example: Ziva VFX → Houdini Otis / Maya ML Deformer). Never removed from the main view — removing history defeats the point of the changelog.

## 8. Design

Reuses Pulse's existing tokens. Note: the hex values originally listed here were guessed from the wrong app's design system; Claude Code mapped Post Pulse onto Pulse's actual cream/ink palette with its press accent during the build. Treat Pulse's real token values (not this doc) as source of truth going forward — pull them from the live codebase rather than restating hex codes here.

## 9. Stack

Corrected after build: Pulse itself runs Next.js 16 on its own Supabase project (not the shared Vite/Axiom Tasks stack the rest of the app suite uses), deployed on Vercel. Post Pulse was built to match, `pp_`-prefixed tables in Pulse's own Supabase project, Next.js routes, serverless functions for the scheduled pull and chat endpoint. Design tokens were mapped onto Pulse's actual cream/ink palette with its press accent rather than the hex values originally listed in §8, which were guessed from the wrong app's conventions.

## 10. Seed data

Initial `pp_departments` and `pp_tools` rows can be seeded directly from this research session — the tier breakdowns, tool names, vendors, and status/discontinued findings (Ziva, Golaem's Autodesk acquisition, etc.) already exist in this conversation and translate directly into rows.

## Open items for a later pass

- Exact per-department `comparison_attributes` schemas (draft during build, refine after first real use)
- Whether `pp_chat_sessions` needs its own table or can reuse an existing Pulse chat log
- Auth/access — assume same protection as the rest of the dashboard (WordPress password gate) unless stated otherwise
