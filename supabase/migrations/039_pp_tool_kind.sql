-- Applied by hand in the Supabase SQL editor on Nov 25 2026 (Stage B of the non-AI entries change).
-- 039_pp_tool_kind.sql: kind, AI involvement, url and pricing on Post-Pulse entries.
alter table public.pp_tools
  add column if not exists kind text not null default 'software',
  add column if not exists ai_involvement text,
  add column if not exists url text,
  add column if not exists pricing text;

update public.pp_tools
   set ai_involvement = case tier when 'automated' then 'core' when 'assisted' then 'assisted' else 'none' end
 where ai_involvement is null;

alter table public.pp_tools alter column ai_involvement set not null;
alter table public.pp_tools alter column tier drop not null;

alter table public.pp_tools
  add constraint pp_tools_kind_check check (kind in ('software', 'asset_library', 'learning_resource', 'reference')),
  add constraint pp_tools_ai_involvement_check check (ai_involvement in ('none', 'assisted', 'core')),
  add constraint pp_tools_tier_required_for_software check (kind <> 'software' or tier is not null);

-- A row inserted without ai_involvement (an older pending proposal) gets it from its tier.
create or replace function public.pp_tools_fill_ai_involvement()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.ai_involvement is null then
    new.ai_involvement := case new.tier when 'automated' then 'core' when 'assisted' then 'assisted' else 'none' end;
  end if;
  return new;
end $$;
revoke all on function public.pp_tools_fill_ai_involvement() from public, anon, authenticated;

create or replace trigger trg_pp_tools_fill_ai_involvement
  before insert on public.pp_tools
  for each row execute function public.pp_tools_fill_ai_involvement();

-- "Star on add" in research chat, per profile (settings is already granted).
alter table public.settings add column if not exists post_pulse_star_on_add boolean not null default false;

-- Checks: the first should return no rows; the second should return 131 / 10 / 0.
--   select grantee from information_schema.role_table_grants
--    where table_schema = 'public' and table_name = 'pp_tools' and grantee in ('anon', 'authenticated');
--   select count(*), count(*) filter (where ai_involvement = 'none'), count(*) filter (where tier is null) from public.pp_tools;
