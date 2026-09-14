-- Post Pulse schema
-- Adds pp_departments, pp_tools, pp_changelog, pp_queue, pp_chat_sessions
-- Additive only — does not touch existing Pulse tables.

create table if not exists pp_departments (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  name text not null,
  overview_doc text not null default '',
  comparison_attributes jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists pp_tools (
  id uuid primary key default gen_random_uuid(),
  department_id uuid not null references pp_departments(id) on delete cascade,
  name text not null,
  tier text not null check (tier in ('automated', 'assisted', 'artist_led')),
  host_app text,
  status text not null default 'active' check (status in ('active', 'discontinued')),
  replacement_tool_id uuid references pp_tools(id) on delete set null,
  vendor text,
  blurb text,
  doc_anchor text,
  attributes jsonb not null default '{}'::jsonb,
  source_urls text[] not null default '{}',
  last_verified_at timestamptz,
  confidence text not null default 'verified' check (confidence in ('verified', 'queued')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_pp_tools_department on pp_tools(department_id);
create index if not exists idx_pp_tools_tier on pp_tools(tier);
create index if not exists idx_pp_tools_status on pp_tools(status);

-- Lets seed inserts use ON CONFLICT to stay safe across repeated runs,
-- same as pp_departments' slug constraint. Guarded so this file is safe
-- to run more than once by hand, not just once via tracked migrations.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'uq_pp_tools_department_name'
  ) then
    alter table pp_tools add constraint uq_pp_tools_department_name unique (department_id, name);
  end if;
end $$;

create table if not exists pp_changelog (
  id uuid primary key default gen_random_uuid(),
  tool_id uuid not null references pp_tools(id) on delete cascade,
  field_changed text not null,
  old_value text,
  new_value text,
  source text,
  created_at timestamptz not null default now()
);

create index if not exists idx_pp_changelog_tool on pp_changelog(tool_id);
create index if not exists idx_pp_changelog_created on pp_changelog(created_at desc);

create table if not exists pp_queue (
  id uuid primary key default gen_random_uuid(),
  proposed_tool_id uuid references pp_tools(id) on delete set null,
  proposed_changes jsonb not null,
  source text not null check (source in ('rss', 'search', 'chat')),
  source_urls text[] not null default '{}',
  status text not null default 'pending' check (status in ('pending', 'accepted', 'rejected')),
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

create index if not exists idx_pp_queue_status on pp_queue(status);

-- Stub for the in-app chat feature (§6 of spec). Kept minimal for now;
-- expand when the chat backend is actually built.
create table if not exists pp_chat_sessions (
  id uuid primary key default gen_random_uuid(),
  messages jsonb not null default '[]'::jsonb,
  proposed_queue_ids uuid[] not null default '{}',
  created_at timestamptz not null default now()
);

-- updated_at trigger, mirrors whatever pattern the rest of the Pulse schema
-- already uses — replace with the existing shared function if one exists
-- rather than duplicating it.
create or replace function pp_set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create or replace trigger trg_pp_departments_updated_at
  before update on pp_departments
  for each row execute function pp_set_updated_at();

create or replace trigger trg_pp_tools_updated_at
  before update on pp_tools
  for each row execute function pp_set_updated_at();
