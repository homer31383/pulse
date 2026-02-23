-- Migration 008: Weekly summaries table
CREATE TABLE IF NOT EXISTS weekly_summaries (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  content       TEXT        NOT NULL DEFAULT '',
  channel_names TEXT[]      NOT NULL DEFAULT '{}',
  model         TEXT        NOT NULL DEFAULT '',
  week_start    DATE        NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
