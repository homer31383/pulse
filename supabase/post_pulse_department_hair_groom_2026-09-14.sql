-- Post Pulse: add the Hair, Groom & Feathers department (2026-09-14)
-- Asset-creation work (grooming); hair/fur dynamics belong to Simulation.
-- Idempotent. seed_post_pulse.sql and the pipeline stage seed were
-- updated to match, so a fresh seed produces the same state.

insert into pp_departments (slug, name, overview_doc, comparison_attributes, pipeline_stage, pipeline_substage) values
('hair-groom-feathers', 'Hair, Groom & Feathers', $doc$
Grooming — hair, fur, and feathers — is asset work: building the guide curves, the procedural instancing, and the clumping, noise, and length maps that make a creature or a character read, and handing a groom the simulation department can drive. Added on 2026-09-14 as a scaffold; the tool roster and the tier reasoning below are placeholders until the first research pass fills them in. The standard toolset (XGen and Ornatrix in Maya, Yeti, Houdini's grooming tools) is procedural and artist-led; whether AI has moved any of it is exactly what the research pass should establish.

## Tier 1 — Automated {#tier-1}

Nothing tracked yet.

## Tier 2 — AI-assisted {#tier-2}

Nothing tracked yet. Candidates to look for: ML-assisted groom transfer between characters, hair reconstruction from scans or photos, and learned approximations of hair dynamics that could shortcut the sim round-trip.

## Tier 3 — Artist-led {#tier-3}

Hero grooms are artist-led end to end today: guide placement, clumping and breakup, and the look of the groom under production lighting are craft decisions, and feathers in particular remain a specialist skill. Treat this as the default until the research pass shows otherwise.
$doc$,
 '[{"key": "host_app", "label": "Host App", "type": "text"}, {"key": "groom_workflow", "label": "Groom Workflow", "type": "text"}, {"key": "sim_coupling", "label": "Simulation Coupling", "type": "text"}]'::jsonb, 'post_production', 'asset_creation')
on conflict (slug) do update set
  name = excluded.name,
  comparison_attributes = excluded.comparison_attributes,
  pipeline_stage = excluded.pipeline_stage,
  pipeline_substage = excluded.pipeline_substage;
