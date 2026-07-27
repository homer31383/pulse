-- Scheduled briefings: run every N days instead of always daily.
-- 1 = daily, 2-4 = every N days, 7 = weekly, 14 = bi-weekly.
-- The cron sweep anchors the interval to the most recent scheduled
-- briefing/digest for the profile (ET calendar-day difference).
ALTER TABLE settings
  ADD COLUMN IF NOT EXISTS schedule_interval_days INTEGER NOT NULL DEFAULT 1;
