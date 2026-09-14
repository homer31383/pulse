-- Post Pulse: chat sessions + queue targeting for departments
-- Enables the chat research feature (spec §6/§6a). Additive, idempotent.

-- pp_chat_sessions was a minimal stub in the original migration
-- (id, messages, proposed_queue_ids, created_at). Add what real
-- sessions need: a name, optional department context, and updated_at
-- for sorting the session list by recent activity.
alter table pp_chat_sessions add column if not exists name text not null default 'Untitled session';
alter table pp_chat_sessions add column if not exists department_context_id uuid references pp_departments(id) on delete set null;
alter table pp_chat_sessions add column if not exists updated_at timestamptz not null default now();

create index if not exists idx_pp_chat_sessions_updated on pp_chat_sessions(updated_at desc);

create or replace trigger trg_pp_chat_sessions_updated_at
  before update on pp_chat_sessions
  for each row execute function pp_set_updated_at();

-- pp_queue originally only supported tool-row proposals. Chat surfaced
-- a real need to propose whole new departments too (Generative Media
-- Models & Platforms was proposed this way manually before this
-- migration existed).
alter table pp_queue add column if not exists target_type text not null default 'tool';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'chk_pp_queue_target_type'
  ) then
    alter table pp_queue add constraint chk_pp_queue_target_type
      check (target_type in ('tool', 'department'));
  end if;
end $$;

alter table pp_queue add column if not exists proposed_department_id uuid references pp_departments(id) on delete set null;

create index if not exists idx_pp_queue_target_type on pp_queue(target_type);
