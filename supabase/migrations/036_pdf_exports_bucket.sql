-- Export channel as PDF: private Storage bucket for generated PDFs.
--
-- Objects are written and signed only by the server with the service role
-- key (lib/channel-export.ts), at <profile id>/<channel id>/<hash>.pdf, and
-- downloaded through a signed URL that expires after 5 minutes.
--
-- Private bucket, and deliberately NO policies on storage.objects for it:
-- with RLS on storage.objects (Supabase's default), anon and authenticated
-- can't list, read, write or delete anything here. The service role
-- bypasses RLS. No table is created, so there is no grant to add.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('pdf-exports', 'pdf-exports', false, 52428800, array['application/pdf'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Checks (run after; both should hold):
-- 1. The bucket is private:
--      select id, public, file_size_limit, allowed_mime_types from storage.buckets where id = 'pdf-exports';
-- 2. No policy on storage.objects lets anon/authenticated in. Any row here
--    that is not scoped to another bucket_id would also apply to this one:
--      select policyname, roles, cmd, qual, with_check from pg_policies
--      where schemaname = 'storage' and tablename = 'objects';
