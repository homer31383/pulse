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

## 3. Data model (Supabase, prefixed `pp_`)

**`pp_departments`**
`id, slug, name, overview_doc (markdown), comparison_attributes (jsonb — ordered list of {key, label, type}), created_at, updated_at`

**`pp_tools`**
`id, department_id (fk), name, tier (enum: automated | assisted | artist_led), host_app (Maya | Houdini | Nuke | standalone | web | plugin | native), status (active | discontinued), replacement_tool_id (fk, nullable, self-reference), vendor, blurb (short), doc_anchor (string, points into department overview_doc), attributes (jsonb, matches department's comparison_attributes schema), source_urls (text[]), last_verified_at, confidence (verified | queued), created_at, updated_at`

**`pp_changelog`**
`id, tool_id (fk), field_changed, old_value, new_value, source, created_at` — every tier shift, status flip, or attribute change writes a row here. This is what powers "what changed since I last looked."

**`pp_queue`**
`id, proposed_tool_id (fk, nullable if new), proposed_changes (jsonb), source (rss | search | chat), source_urls (text[]), status (pending | accepted | rejected), created_at, resolved_at` — everything from automation or chat lands here unless it meets the auto-publish bar (§5).

**`pp_chat_sessions`** *(optional v1, may just reuse a generic Pulse chat log if one exists)*
`id, messages (jsonb), proposed_queue_ids (uuid[]), created_at`

## 4. Navigation & UI

**Sidebar** (Palomar-style collapsible tree, purpose-built for this data, not copied wholesale): three top-level toggles — **Department**, **Tier**, **Host App** — each expandable with counts, same underlying tool set reorganized under a different lens. Department is the default landing view. Search bar always visible, filters independent of which toggle is active. A **Queue** section shows pending-review count as a badge.

**Main panel:** dense list/card hybrid, not a visual grid — name, tier badge, host app, status, one-line blurb, all visible without clicking. Sortable, filterable.

**Detail view:** full tool record, attributes, alternatives as clickable tags, "discontinued → replaced by X" banner when applicable, deep link into the department doc's relevant anchor.

**Compare mode:** lightweight overlay (not a page nav), select 2–3 tools within the same department, side-by-side on that department's `comparison_attributes` (tailored per department — rigging and rendering don't compare on the same fields).

**Queue view:** pending items awaiting review, each showing proposed change, source, and accept/reject actions. Accepting writes to `pp_tools` and logs to `pp_changelog`.

## 5. Automation

**Sources, two kinds:**
- RSS-able: CG Channel, SideFX news/changelog, Foundry blog, ActionVFX blog, superrendersfarm, VP Land.
- Search-based: Anthropic API with the `web_search` tool, run against a fixed query set per department (queries seeded from this project's research, refined over time).

**Cadence:** every 2 weeks via scheduled job (Vercel cron or Supabase edge function), plus a manual trigger button.

**Publishing logic — confidence-based:**
- Source is RSS from a known vendor/publication, or the finding directly matches/confirms an existing verified entry → auto-publish, log to changelog.
- Source is ambiguous, a new tool not previously tracked, or a tier/status judgment call → lands in `pp_queue` for review.

**Classification pass:** after each pull, a Claude call (Haiku for extraction/dedup, Sonnet for tier judgment calls) reads new findings against existing `pp_tools` rows and decides: new entry, update, or no-op. Same pattern as the existing Memoria extraction job.

## 6. Chat feature

A chat surface scoped to this dataset — ask it to go deep on a tool, add a missing department, or research something you heard about ("what does X do, where would it fit"). Backed by Claude with the `web_search` tool, same mechanism as the scheduled job, same department-doc and tool-entry conventions.

**Every proposal from chat routes through `pp_queue` — no exceptions, even when initiated live.** This differs from the confidence-based auto-publish in §5: chat-initiated changes always queue, since a conversational research pass hasn't been cross-checked the way a scheduled RSS pull has.

## 7. Discontinued tools

Stay visible in all views with a "discontinued" badge. `replacement_tool_id` links to whatever superseded it (the canonical example: Ziva VFX → Houdini Otis / Maya ML Deformer). Never removed from the main view — removing history defeats the point of the changelog.

## 8. Design

Reuses Pulse's existing tokens: background `#EDE6DE`, cards `#F7F3EF`, borders `#DDD5CB`, text `#2C2522`, accent `#6B5CA5`. No new design system.

## 9. Stack

Same as the rest of the suite: Vite + React + TypeScript + Tailwind + Supabase (Postgres) + Vercel, PWA conventions, serverless functions for the scheduled pull and chat endpoint. New tables live in the existing `Axiom Tasks` Supabase project with the `pp_` prefix, consistent with the rest of the suite's naming convention.

## 10. Seed data

Initial `pp_departments` and `pp_tools` rows can be seeded directly from this research session — the tier breakdowns, tool names, vendors, and status/discontinued findings (Ziva, Golaem's Autodesk acquisition, etc.) already exist in this conversation and translate directly into rows.

## Open items for a later pass

- Exact per-department `comparison_attributes` schemas (draft during build, refine after first real use)
- Whether `pp_chat_sessions` needs its own table or can reuse an existing Pulse chat log
- Auth/access — assume same protection as the rest of the dashboard (WordPress password gate) unless stated otherwise
