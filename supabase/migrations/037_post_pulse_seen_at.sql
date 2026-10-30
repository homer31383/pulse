-- Per-item "Mark as seen" for the Post-Pulse "While you were away" panel.
--
-- NULL = not dismissed. Set by POST /api/post-pulse/catchup/item-seen when the
-- reader taps a row's "Seen" button, cleared by its Undo. The panel hides an
-- item once this is set, independently of settings.post_pulse_last_seen
-- ("Mark all as seen") and of read_at (reading/listening), which it never
-- touches. A digest has one flag, covering every channel story it was split
-- into.
--
-- New columns on existing tables that are already granted to service_role.
-- Table-level privileges cover columns added later, so no grant change is
-- needed. anon and authenticated get nothing new; if
-- supabase/revoke_anon_grants.sql has been applied they have no access to
-- these tables at all. To confirm:
--   select distinct table_name from information_schema.role_table_grants
--   where table_schema = 'public' and grantee in ('anon', 'authenticated')
--     and table_name in ('briefings', 'digests');
--   (expect no rows)
ALTER TABLE briefings ADD COLUMN IF NOT EXISTS post_pulse_seen_at TIMESTAMPTZ;
ALTER TABLE digests   ADD COLUMN IF NOT EXISTS post_pulse_seen_at TIMESTAMPTZ;
