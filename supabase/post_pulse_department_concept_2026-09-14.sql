-- Post Pulse: add the Concept & Image Generation department (2026-09-14)
-- First pre-production department (pipeline_substage stays NULL outside
-- post_production). The models themselves live under Generative Media
-- Models & Platforms; this covers their pre-production use.
-- Idempotent. seed_post_pulse.sql and the pipeline stage seed match.

insert into pp_departments (slug, name, overview_doc, comparison_attributes, pipeline_stage, pipeline_substage) values
('concept-image-generation', 'Concept & Image Generation', $doc$
Concept art, mood boards, storyboards, and early previs frames — the pre-production work that turns a script and a director's references into images a studio can bid, plan, and pitch from. Added on 2026-09-14 as the first pre-production department; the tool roster and tier reasoning below are a scaffold until the first research pass fills them in. Scope note: the image and video models themselves (and the platforms that host them) are tracked under Generative Media Models & Platforms; this department is about their use in pre-production — the tools, workflows, and controls that get a concept artist or a storyboard artist from brief to approved frame — and about what that has done to the job.

## Tier 1 — Automated {#tier-1}

Nothing tracked yet. Nothing in concept work ships without an artist's selection and direction, so expect this tier to stay thin.

## Tier 2 — AI-assisted {#tier-2}

Nothing tracked yet. Candidates to look for: text- and sketch-to-image tools with real art-direction controls (reference images, ControlNet-style guidance, style locking), storyboard and shot-planning tools, and rights-clear image generation studios can put in a bid deck.

## Tier 3 — Artist-led {#tier-3}

Choosing the frame, the design language, and what the director actually responds to is still the concept artist's job; generation has moved the labour, not the taste. Treat this as the default until the research pass shows otherwise.
$doc$,
 '[{"key": "output_type", "label": "Output Type", "type": "text"}, {"key": "licensing_clarity", "label": "Licensing Clarity", "type": "text"}, {"key": "control", "label": "Art-direction Controls", "type": "text"}, {"key": "pricing", "label": "Pricing", "type": "text"}]'::jsonb, 'pre_production', null)
on conflict (slug) do update set
  name = excluded.name,
  comparison_attributes = excluded.comparison_attributes,
  pipeline_stage = excluded.pipeline_stage,
  pipeline_substage = excluded.pipeline_substage;
