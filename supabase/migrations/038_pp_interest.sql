-- 038_pp_interest: per-profile "very interested" stars on Post-Pulse items.
-- pp_* data is shared; this is the per-profile layer. No row = unmarked.
-- Polymorphic target (no FK); the server routes validate that the target
-- exists (pp_tools / pp_departments / pending pp_queue row). Stars on queue
-- items carry over to the resulting tool or department on accept; after a
-- dismiss they are kept through the 60 s undo window and then deleted lazily
-- when stars are listed. That logic lives in the app (lib/post-pulse-interest.ts),
-- not in triggers.
-- Applied by hand on Nov 9 2026 (grants check: no anon/authenticated rows,
-- one service_role INSERT row).
create table if not exists public.pp_interest (
  id          uuid        primary key default gen_random_uuid(),
  profile_id  uuid        not null references public.profiles(id) on delete cascade,
  target_type text        not null check (target_type in ('tool', 'department', 'queue_item')),
  target_id   uuid        not null,
  level       text        not null default 'starred' check (level in ('starred')),
  created_at  timestamptz not null default now(),
  unique (profile_id, target_type, target_id)
);

-- Carry-over and cleanup look stars up by target across profiles.
create index if not exists pp_interest_target_idx on public.pp_interest (target_type, target_id);

alter table public.pp_interest enable row level security;   -- no policies: only service_role gets through
revoke all on public.pp_interest from anon, authenticated;
grant select, insert, update, delete on public.pp_interest to service_role;

-- Collapsed state of the landing page's "Your starred" section (settings is already granted).
alter table public.settings
  add column if not exists post_pulse_starred_collapsed boolean not null default false;

-- Checks (expect no rows from the first, one row from the second):
--   select grantee, privilege_type from information_schema.role_table_grants
--   where table_schema = 'public' and table_name = 'pp_interest' and grantee in ('anon','authenticated');
--   select privilege_type from information_schema.role_table_grants
--   where table_schema = 'public' and table_name = 'pp_interest' and grantee = 'service_role' and privilege_type = 'INSERT';
