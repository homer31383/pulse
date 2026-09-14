-- Post Pulse: generalize pp_changelog to support department targets
-- Fixes a real spec gap: §6a assumed department-doc edits could log to
-- pp_changelog, but tool_id was a NOT NULL fk from the original
-- migration, built before departments could be a queue target at all.
-- Mirrors the same target_type pattern already used on pp_queue.

alter table pp_changelog alter column tool_id drop not null;
alter table pp_changelog add column if not exists target_type text not null default 'tool';
alter table pp_changelog add column if not exists department_id uuid references pp_departments(id) on delete cascade;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'chk_pp_changelog_target_type'
  ) then
    alter table pp_changelog add constraint chk_pp_changelog_target_type
      check (target_type in ('tool', 'department'));
  end if;
end $$;

-- Exactly one of tool_id / department_id set, matching target_type —
-- keeps the table from silently accepting a row that points nowhere.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'chk_pp_changelog_target_consistency'
  ) then
    alter table pp_changelog add constraint chk_pp_changelog_target_consistency
      check (
        (target_type = 'tool' and tool_id is not null and department_id is null)
        or (target_type = 'department' and department_id is not null and tool_id is null)
      );
  end if;
end $$;

create index if not exists idx_pp_changelog_department on pp_changelog(department_id);
