-- 013_briefing_schedule: Scheduled (pre-generated) briefings via Vercel Cron

-- Per-profile schedule preferences
ALTER TABLE settings
  ADD COLUMN IF NOT EXISTS schedule_enabled     BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS schedule_time        TEXT    NOT NULL DEFAULT '06:00',
  ADD COLUMN IF NOT EXISTS schedule_channel_ids TEXT[]  NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS schedule_output      TEXT    NOT NULL DEFAULT 'briefings'
    CHECK (schedule_output IN ('briefings', 'digest', 'both'));

-- Mark pre-generated content so the app can surface it on open
ALTER TABLE briefings ADD COLUMN IF NOT EXISTS scheduled BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE digests   ADD COLUMN IF NOT EXISTS scheduled BOOLEAN NOT NULL DEFAULT false;
