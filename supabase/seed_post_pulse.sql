-- Post Pulse seed data
-- Run AFTER supabase/migrations/021_post_pulse.sql. Safe to re-run: every
-- statement upserts, so editing a doc or an attribute here and re-running
-- refreshes the row (it does not touch anything the review queue changed
-- on columns this file doesn't set, e.g. replacement links other than Ziva's).
--
-- Compiled from a Sept 2026 research session on AI across the commercial
-- VFX pipeline. Treat as a manual seed, not a live-verified feed: the
-- scheduled pull and the review queue are what keep it current from here.
--
-- Doc conventions: each department doc has three anchored sections,
-- {#tier-1} automated, {#tier-2} AI-assisted, {#tier-3} artist-led.
-- Tool rows point at them via doc_anchor (set below from the tier).

-- ── Departments ─────────────────────────────────────────────────────────

insert into pp_departments (slug, name, overview_doc, comparison_attributes) values

('roto-tracking', 'Roto & Tracking', $doc$
Nearly fully industrialized. SLAPSHOT's Autopilot rotoscopes every layer in a shot automatically, exporting an organized cryptomatte. Silhouette's ML tracking suite (Head Track ML, Object Tracker, Point Track ML) handles facial, object, and point tracking through occlusion. Foundry's BigCat scales CopyCat-style roto/cleanup training to hundreds or thousands of frames inside Nuke. Industry-wide: ~62% of studios have adopted automated compositing tasks with meaningful timeline reduction; matte/roto generation adoption is above 50%.

## Tier 1 — Automated {#tier-1}

This is the clearest case in the pipeline of work that has left the artist's desk. SLAPSHOT's Autopilot rotoscopes a whole shot, every layer, unattended, and hands back an organized cryptomatte rather than a pile of shapes. Silhouette's ML suite carries facial, object, and point tracks through occlusion and lighting changes that used to mean re-tracking by hand. Foundry's BigCat turns CopyCat-style training into something that scales to hundreds or thousands of frames inside Nuke, so a trained roto or cleanup model is a pipeline asset rather than a per-shot experiment.

## Tier 2 — AI-assisted {#tier-2}

Nothing tracked here yet. In this department the tools either run unattended or don't exist; "assistance" shows up as QC and fix-up passes on Tier 1 output, not as a separate class of tool.

## Tier 3 — Artist-led {#tier-3}

Reviewing and correcting automated mattes is now the job, not drawing them. The remaining hand work is the fix-up pass on whatever the automated tools get wrong, and the judgment about when a shot needs one.
$doc$,
 '[{"key":"throughput","label":"Throughput","type":"text"},{"key":"handles_occlusion","label":"Handles Occlusion","type":"boolean"},{"key":"output_format","label":"Output Format","type":"text"}]'::jsonb),

('compositing', 'Compositing', $doc$
Comp itself (final grain/light/color integration judgment) remains artist-led. What's AI-assisted: generative elements natively inside the comp graph (Bria/Griptape in Nuke, rights-clear, provenance-tracked) and relighting-from-footage (Beeble) feeding clean PBR passes into the comp. The differentiator between AI-assisted and AI-replaced compositors is whether they can make a generated element actually match plate grain, light, and motion — not a solved problem.

## Tier 1 — Automated {#tier-1}

Nothing in comp runs unattended. The upstream tasks that used to eat a compositor's day (roto, tracking, cleanup) are covered under Roto & Tracking, and that is where the automation lives.

## Tier 2 — AI-assisted {#tier-2}

Two things have moved inside the comp graph. Generative elements: Bria's nodes, integrated through Griptape, generate inside Nuke with licensed training data, rights clearance, and provenance tracked, so alpha and metadata never round-trip through a browser tool. Relighting from footage: Beeble extracts full PBR passes from ordinary plates so a comp can relight a subject after capture; the local desktop version runs entirely on-prem.

## Tier 3 — Artist-led {#tier-3}

The final integration judgment stays human: grain, light, color, and motion have to match, and no generative tool makes that call. This is the line between an AI-assisted compositor and a replaced one. Whether a generated element actually sits in the plate is still a craft skill, and still the part clients notice.
$doc$,
 '[{"key":"native_integration","label":"Native DCC Integration","type":"text"},{"key":"licensing","label":"Licensing / Rights","type":"text"}]'::jsonb),

('modeling', 'Modeling', $doc$
Fast-moving from artist-led toward assisted, but only for background/set-dressing/blockout work. Rodin leads geometric fidelity (hard-surface/mechanical), Meshy is most complete end-to-end (model+texture in one pass), Tripo is fastest/best for stylized, TRELLIS 2 is the leading open-source option with Gaussian-splat output. 2026 trend: tools converging on finishing pipelines (retopo, UV, format conversion) rather than raw generation, since that's the real bottleneck. Hero assets and exact brand/product geometry still need manual retopology and review.

## Tier 1 — Automated {#tier-1}

Nothing tracked here yet. Generation is fast, but every generated asset still gets a human finishing and review pass, which keeps the whole department at Tier 2 or below.

## Tier 2 — AI-assisted {#tier-2}

For background, set dressing, and blockout the generators are production-usable, and they split by strength. Rodin leads on geometric fidelity, especially hard-surface and mechanical objects. Meshy is the most complete end-to-end option, model and PBR texture in one pass. Tripo is the fastest and the best fit for stylized or hand-painted looks, with quad retopology via Smart Mesh. TRELLIS 2 is the leading open-source option and can output Gaussian splats, running inside ComfyUI. The 2026 trend is that these tools are converging on the finishing pipeline (retopology, UVs, format conversion) rather than raw generation, because finishing is the real bottleneck.

## Tier 3 — Artist-led {#tier-3}

Hero assets and anything that has to match exact brand or product geometry still need manual retopology and review. The generators get you a starting point; they don't get you a deliverable.
$doc$,
 '[{"key":"topology_quality","label":"Topology Quality","type":"text"},{"key":"speed","label":"Generation Speed","type":"text"},{"key":"export_formats","label":"Export Formats","type":"text"},{"key":"pricing","label":"Pricing","type":"text"}]'::jsonb),

('texturing', 'Texturing', $doc$
Closest discipline to fully automated for standard PBR work. A hand-authored material set used to run 2-8 hours in Substance Designer; AI tools now generate UV-aware, seam-handled PBR sets in minutes. Pragmatic 2026 split: AI-generate the bulk material library, hand-author the small set of hero surfaces where the material itself is the star of the shot. Known gap: AI-derived normal maps are typically inferred from luminance/shading, which breaks down on anything needing true displacement.

## Tier 1 — Automated {#tier-1}

Standard PBR materials are effectively automated. Meshy's texture generator is UV-aware, handles seams, and returns a full PBR set in minutes, against the 2–8 hours a hand-authored set used to take in Substance Designer. For the bulk material library this is the default now.

## Tier 2 — AI-assisted {#tier-2}

Adobe has embedded generative AI directly in Substance 3D, so the industry-standard toolset assists rather than being replaced by a bolt-on. This is where the hand-authored work gets faster without changing who does it.

## Tier 3 — Artist-led {#tier-3}

The small set of hero surfaces where the material itself is the star of the shot still gets hand-authored. The concrete technical gap: AI-derived normal maps are usually inferred from luminance and shading, which breaks down on anything that needs true displacement.
$doc$,
 '[{"key":"uv_aware","label":"UV-Aware","type":"boolean"},{"key":"map_types","label":"PBR Maps Generated","type":"text"},{"key":"pricing","label":"Pricing","type":"text"}]'::jsonb),

('lookdev', 'Look Development', $doc$
Still solidly artist-led. No tool does end-to-end shading/lookdev decision-making — calibrating a hero material under production lighting, matching client reference, balancing shader complexity against render cost. AI touches the edges (generating a starting material, generating reference concept art to light-match against) but the actual judgment call hasn't moved. Net effect: lookdev artists spend less time building materials from scratch, more time judging and correcting AI-generated ones.

## Tier 1 — Automated {#tier-1}

Nothing. No tool does end-to-end shading or lookdev decision-making.

## Tier 2 — AI-assisted {#tier-2}

No dedicated tools tracked yet. The assistance comes from adjacent departments: a generated starting material (see Texturing) or generated reference concept art to light-match against. If a lookdev-specific tool shows up it belongs here.

## Tier 3 — Artist-led {#tier-3}

Calibrating a hero material under production lighting, matching client reference, and balancing shader complexity against render cost are still judgment calls, and the judgment hasn't moved. The net effect on the job is a shift in time: less building materials from scratch, more judging and correcting generated ones.
$doc$,
 '[{"key":"renderer_support","label":"Renderer Support","type":"text"}]'::jsonb),

('rigging', 'Rigging', $doc$
Split cleanly by character type. Auto-rigging matches junior-to-mid rigger quality for standard humanoid work. What stays manual: facial rigs, non-humanoid/stylized creatures, custom deformation systems, anything interfacing with a sim rig. Maya path: Advanced Skeleton (native Maya nodes, more future-proof, HumanIK-compatible) or mGear (open-source, more flexible, custom-node dependency risk). Houdini path: KineFX (procedural, tag-based) + APEX (rig logic layer) + Autorig Builder (one-click on top of KineFX, fully editable output, not a fixed template).

## Tier 1 — Automated {#tier-1}

Nothing tracked here yet. Auto-riggers get close for standard humanoids but the output is still set up, checked, and extended by a rigger.

## Tier 2 — AI-assisted {#tier-2}

For standard humanoid work, auto-rigging matches junior-to-mid rigger quality. On the Maya side the choice is Advanced Skeleton (native Maya nodes only, so more future-proof, HumanIK-compatible, includes facial and ARKit rigging) or mGear (open-source, more flexible, modular templates, with a custom-node dependency risk). Both hook into HumanIK, Maya's built-in retargeting backbone for mocap-driven bipeds. On the Houdini side the stack is KineFX (procedural, tag-based joints and components), APEX (the rig logic layer), and Autorig Builder (one click on top of KineFX with fully editable output, not a fixed template). AccuRIG is the free standalone option for clean humanoid rigs, exporting to Blender, Maya, Unreal, and Unity.

## Tier 3 — Artist-led {#tier-3}

Facial rigs, non-humanoid and stylized creatures, custom deformation systems, and anything that has to interface with a simulation rig are still built by hand.
$doc$,
 '[{"key":"host_app","label":"Host App","type":"text"},{"key":"mocap_compatible","label":"Mocap-Compatible","type":"boolean"},{"key":"future_proofing","label":"Node Dependency Risk","type":"text"}]'::jsonb),

('muscle-skinning', 'Muscle & Skinning', $doc$
Ziva VFX defined this category (ML-based muscle/tissue deformation as a Maya plugin) but Unity discontinued sales, updates, and support. Perpetual licenses still function in current Maya but are unsupported and will eventually break. Current path: Maya's native ML Deformer (Autodesk AI, ships with Maya, trains a fast approximation of a complex/slow rig) and Houdini's Otis organic tissue solver (native, explicitly positioned as the Ziva migration path) plus Houdini's own ML Deform node network. ngSkinTools remains the standard manual weight-painting layer on top of native skinClusters, used alongside these rather than competing with them.

## Tier 1 — Automated {#tier-1}

Nothing tracked here yet.

## Tier 2 — AI-assisted {#tier-2}

Ziva VFX defined the category: ML-based muscle and tissue deformation as a Maya plugin. Unity has discontinued sales, updates, and support. Perpetual licenses still run in current Maya, but they are unsupported and will break on some future Maya release, so it stays in the list as discontinued with a replacement link rather than being removed. The current path is native on both hosts. In Maya, the ML Deformer (introduced in 2025.2, refined in Maya 2026) trains a fast approximation of a complex or slow deformation rig. In Houdini, Otis, the organic tissue solver, is SideFX's explicit migration path for teams leaving Ziva (muscle activation, tissue, muscle transfer), and Houdini's ML Deform node network in KineFX is the Houdini-native equivalent of Maya's ML Deformer, using PCA-compressed displacement training.

## Tier 3 — Artist-led {#tier-3}

Weight painting is still manual. ngSkinTools remains the standard layered weight-painting tool on top of native skinClusters; it is used alongside the ML deformers rather than competing with them, and it is not itself AI.
$doc$,
 '[{"key":"host_app","label":"Host App","type":"text"},{"key":"approach","label":"Approach","type":"text"},{"key":"status","label":"Support Status","type":"text"}]'::jsonb),

('simulation-fx', 'Simulation (FX)', $doc$
The discipline every source agrees holds up best against AI replacement. Fluid, destruction, cloth, and crowd-adjacent sim require an artist's judgment on turbulence scale, art-directed flicker, and reading subtle instabilities — AI can propose solver defaults or auto-tune substeps/resolution targets, but the creative decisions remain human. Houdini (Pyro, FLIP, Vellum, MPM) is the correct core to build around; the 2026 roadmap leans into GPU-accelerated SOPs/VEX and tighter USD/Hydra integration, not away from procedural artistry.

## Tier 1 — Automated {#tier-1}

Nothing. No source claims unattended simulation work.

## Tier 2 — AI-assisted {#tier-2}

No dedicated tools tracked yet. Where AI shows up it proposes solver defaults or auto-tunes substeps and resolution targets; the creative decisions stay with the artist. Track anything that does more than that here.

## Tier 3 — Artist-led {#tier-3}

Fluid, destruction, cloth, and crowd-adjacent simulation all depend on an artist reading turbulence scale, art-directing flicker, and catching subtle instabilities. Houdini's solvers (Pyro, FLIP, Vellum, MPM) are the core to build around, and SideFX's 2026 roadmap leans into GPU-accelerated SOPs and VEX and tighter USD/Hydra integration rather than away from procedural artistry.
$doc$,
 '[{"key":"solver_type","label":"Solver Type","type":"text"}]'::jsonb),

('crowds', 'Crowds', $doc$
Autodesk acquired Golaem's IP in August 2024 and folded the Golaem-for-Maya plugin directly into the Maya Media & Entertainment Collection as of the 2025/2026 release — explicitly pitched for stadium-scale crowds. It's procedural at its core (rule-based behavior you define) with AI-assisted workflows layered on top, not learned behavior end-to-end. Miarmy leans further into genuine AI behavioral animation, cheaper, steeper learning curve. Massive is the higher-end reference point for crowds that react to environment via real AI decision-making rather than pure procedural rules. Houdini Crowds is the native alternative if you're staffing toward Houdini-fluent TDs — more technical setup, no third-party plugin/version risk.

## Tier 1 — Automated {#tier-1}

Nothing tracked here yet. Every crowd system still needs its behaviour authored.

## Tier 2 — AI-assisted {#tier-2}

Golaem is now Autodesk's: the IP was acquired in August 2024 and the Maya plugin ships inside the Maya Media & Entertainment Collection as of the 2025/2026 release, pitched explicitly at stadium-scale crowds. It is procedural at the core (rule-based behaviour you define) with AI-assisted workflows on top, not learned behaviour end to end. Miarmy leans further into genuine AI behavioural animation with character logic networks; it is cheaper and has a steeper learning curve. Massive is the higher-end reference point for crowds that react to their environment through real agent decision-making rather than pure rules. Houdini Crowds is the native alternative if the team is staffing toward Houdini-fluent TDs: more technical setup, no third-party plugin or version risk.

## Tier 3 — Artist-led {#tier-3}

Authoring the behaviour, the rules, and the art direction of a crowd is still the TD's job on every one of these systems.
$doc$,
 '[{"key":"host_app","label":"Host App","type":"text"},{"key":"behavior_model","label":"Behavior Model","type":"text"},{"key":"licensing","label":"Licensing","type":"text"}]'::jsonb),

('rendering-denoising', 'Rendering & Denoising', $doc$
Denoising and up-res are the clearest Tier 1 case in the whole pipeline. NVIDIA OptiX and Intel Open Image Denoise are standard across V-Ray, Arnold, Redshift, Cycles, and Karma, cutting required sample counts from ~2000-4000 down to ~200-500 for comparable quality (40-60% render-time reduction reported). OIDN won a Technical Achievement Award from the Academy in 2025. What doesn't move: renderer choice and lighting design remain a creative/cost/turnaround decision, not an AI-adoption one.

## Tier 1 — Automated {#tier-1}

Denoising and up-res are the clearest automated case in the whole pipeline. NVIDIA OptiX and Intel Open Image Denoise are standard across V-Ray, Arnold, Redshift, Cycles, and Karma, cutting required sample counts from roughly 2,000–4,000 to 200–500 for comparable quality, with 40–60% render-time reductions reported. OIDN won an Academy Technical Achievement Award in 2025. Topaz Video AI covers the local upscaling, denoising and restoration, stabilization, and frame-interpolation side with 19+ specialized models as of 2026.

## Tier 2 — AI-assisted {#tier-2}

Nothing tracked here yet.

## Tier 3 — Artist-led {#tier-3}

Renderer choice and lighting design don't move. Both remain creative, cost, and turnaround decisions rather than AI-adoption ones.
$doc$,
 '[{"key":"denoiser","label":"Denoiser","type":"text"},{"key":"gpu_cpu","label":"GPU/CPU","type":"text"},{"key":"pricing","label":"Pricing","type":"text"}]'::jsonb),

('capture-splats-photogrammetry', 'Capture (Gaussian Splats & Photogrammetry)', $doc$
Moved from research novelty to shipped production tooling fast. Framestore used 4D Gaussian splatting on Superman (2025) to deliver ~40 final-pixel shots. By early 2026: Nuke 17 ships native splat support, Houdini 21 has a technical preview, OpenUSD 26.03 added a first-class schema, V-Ray 7 can ray-trace splats. Real, currently-unsolved gaps: no full-material relighting in any shipping commercial tool as of April 2026, no clean mesh/retopology extraction, no traditional AOVs (diffuse/specular/shadow passes). Best for environment/background capture, not a drop-in replacement for a lit CG asset yet.

## Tier 1 — Automated {#tier-1}

Nothing tracked here yet.

## Tier 2 — AI-assisted {#tier-2}

Gaussian splatting went from research novelty to shipped production tooling fast. Framestore used 4D Gaussian splatting on Superman (2025) to deliver around 40 final-pixel shots. By early 2026 Nuke 17 ships native splat support, Houdini 21 has a technical preview, OpenUSD 26.03 added a first-class schema, and V-Ray 7 can ray-trace splats. It is best for environment and background capture.

## Tier 3 — Artist-led {#tier-3}

The unsolved gaps keep splats out of the hero-asset lane: no full-material relighting in any shipping commercial tool as of April 2026, no clean mesh or retopology extraction, and no traditional AOVs (diffuse, specular, shadow passes). Anything that needs those is still a lit CG asset built the usual way.
$doc$,
 '[{"key":"engine_support","label":"Engine/DCC Support","type":"text"},{"key":"relightable","label":"Relightable","type":"boolean"},{"key":"mesh_extraction","label":"Clean Mesh Extraction","type":"boolean"}]'::jsonb),

('generative-comfyui', 'Generative / ComfyUI Workflows', $doc$
Split between consumer-grade open pipelines and studio-safe licensed pipelines. ComfyUI is the node-based, open-source visual-programming layer for Stable Diffusion and similar models, flexible but with uncertain-provenance training data for some models — a legal exposure issue for commercial work. Foundry's Griptape/Bria integration is the studio-safe answer: rights-clear, licensed-data-trained nodes native inside Nuke, keeping alpha/metadata/provenance intact instead of round-tripping through a browser tool.

## Tier 1 — Automated {#tier-1}

Nothing tracked here yet.

## Tier 2 — AI-assisted {#tier-2}

The split is open versus studio-safe. ComfyUI is the node-based, open-source visual-programming layer for Stable Diffusion and similar models: flexible, but some models carry uncertain-provenance training data, which is a legal exposure for commercial work. Foundry's Griptape and Bria integration is the studio-safe answer, with rights-clear nodes trained on licensed data running natively inside Nuke, keeping alpha, metadata, and provenance intact instead of round-tripping through a browser tool. (Bria/Griptape is tracked under Compositing, where it is used.)

## Tier 3 — Artist-led {#tier-3}

Making a generated element actually sit in a shot is comp work, and that judgment is still the artist's. See Compositing.
$doc$,
 '[{"key":"licensing_clarity","label":"Licensing Clarity","type":"text"},{"key":"native_dcc","label":"Native DCC","type":"text"}]'::jsonb),

('mocap-animation', 'Mocap & Animation', $doc$
Markerless capture (Move AI, DeepMotion) turns phone/multi-camera video into 3D motion data without a suit, exporting directly to Maya HIK format; Move AI explicitly supports multi-person capture for background/crowd characters. Cascadeur is not capture — it's an AI-assisted keyframe editor (auto-posing, physics-aware in-betweening) used to polish capture output. Known limitation across every source: gross body motion (walking, gesturing) is production-usable, but fine finger articulation, foot-ground contact, and occluded limbs still need manual cleanup.

## Tier 1 — Automated {#tier-1}

Nothing tracked here yet. Capture output is production-usable for gross motion but always gets a cleanup pass.

## Tier 2 — AI-assisted {#tier-2}

Markerless capture turns phone or multi-camera video into 3D motion data without a suit. Move AI exports pre- and post-retarget FBX straight into Maya HIK and explicitly supports multi-person capture for background and crowd characters. DeepMotion's Animate 3D is browser-based and captures up to eight characters from a single video. Autodesk Flow Studio (formerly Wonder Studio) is the full live-action-to-CG pipeline: markerless body, hand, and face capture plus camera tracking, clean plates, and character compositing. Cascadeur is not capture; it is an AI-assisted keyframe editor (auto-posing, physics-aware in-betweening, collision cleanup) used to polish raw capture.

## Tier 3 — Artist-led {#tier-3}

Every source agrees on the limit: gross body motion (walking, gesturing) is production-usable, but fine finger articulation, foot-to-ground contact, and occluded limbs still need manual cleanup. The performance itself is still the animator's.
$doc$,
 '[{"key":"capture_type","label":"Capture Type","type":"text"},{"key":"multi_person","label":"Multi-Person Capture","type":"boolean"},{"key":"export_format","label":"Export Format","type":"text"}]'::jsonb)

on conflict (slug) do update set
  name = excluded.name,
  overview_doc = excluded.overview_doc,
  comparison_attributes = excluded.comparison_attributes;

-- ── Tools ───────────────────────────────────────────────────────────────
-- attributes follow the department's comparison_attributes keys above.
-- Keys are omitted (not guessed) where the research didn't establish them.

insert into pp_tools (department_id, name, tier, host_app, status, vendor, blurb, attributes, source_urls) values

-- Roto & Tracking
((select id from pp_departments where slug = 'roto-tracking'), 'SLAPSHOT Autopilot', 'automated', 'web', 'active', 'SLAPSHOT',
 'Fully autonomous roto across every layer in a shot, exports organized cryptomatte.',
 '{"throughput":"Whole shot, every layer, unattended","output_format":"Organized cryptomatte"}'::jsonb,
 array['https://slapshot.ai/','https://www.televisual.com/news/slapshot-launches-auto-ai-rotoscoping-system/']),
((select id from pp_departments where slug = 'roto-tracking'), 'Silhouette (ML tracking suite)', 'automated', 'standalone', 'active', 'Boris FX',
 'Head Track ML, Object Tracker, Point Track ML — automated tracking through occlusion and lighting change.',
 '{"throughput":"Per-object and per-point ML tracks","handles_occlusion":true,"output_format":"Silhouette tracks and shapes"}'::jsonb,
 array['https://borisfx.com/products/silhouette/']),
((select id from pp_departments where slug = 'roto-tracking'), 'BigCat / CopyCat', 'automated', 'Nuke', 'active', 'Foundry',
 'Trains ML roto/cleanup models, scaled to hundreds or thousands of frames, native to Nuke.',
 '{"throughput":"Hundreds to thousands of frames per trained model","output_format":"Nuke node output (mattes, cleanup plates)"}'::jsonb,
 array['https://www.foundry.com/ai-solutions']),

-- Compositing
((select id from pp_departments where slug = 'compositing'), 'Bria / Griptape for Nuke', 'assisted', 'Nuke', 'active', 'Bria / Foundry',
 'Rights-clear generative nodes native in the Nuke comp graph, provenance-tracked, licensed training data.',
 '{"native_integration":"Nuke (native nodes via Griptape)","licensing":"Rights-clear, licensed training data, provenance tracked"}'::jsonb,
 array['https://bria.ai/blog/bringing-generative-ai-into-nuke-natively']),
((select id from pp_departments where slug = 'compositing'), 'Beeble (relighting/pass generation)', 'assisted', 'plugin', 'active', 'Beeble',
 'Extracts full PBR passes from ordinary footage for post-capture relighting; local desktop version runs fully on-prem.',
 '{"native_integration":"Desktop app; PBR passes feed any comp","licensing":"Commercial; local version runs fully on-prem"}'::jsonb,
 array['https://beeble.ai/','https://www.cined.com/beeble-studio-launches-with-local-4k-ai-relighting-and-switchlight-3-0-engine/']),

-- Modeling
((select id from pp_departments where slug = 'modeling'), 'Rodin (Hyper3D)', 'assisted', 'web', 'active', 'Deemos / ByteDance-backed',
 'Leads on geometric fidelity, hard-surface and mechanical objects, professional export workflows.',
 '{"topology_quality":"Highest geometric fidelity of the set; hard-surface and mechanical","export_formats":"Professional export workflows"}'::jsonb,
 array['https://www.indiehackers.com/post/best-ai-3d-model-generator-in-2026-i-tested-9-of-the-best-and-here-is-what-i-found-70ecab1a0a']),
((select id from pp_departments where slug = 'modeling'), 'Meshy', 'assisted', 'web', 'active', 'Meshy',
 'Most complete end-to-end pipeline: text/image to model to PBR texture in one platform.',
 '{"topology_quality":"Model plus PBR texture in one pass; most complete end to end"}'::jsonb,
 array['https://www.meshy.ai/blog/best-ai-tools-for-3d-game-assets']),
((select id from pp_departments where slug = 'modeling'), 'Tripo AI', 'assisted', 'web', 'active', 'Tripo',
 'Fastest generation, best for stylized/hand-painted look, quad retopology via Smart Mesh.',
 '{"topology_quality":"Quad retopology via Smart Mesh; best for stylized","speed":"Fastest of the set"}'::jsonb,
 array['https://www.strayspark.studio/blog/generative-3d-tools-comparison-meshy-rodin-tripo-csm-2026']),
((select id from pp_departments where slug = 'modeling'), 'TRELLIS 2', 'assisted', 'standalone', 'active', 'Microsoft Research (open-source)',
 'Leading open-source option; image-to-3D with Gaussian-splat output, runs inside ComfyUI.',
 '{"topology_quality":"Image-to-3D; leading open-source option","export_formats":"Gaussian splat output; runs inside ComfyUI","pricing":"Open-source"}'::jsonb,
 array['https://trellis2.app/blog/best-ai-3d-model-generator']),

-- Texturing
((select id from pp_departments where slug = 'texturing'), 'Meshy AI Texture Generator', 'automated', 'web', 'active', 'Meshy',
 'UV-aware texturing, automatic seam handling, full PBR set output.',
 '{"uv_aware":true,"map_types":"Full PBR set"}'::jsonb,
 array['https://www.meshy.ai/blog/best-ai-texture-generators']),
((select id from pp_departments where slug = 'texturing'), 'Adobe Substance 3D (generative)', 'assisted', 'standalone', 'active', 'Adobe',
 'Generative AI embedded directly in the industry-standard texturing toolset, not a bolt-on.',
 '{"uv_aware":true,"map_types":"Full PBR (Substance materials)","pricing":"Adobe subscription"}'::jsonb,
 array['https://www.aimagicx.com/blog/ai-texture-generator-game-development-2026']),

-- Rigging
((select id from pp_departments where slug = 'rigging'), 'Advanced Skeleton', 'assisted', 'Maya', 'active', 'Advanced Skeleton',
 'Native Maya nodes only (no custom node dependency), HumanIK-compatible, includes facial/ARKit rigging.',
 '{"host_app":"Maya","mocap_compatible":true,"future_proofing":"Low — native Maya nodes only"}'::jsonb,
 array['https://forums.3dmodels.org/autodesk-maya/whats-your-go-to-autorigger-for-maya/']),
((select id from pp_departments where slug = 'rigging'), 'mGear', 'assisted', 'Maya', 'active', 'Open-source (MIT)',
 'Modular rig framework, biped/quadruped templates, maps mocap from HumanIK skeleton to rig templates.',
 '{"host_app":"Maya","mocap_compatible":true,"future_proofing":"Moderate — custom-node dependency"}'::jsonb,
 array['https://www.cgchannel.com/2018/05/miquel-campos-releases-mgear-2-0-for-maya/']),
((select id from pp_departments where slug = 'rigging'), 'Maya HumanIK', 'assisted', 'Maya', 'active', 'Autodesk (native)',
 'Built-in retargeting backbone for bipedal mocap-driven rigs; what Advanced Skeleton and mGear both hook into.',
 '{"host_app":"Maya","mocap_compatible":true,"future_proofing":"None — ships with Maya"}'::jsonb,
 array[]::text[]),
((select id from pp_departments where slug = 'rigging'), 'KineFX + APEX + Autorig Builder', 'assisted', 'Houdini', 'active', 'SideFX (native)',
 'Procedural rigging (tag joints, assign components) plus one-click Autorig Builder on top, fully editable output.',
 '{"host_app":"Houdini","future_proofing":"None — native Houdini"}'::jsonb,
 array['https://digitalproduction.com/2026/07/01/houdini-rigging-how-i-learned-to-stop-worrying-and-start-loving-apex/']),
((select id from pp_departments where slug = 'rigging'), 'AccuRIG', 'assisted', 'standalone', 'active', 'Reallusion',
 'Free standalone auto-rigger for clean humanoid rigs, exports to Blender/Maya/Unreal/Unity.',
 '{"host_app":"Standalone (exports to Blender, Maya, Unreal, Unity)","future_proofing":"Low — exported rig, no plugin dependency"}'::jsonb,
 array['https://www.meshy.ai/blog/best-ai-auto-rigging-tool']),

-- Muscle & Skinning
((select id from pp_departments where slug = 'muscle-skinning'), 'Ziva VFX', 'assisted', 'Maya', 'discontinued', 'Unity (formerly)',
 'ML-based muscle/tissue deformation. Sales and updates discontinued by Unity; perpetual licenses still function but unsupported. Maya-side successor is the native ML Deformer; Houdini-side successor is Otis.',
 '{"host_app":"Maya","approach":"ML-based muscle and tissue deformation plugin","status":"Discontinued by Unity; perpetual licenses run but unsupported"}'::jsonb,
 array['https://superrendersfarm.com/article/ziva-vfx-vs-houdini-simulation']),
((select id from pp_departments where slug = 'muscle-skinning'), 'Maya ML Deformer', 'assisted', 'Maya', 'active', 'Autodesk (native)',
 'Native machine-learned fast approximation of complex/slow deformation rigs; introduced 2025.2, refined in Maya 2026.',
 '{"host_app":"Maya","approach":"Trained fast approximation of a complex or slow rig","status":"Native, shipping (2025.2+, refined in 2026)"}'::jsonb,
 array['https://www.cgchannel.com/2025/03/autodesk-releases-maya-2026-and-maya-creative-2026/']),
((select id from pp_departments where slug = 'muscle-skinning'), 'Houdini Otis (organic tissue solver)', 'assisted', 'Houdini', 'active', 'SideFX (native)',
 'SideFX''s explicit migration path for teams moving off Ziva; native muscle activation, tissue, muscle transfer.',
 '{"host_app":"Houdini","approach":"Organic tissue solver: muscle activation, tissue, muscle transfer","status":"Native, shipping in Houdini 21"}'::jsonb,
 array['https://www.cgchannel.com/2025/08/sneak-peek-houdini-21-see-300-features-listed-in-the-video/']),
((select id from pp_departments where slug = 'muscle-skinning'), 'Houdini ML Deform', 'assisted', 'Houdini', 'active', 'SideFX (native)',
 'Houdini-native equivalent to Maya''s ML Deformer, built into KineFX, PCA-compressed displacement training.',
 '{"host_app":"Houdini","approach":"PCA-compressed displacement training in KineFX","status":"Native, shipping"}'::jsonb,
 array['https://www.sidefx.com/docs/houdini/news/20_5/ml.html']),
((select id from pp_departments where slug = 'muscle-skinning'), 'ngSkinTools', 'artist_led', 'Maya', 'active', 'ngSkinTools',
 'Industry-standard manual skin-weight painting layer on top of native skinClusters, not itself AI.',
 '{"host_app":"Maya","approach":"Manual layered weight painting on native skinClusters","status":"Active, third-party"}'::jsonb,
 array[]::text[]),

-- Simulation (FX)
((select id from pp_departments where slug = 'simulation-fx'), 'Houdini FX solvers (Pyro, FLIP, Vellum, MPM)', 'artist_led', 'Houdini', 'active', 'SideFX (native)',
 'The core to build FX around. Every source agrees sim holds up best against AI: solver defaults can be proposed, the creative calls stay human.',
 '{"solver_type":"Pyro, FLIP, Vellum, MPM"}'::jsonb,
 array['https://www.sidefx.com/products/houdini/']),

-- Crowds
((select id from pp_departments where slug = 'crowds'), 'Golaem', 'assisted', 'Maya', 'active', 'Autodesk (acquired Aug 2024)',
 'Now bundled in Maya''s M&E Collection; explicitly pitched for stadium crowds. Procedural core with AI-assisted workflows layered in.',
 '{"host_app":"Maya","behavior_model":"Procedural rules with AI-assisted workflows on top","licensing":"Bundled in the Maya Media & Entertainment Collection"}'::jsonb,
 array['https://blogs.autodesk.com/media-and-entertainment/2025/03/26/introducing-new-crowd-tools-ai-and-connected-workflows/']),
((select id from pp_departments where slug = 'crowds'), 'Miarmy', 'assisted', 'Maya', 'active', 'Basefount',
 'AI behavioral animation engine, character logic networks, used on FIFA and Assassin''s Creed.',
 '{"host_app":"Maya","behavior_model":"AI behavioural animation, character logic networks","licensing":"Commercial; cheaper than Golaem, steeper learning curve"}'::jsonb,
 array['https://www.renderhub.com/blog/enhancing-game-realism-top-5-crowd-simulation-tools']),
((select id from pp_departments where slug = 'crowds'), 'Massive', 'assisted', 'standalone', 'active', 'Massive Software',
 'Higher-end reference point for crowds reacting to environment via real AI decision-making rather than pure rules.',
 '{"host_app":"Standalone","behavior_model":"Agent AI decision-making reacting to the environment","licensing":"Commercial, high-end"}'::jsonb,
 array['https://windowsreport.com/crowd-simulation-software/']),
((select id from pp_departments where slug = 'crowds'), 'Houdini Crowds', 'assisted', 'Houdini', 'active', 'SideFX (native)',
 'Native procedural crowd system with agent intelligence; no third-party plugin/version risk.',
 '{"host_app":"Houdini","behavior_model":"Procedural agents with agent intelligence","licensing":"Included with Houdini"}'::jsonb,
 array['https://www.sidefx.com/products/houdini/characters/']),

-- Rendering & Denoising
((select id from pp_departments where slug = 'rendering-denoising'), 'OptiX / Intel OIDN (AI denoising)', 'automated', 'standalone', 'active', 'NVIDIA / Intel',
 'Standard across V-Ray, Arnold, Redshift, Cycles, Karma. Cuts sample counts ~2000-4000 to ~200-500. OIDN won an Academy Technical Achievement Award (2025).',
 '{"denoiser":"OptiX (NVIDIA) and Open Image Denoise (Intel)","gpu_cpu":"OptiX on NVIDIA GPU; OIDN on CPU and GPU","pricing":"Free, bundled in the major renderers"}'::jsonb,
 array['https://superrendersfarm.com/article/vfx-industry-trends-2026']),
((select id from pp_departments where slug = 'rendering-denoising'), 'Topaz Video AI', 'automated', 'standalone', 'active', 'Topaz Labs',
 'Local upscaling, denoising/restoration, stabilization, frame interpolation; 19+ specialized models as of 2026.',
 '{"denoiser":"Topaz models (19+ specialized, 2026)","gpu_cpu":"Local GPU","pricing":"Commercial license"}'::jsonb,
 array['https://unifab.ai/resource/topaz-video-ai-review']),

-- Capture
((select id from pp_departments where slug = 'capture-splats-photogrammetry'), '3D Gaussian Splatting (production tooling)', 'assisted', 'standalone', 'active', 'Various (Nuke 17, Houdini 21 preview, V-Ray 7, OpenUSD 26.03)',
 'Framestore delivered ~40 final-pixel shots on Superman (2025). No full-material relighting or clean mesh extraction yet in commercial tools.',
 '{"engine_support":"Nuke 17 native; Houdini 21 technical preview; V-Ray 7 ray-tracing; OpenUSD 26.03 schema","relightable":false,"mesh_extraction":false}'::jsonb,
 array['https://cglounge.studio/journal/gaussian-splatting-for-vfx','https://superrendersfarm.com/article/vfx-industry-trends-2026']),

-- Generative / ComfyUI
((select id from pp_departments where slug = 'generative-comfyui'), 'ComfyUI', 'assisted', 'standalone', 'active', 'Open-source',
 'Node-based visual programming for Stable Diffusion and related models; flexible but licensing/provenance varies by model used.',
 '{"licensing_clarity":"Varies by model; uncertain provenance for some training data","native_dcc":"None — standalone node graph"}'::jsonb,
 array['https://www.actionvfx.com/blog/top-10-ai-tools-for-vfx-workflows']),

-- Mocap & Animation
((select id from pp_departments where slug = 'mocap-animation'), 'Move AI', 'assisted', 'standalone', 'active', 'Move AI',
 'Markerless mocap from phone/multi-camera video, exports pre/post-retarget FBX directly to Maya HIK, supports multi-person/crowd capture.',
 '{"capture_type":"Markerless (phone or multi-camera video)","multi_person":true,"export_format":"Pre/post-retarget FBX to Maya HIK"}'::jsonb,
 array['https://aitoolsexplorer.com/ai-tools/move-ai-markerless-motion-capture/']),
((select id from pp_departments where slug = 'mocap-animation'), 'DeepMotion Animate 3D', 'assisted', 'web', 'active', 'DeepMotion',
 'Browser-based markerless mocap, up to 8 characters from a single video; gross motion strong, finger/foot-contact still weak.',
 '{"capture_type":"Markerless (single video, browser)","multi_person":true}'::jsonb,
 array['https://www.aichatdaily.com/tools/deepmotion']),
((select id from pp_departments where slug = 'mocap-animation'), 'Cascadeur', 'assisted', 'standalone', 'active', 'Nekki',
 'AI-assisted keyframe editor: auto-posing, physics-aware in-betweening, collision cleanup. Used to polish raw mocap, not to capture it.',
 '{"capture_type":"Not capture — AI-assisted keyframe editor"}'::jsonb,
 array['https://www.neolemon.com/blog/best-ai-motion-capture-tools-for-character-animation/']),
((select id from pp_departments where slug = 'mocap-animation'), 'Autodesk Flow Studio (formerly Wonder Studio)', 'assisted', 'web', 'active', 'Autodesk',
 'Full live-action-to-CG pipeline: markerless body/hand/face mocap, camera tracking, clean plates, character compositing.',
 '{"capture_type":"Markerless body, hand, and face from live-action footage"}'::jsonb,
 array['https://www.neolemon.com/blog/best-ai-motion-capture-tools-for-character-animation/'])

on conflict (department_id, name) do update set
  tier = excluded.tier,
  host_app = excluded.host_app,
  status = excluded.status,
  vendor = excluded.vendor,
  blurb = excluded.blurb,
  attributes = excluded.attributes,
  source_urls = excluded.source_urls;

-- ── Derived columns ─────────────────────────────────────────────────────

-- Every tool deep-links into its tier section of the department doc unless
-- a more specific anchor has been set (by hand or via the queue).
update pp_tools
set doc_anchor = case tier
  when 'automated' then 'tier-1'
  when 'assisted' then 'tier-2'
  else 'tier-3'
end
where doc_anchor is null;

-- Verification stamp = the date of the research session this seed came from
-- (noon UTC so it reads as the same calendar day in US time zones).
update pp_tools
set last_verified_at = '2026-09-14T12:00:00Z'
where last_verified_at is null;

-- ── Ziva → replacement link ────────────────────────────────────────────
-- A single FK can only point at one canonical replacement. Houdini Otis is
-- the closer functional match (native tissue solver, SideFX's stated Ziva
-- migration path); Maya ML Deformer is named as the Maya-side successor in
-- Ziva's blurb and shows up as an alternative on its detail page.

update pp_tools
set replacement_tool_id = (
  select id from pp_tools
  where name = 'Houdini Otis (organic tissue solver)'
    and department_id = (select id from pp_departments where slug = 'muscle-skinning')
)
where name = 'Ziva VFX'
  and department_id = (select id from pp_departments where slug = 'muscle-skinning');
