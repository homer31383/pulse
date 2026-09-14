-- Post Pulse: pipeline stage mapping for the seeded departments
-- Run AFTER migrations/022_post_pulse_pipeline_stages.sql. Idempotent:
-- plain updates keyed by slug, safe to re-run. seed_post_pulse.sql does
-- not set these columns, so re-running it never clears this mapping.
--
-- Every department tracked so far is post-production work; the other
-- three stages are intentionally empty until that research is done.
-- Sub-groups follow post-production's internal flow: assets are built,
-- then performed/simulated, then rendered or captured, then composited.

update pp_departments set pipeline_stage = 'post_production', pipeline_substage = 'asset_creation'
where slug in ('modeling', 'texturing', 'lookdev', 'rigging');

update pp_departments set pipeline_stage = 'post_production', pipeline_substage = 'performance_simulation'
where slug in ('mocap-animation', 'muscle-skinning', 'simulation-fx', 'crowds');

update pp_departments set pipeline_stage = 'post_production', pipeline_substage = 'rendering_capture'
where slug in ('rendering-denoising', 'capture-splats-photogrammetry');

update pp_departments set pipeline_stage = 'post_production', pipeline_substage = 'comp_generative'
where slug in ('roto-tracking', 'compositing', 'generative-comfyui');

-- Sanity check: should return zero rows once every seeded department is mapped.
select slug from pp_departments where pipeline_stage is null;
