-- Run this in the Supabase SQL editor (or via supabase db push)

-- ─── Channels ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS channels (
  id              UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  name            TEXT        NOT NULL,
  description     TEXT,
  instructions    TEXT        NOT NULL DEFAULT '',
  search_queries  JSONB       NOT NULL DEFAULT '[]'::jsonb,
  last_briefed_at TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── Briefings ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS briefings (
  id          UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  channel_id  UUID        NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  content     TEXT        NOT NULL,
  sources     JSONB       NOT NULL DEFAULT '[]'::jsonb,
  model       TEXT        NOT NULL DEFAULT 'claude-sonnet-4-6',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── Config conversations ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS config_conversations (
  id                    UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  channel_id            UUID        NOT NULL REFERENCES channels(id) ON DELETE CASCADE UNIQUE,
  messages              JSONB       NOT NULL DEFAULT '[]'::jsonb,
  saved_instructions_at TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── Indexes ─────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS briefings_channel_id_idx  ON briefings(channel_id);
CREATE INDEX IF NOT EXISTS briefings_created_at_idx  ON briefings(created_at DESC);
CREATE INDEX IF NOT EXISTS config_channel_id_idx     ON config_conversations(channel_id);

-- ─── updated_at trigger ──────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER update_channels_updated_at
  BEFORE UPDATE ON channels
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE OR REPLACE TRIGGER update_config_conversations_updated_at
  BEFORE UPDATE ON config_conversations
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
