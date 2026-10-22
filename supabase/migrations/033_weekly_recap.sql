-- Weekly Recap Email.
--
-- A once-a-week email that COMPILES whatever briefings/digests were created
-- in the previous 7 days (scheduled or on demand) into two sections,
-- "Pulse" and "Post-Pulse". It never triggers generation.

-- Which recap section a channel's content is filed under.
ALTER TABLE channels
  ADD COLUMN IF NOT EXISTS recap_group TEXT NOT NULL DEFAULT 'pulse'
    CHECK (recap_group IN ('pulse', 'post_pulse'));

-- The post-production channels: the four core software channels plus the
-- professional post-production news channel.
UPDATE channels
SET recap_group = 'post_pulse'
WHERE lower(name) IN (
  'the foundry nuke',
  'sidefx houdini',
  'autodesk maya',
  'ai in cg pipelines',
  'post-production tech'
);

-- Per-profile recap schedule. recap_day: 0 = Sunday … 6 = Saturday (ET).
-- recap_time: 'HH:MM' Eastern Time; the hourly cron matches on the hour.
-- recap_last_run_at dedupes the hourly cron (stamped whether or not an
-- email was sent, so an empty week is checked once, not every hour).
ALTER TABLE settings
  ADD COLUMN IF NOT EXISTS recap_email_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS recap_day SMALLINT NOT NULL DEFAULT 0
    CHECK (recap_day BETWEEN 0 AND 6),
  ADD COLUMN IF NOT EXISTS recap_time TEXT NOT NULL DEFAULT '07:00',
  ADD COLUMN IF NOT EXISTS recap_last_run_at TIMESTAMPTZ;
