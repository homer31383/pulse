-- 004_features: Feature flag columns on settings + supporting tables

-- ── Settings: add feature flag columns ───────────────────────────────────────
ALTER TABLE settings
  ADD COLUMN IF NOT EXISTS digest_mode           BOOLEAN   NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS highlights_enabled    BOOLEAN   NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS sharing_enabled       BOOLEAN   NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS feedback_enabled      BOOLEAN   NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS cross_channel_enabled BOOLEAN   NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS watchlist_enabled     BOOLEAN   NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS watchlist_terms       TEXT[]    NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS email_enabled         BOOLEAN   NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS email_address         TEXT,
  ADD COLUMN IF NOT EXISTS notifications_enabled BOOLEAN   NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS notification_time     TEXT      NOT NULL DEFAULT '08:00',
  ADD COLUMN IF NOT EXISTS discuss_enabled       BOOLEAN   NOT NULL DEFAULT false;

-- ── Saved highlights / notes ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS notes (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  briefing_id  UUID        REFERENCES briefings(id) ON DELETE SET NULL,
  channel_name TEXT,
  content      TEXT        NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Briefing feedback ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS briefing_feedback (
  id          UUID      PRIMARY KEY DEFAULT gen_random_uuid(),
  briefing_id UUID      NOT NULL REFERENCES briefings(id) ON DELETE CASCADE,
  vote        SMALLINT  NOT NULL CHECK (vote IN (-1, 1)),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Shareable briefing links ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS shared_briefings (
  id          UUID      PRIMARY KEY DEFAULT gen_random_uuid(),
  briefing_id UUID      NOT NULL REFERENCES briefings(id) ON DELETE CASCADE,
  slug        TEXT      NOT NULL UNIQUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
