Read the full spec at POST_PULSE_SPEC.md before starting (paste alongside this prompt if not already in repo context).

Build "Post Pulse," a new view inside the existing Pulse app (Vite + React + TypeScript + Tailwind + Supabase + Vercel, same conventions as the rest of the suite). It is not a new app — reuse Pulse's routing, auth, and design tokens (`#EDE6DE` background, `#F7F3EF` cards, `#DDD5CB` borders, `#2C2522` text, `#6B5CA5` accent).

## Scope for this pass

1. **Supabase schema.** Create the five tables from spec §3 (`pp_departments`, `pp_tools`, `pp_changelog`, `pp_queue`, and stub out `pp_chat_sessions`) in the existing Axiom Tasks Supabase project. Follow the app-prefixed naming convention already used by other apps in this project.

2. **Sidebar navigation.** Collapsible tree with three top-level toggles (Department / Tier / Host App), each showing counts, same tool set reorganized per toggle. Department is default. Persistent search bar. Queue section with a pending-count badge. Reference the attached screenshot's sidebar mechanics (collapse/expand, nesting, counts) for interaction only — not its visual style or its masonry content grid, which we are explicitly not using.

3. **Main list view.** Dense card/list hybrid (not a visual grid) showing name, tier badge, host app, status, one-line blurb per tool. Sortable and filterable, filters independent of active sidebar toggle.

4. **Detail view.** Full tool record on click: attributes, alternatives as clickable tags linking to their own detail views, discontinued banner with replacement link when applicable, and a deep link into the relevant department doc anchor.

5. **Department doc view.** Renders the department's long-form `overview_doc` markdown with the Tier 1 / Tier 2 / Tier 3 structure, anchored sections that tool detail views link into.

6. **Compare mode.** Overlay (not a route change) for selecting 2–3 tools within one department, rendered side by side against that department's `comparison_attributes` schema (stored as jsonb on `pp_departments`, so this is data-driven, not hardcoded per department).

7. **Queue view.** List of pending `pp_queue` items with proposed change, source, and accept/reject actions. Accept writes to `pp_tools` and inserts a `pp_changelog` row. Reject just resolves the queue row.

8. **Seed data.** Populate `pp_departments` (full pipeline list from spec §2, placeholders fine for thin ones) and an initial `pp_tools` set from the research already captured in this project's conversation history — tier classifications, vendors, host apps, and known status changes (e.g. Ziva VFX discontinued → replacement Houdini Otis / Maya ML Deformer; Golaem now Autodesk/Maya-native) should be reflected accurately in the seed.

## Explicitly out of scope for this pass (stub or defer)

- The scheduled automation job (RSS pull + `web_search`-based Anthropic API classification pass). Stub the serverless function and cron config, but the actual source list and query tuning is a follow-up pass.
- The chat feature (§6 of spec). Stub the route/UI shell only; wire the actual Claude + `web_search` backend in a follow-up pass. When implemented, every chat proposal must land in `pp_queue`, never auto-publish, even for live conversational use.

## Conventions to follow

- PowerShell command chaining: semicolons, not `&&`.
- After this session: generate `CLAUDE.md`, a disaster recovery doc, and a rebuild prompt from the resulting codebase, per the usual disaster-recovery discipline for this suite.
- All new tables and routes should be additive — do not touch existing Pulse tables or views.
