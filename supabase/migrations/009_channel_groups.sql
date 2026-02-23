-- Migration 009: Channel groups
CREATE TABLE IF NOT EXISTS channel_groups (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name       TEXT        NOT NULL,
  position   INTEGER     NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE channels
  ADD COLUMN IF NOT EXISTS group_id UUID REFERENCES channel_groups(id) ON DELETE SET NULL;
