-- Migration 007: digest history
-- Stored separately from individual channel briefings intentionally.
CREATE TABLE IF NOT EXISTS digests (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  content       TEXT        NOT NULL DEFAULT '',
  sources       JSONB       NOT NULL DEFAULT '[]',
  channel_ids   TEXT[]      NOT NULL DEFAULT '{}',
  channel_names TEXT[]      NOT NULL DEFAULT '{}',
  model         TEXT        NOT NULL DEFAULT '',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
