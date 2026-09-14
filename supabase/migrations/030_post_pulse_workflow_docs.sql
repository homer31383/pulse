-- Post Pulse: workflow docs (saved research)
-- A fourth content layer alongside overview doc / department docs / tool
-- entries — a prompt-and-answer pair saved from chat, tied to one
-- department, with staleness computed against pp_changelog rather than
-- just a bare timestamp.

create table if not exists pp_workflow_docs (
  id uuid primary key default gen_random_uuid(),
  department_id uuid not null references pp_departments(id) on delete cascade,
  title text not null,
  prompt text not null,
  content text not null,
  referenced_tool_ids uuid[] not null default '{}',
  source_urls text[] not null default '{}',
  source_chat_session_id uuid references pp_chat_sessions(id) on delete set null,
  created_at timestamptz not null default now(),
  last_verified_at timestamptz
);

create index if not exists idx_pp_workflow_docs_department on pp_workflow_docs(department_id, created_at desc);
create index if not exists idx_pp_workflow_docs_referenced_tools on pp_workflow_docs using gin (referenced_tool_ids);
