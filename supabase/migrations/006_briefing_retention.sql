-- Migration 006: add briefing_retention_days to settings
ALTER TABLE settings
  ADD COLUMN IF NOT EXISTS briefing_retention_days integer NULL;
