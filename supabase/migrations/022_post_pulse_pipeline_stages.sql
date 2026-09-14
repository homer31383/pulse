-- Post Pulse: pipeline stage mapping
-- Adds pipeline_stage and pipeline_substage to pp_departments so the
-- landing page can render a four-stage flowchart (pre-production /
-- production / post-production / finishing & delivery), with
-- post-production further split into its internal pipeline flow.
-- Additive, idempotent — safe to run more than once by hand.

alter table pp_departments add column if not exists pipeline_stage text;
alter table pp_departments add column if not exists pipeline_substage text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'chk_pp_departments_pipeline_stage'
  ) then
    alter table pp_departments add constraint chk_pp_departments_pipeline_stage
      check (pipeline_stage in ('pre_production', 'production', 'post_production', 'finishing_delivery'));
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'chk_pp_departments_pipeline_substage'
  ) then
    alter table pp_departments add constraint chk_pp_departments_pipeline_substage
      check (
        pipeline_substage is null
        or pipeline_substage in ('asset_creation', 'performance_simulation', 'rendering_capture', 'comp_generative')
      );
  end if;
end $$;

-- Substage should only ever be set for post_production departments.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'chk_pp_departments_substage_scope'
  ) then
    alter table pp_departments add constraint chk_pp_departments_substage_scope
      check (pipeline_substage is null or pipeline_stage = 'post_production');
  end if;
end $$;

create index if not exists idx_pp_departments_pipeline_stage on pp_departments(pipeline_stage);
