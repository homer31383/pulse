-- Application-wide settings (single row, id = 'default')

CREATE TABLE IF NOT EXISTS settings (
  id               TEXT        PRIMARY KEY DEFAULT 'default',
  model            TEXT        NOT NULL DEFAULT 'claude-sonnet-4-6',
  briefing_density TEXT        NOT NULL DEFAULT 'balanced',
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Seed the single row so reads always return a result
INSERT INTO settings (id, model, briefing_density)
VALUES ('default', 'claude-sonnet-4-6', 'balanced')
ON CONFLICT (id) DO NOTHING;
