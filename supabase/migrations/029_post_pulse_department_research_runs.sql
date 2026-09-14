-- Post Pulse: native research-run storage (replaces Pulse briefing crossover)
-- Mirrors pp_frontier_scans' shape for department-scoped maintenance runs,
-- so both run types have native, in-app-only storage — nothing routes
-- through Pulse's briefing/channel system anymore.

create table if not exists pp_department_research_runs (
  id uuid primary key default gen_random_uuid(),
  department_id uuid not null references pp_departments(id) on delete cascade,
  ran_at timestamptz not null default now(),
  summary text,
  findings_count integer not null default 0,
  queued_count integer not null default 0,
  auto_published_count integer not null default 0
);

create index if not exists idx_pp_department_research_runs_dept_ran on pp_department_research_runs(department_id, ran_at desc);
