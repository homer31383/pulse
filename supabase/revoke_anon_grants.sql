-- Revoke anon and authenticated access from every existing Pulse table.
-- Run by hand in the Supabase SQL editor. Not a numbered migration.
--
-- Pulse reaches Supabase only through the service role key on the server (lib/supabase.ts),
-- and RLS is disabled on all of these tables, so the default anon and authenticated grants
-- let anyone holding the project's anon key read and write them. service_role keeps full
-- access (re-granted below so the script is safe to run on its own).
--
-- Tables missing from the database (for example, never migrated) are skipped with a notice.
-- Safe to run more than once.

begin;

do $$
declare
  t text;
begin
  foreach t in array array[
    'channels',
    'briefings',
    'config_conversations',
    'settings',
    'notes',
    'briefing_feedback',
    'shared_briefings',
    'usage_logs',
    'digests',
    'weekly_summaries',
    'channel_groups',
    'profiles',
    'pinned_insights',
    'tts_audio',
    'listen_queue',
    'pp_departments',
    'pp_tools',
    'pp_changelog',
    'pp_queue',
    'pp_chat_sessions',
    'pp_frontier_scans',
    'pp_department_research_runs',
    'pp_workflow_docs'
  ]
  loop
    if to_regclass(format('public.%I', t)) is null then
      raise notice 'skipped %, table not found', t;
      continue;
    end if;
    execute format('revoke all privileges on public.%I from anon, authenticated', t);
    execute format('grant select, insert, update, delete on public.%I to service_role', t);
  end loop;
end $$;

commit;

-- Verify: should return no rows for the tables above.
-- select table_name, grantee, privilege_type from information_schema.role_table_grants
-- where table_schema = 'public' and grantee in ('anon', 'authenticated') order by 1, 2, 3;
