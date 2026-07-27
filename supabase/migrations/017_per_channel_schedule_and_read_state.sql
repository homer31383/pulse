-- Per-channel scheduling + read tracking.
--
-- Channel schedule config is NULLABLE: NULL inherits the profile-level
-- settings (settings.schedule_interval_days / settings.schedule_output),
-- so un-configured channels behave exactly as before this migration.
ALTER TABLE channels
  ADD COLUMN IF NOT EXISTS schedule_interval_days INTEGER,
  ADD COLUMN IF NOT EXISTS schedule_output TEXT
    CHECK (schedule_output IN ('briefing', 'digest', 'both'));

-- Read state: NULL = unread. is_read is derived (read_at IS NOT NULL).
-- Per-item is effectively per-user because briefings/digests are
-- profile-owned; no cross-profile sharing exists.
ALTER TABLE briefings ADD COLUMN IF NOT EXISTS read_at TIMESTAMPTZ;
ALTER TABLE digests   ADD COLUMN IF NOT EXISTS read_at TIMESTAMPTZ;
