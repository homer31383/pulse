-- Post Pulse taxonomy change (2026-09-14)
-- 1. Look Development merges into Texturing → "Texturing & Look Development"
--    (slug stays `texturing`); the department now covers texturing, shader
--    development, and look development. Look Development's tools, chat
--    sessions, changelog and queue rows move over, then the row is deleted.
-- 2. Modeling widens to "Modeling & UVs" (slug stays `modeling`).
-- Idempotent: safe to re-run; the lookdev block is a no-op once it's gone.
-- seed_post_pulse.sql and post_pulse_pipeline_stages_seed_update.sql were
-- updated to match, so a fresh seed produces this state directly.

update pp_departments set
  name = 'Texturing & Look Development',
  comparison_attributes = '[{"key": "uv_aware", "label": "UV-Aware", "type": "boolean"}, {"key": "map_types", "label": "PBR Maps Generated", "type": "text"}, {"key": "renderer_support", "label": "Renderer Support", "type": "text"}, {"key": "pricing", "label": "Pricing", "type": "text"}]'::jsonb,
  overview_doc = $doc$
Texturing, shader development, and look development are one department here: the work runs from generating or authoring a material, through building and calibrating the shader, to signing off how a hero asset reads under production lighting. Standard PBR texturing is the closest discipline in the pipeline to fully automated: a hand-authored material set used to run 2-8 hours in Substance Designer, and AI tools now generate UV-aware, seam-handled PBR sets in minutes. The pragmatic 2026 split is to AI-generate the bulk material library and hand-author the small set of hero surfaces where the material itself is the star of the shot. Look development, by contrast, is still solidly artist-led: no tool does end-to-end shading or lookdev decision-making — calibrating a hero material under production lighting, matching client reference, balancing shader complexity against render cost. AI touches the edges (a generated starting material, generated reference art to light-match against) but the judgment call hasn't moved. Known gap on the texturing side: AI-derived normal maps are typically inferred from luminance/shading, which breaks down on anything needing true displacement.

## Tier 1 — Automated {#tier-1}

Standard PBR materials are effectively automated. Meshy's texture generator is UV-aware, handles seams, and returns a full PBR set in minutes, against the 2–8 hours a hand-authored set used to take in Substance Designer. For the bulk material library this is the default now. Nothing on the shader or look-development side is automated.

## Tier 2 — AI-assisted {#tier-2}

Adobe has embedded generative AI directly in Substance 3D, so the industry-standard texturing toolset assists rather than being replaced by a bolt-on; this is where hand-authored material work gets faster without changing who does it. On the look-development side the assistance is indirect: a generated starting material to calibrate from, or generated reference concept art to light-match against. No lookdev-specific tool is tracked yet; if one shows up, it belongs here.

## Tier 3 — Artist-led {#tier-3}

The small set of hero surfaces where the material is the star of the shot still gets hand-authored, and the concrete technical gap remains: AI-derived normal maps are usually inferred from luminance and shading, which breaks down on anything that needs true displacement. Shader development and look development are judgment work end to end — calibrating a hero material under production lighting, matching client reference, and balancing shader complexity against render cost — and that judgment hasn't moved. The net effect on the job is a shift in time: less building materials from scratch, more judging and correcting generated ones.
$doc$
where slug = 'texturing';

update pp_departments set
  name = 'Modeling & UVs',
  overview_doc = $doc$
Modeling and UV layout are one department here: the work runs from blockout or generation through retopology to a clean, unwrapped, packed mesh the texturing department can take. Fast-moving from artist-led toward assisted, but only for background/set-dressing/blockout work. Rodin leads geometric fidelity (hard-surface/mechanical), Meshy is most complete end-to-end (model+texture in one pass), Tripo is fastest/best for stylized, TRELLIS 2 is the leading open-source option with Gaussian-splat output. 2026 trend: tools converging on finishing pipelines (retopo, UV unwrapping and packing, format conversion) rather than raw generation, since finishing is the real bottleneck. Hero assets and exact brand/product geometry still need manual retopology, deliberate UV layout, and review.

## Tier 1 — Automated {#tier-1}

Nothing tracked here yet. Generation is fast, and the generators emit their own UVs, but every generated asset still gets a human finishing and review pass, which keeps the whole department at Tier 2 or below.

## Tier 2 — AI-assisted {#tier-2}

For background, set dressing, and blockout the generators are production-usable, and they split by strength. Rodin leads on geometric fidelity, especially hard-surface and mechanical objects. Meshy is the most complete end-to-end option, model and PBR texture in one pass. Tripo is the fastest and the best fit for stylized or hand-painted looks, with quad retopology via Smart Mesh. TRELLIS 2 is the leading open-source option and can output Gaussian splats, running inside ComfyUI. The 2026 trend is that these tools are converging on the finishing pipeline — retopology, UV unwrapping and packing, format conversion — rather than raw generation, because finishing is the real bottleneck. UV work on non-hero assets increasingly rides along with that finishing pass.

## Tier 3 — Artist-led {#tier-3}

Hero assets and anything that has to match exact brand or product geometry still need manual retopology and review, and their UV layouts are still laid out deliberately — seam placement, texel density, and UDIM organisation for hero surfaces are decisions, not defaults. The generators get you a starting point; they don't get you a deliverable.
$doc$
where slug = 'modeling';

-- Move anything still attached to Look Development, then drop it.
update pp_tools set department_id = (select id from pp_departments where slug = 'texturing')
where department_id = (select id from pp_departments where slug = 'lookdev');
update pp_chat_sessions set department_context_id = (select id from pp_departments where slug = 'texturing')
where department_context_id = (select id from pp_departments where slug = 'lookdev');
update pp_queue set proposed_department_id = (select id from pp_departments where slug = 'texturing')
where proposed_department_id = (select id from pp_departments where slug = 'lookdev');
update pp_changelog set department_id = (select id from pp_departments where slug = 'texturing')
where department_id = (select id from pp_departments where slug = 'lookdev');
delete from pp_departments where slug = 'lookdev';
