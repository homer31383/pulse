-- Post Pulse: frontier scan support
-- Tracks scan cadence per pipeline_stage (not per department, since
-- Pre-production/Production/Finishing & Delivery may have zero
-- departments to attach a timestamp to). Adds 'frontier' as a valid
-- pp_queue source so exploratory findings are distinguishable from
-- routine rss/search/chat ones.

create table if not exists pp_frontier_scans (
  id uuid primary key default gen_random_uuid(),
  pipeline_stage text not null check (pipeline_stage in ('pre_production', 'production', 'post_production', 'finishing_delivery')),
  ran_at timestamptz not null default now(),
  summary text,
  findings_count integer not null default 0,
  queued_count integer not null default 0
);

create index if not exists idx_pp_frontier_scans_stage_ran on pp_frontier_scans(pipeline_stage, ran_at desc);

-- Widen pp_queue.source to include 'frontier'. Constraint name may differ
-- from what's actually in the live schema (it was defined inline in an
-- earlier migration, not as a named constraint) — check pg_constraint
-- for the real name on pp_queue's source check before assuming this
-- drop/recreate matches; adjust the constraint name below if it doesn't.
do $$
declare
  existing_name text;
begin
  select conname into existing_name
  from pg_constraint
  where conrelid = 'pp_queue'::regclass
    and pg_get_constraintdef(oid) like '%source%'
  limit 1;

  if existing_name is not null then
    execute format('alter table pp_queue drop constraint %I', existing_name);
  end if;

  alter table pp_queue add constraint chk_pp_queue_source
    check (source in ('rss', 'search', 'chat', 'frontier'));
end $$;
