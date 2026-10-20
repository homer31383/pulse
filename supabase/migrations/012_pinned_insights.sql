-- 012_pinned_insights: Pin a section of a briefing or digest to a reference shelf
CREATE TABLE IF NOT EXISTS pinned_insights (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  content      TEXT        NOT NULL,
  channel_name TEXT,
  source_date  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  profile_id   UUID        REFERENCES profiles(id) ON DELETE CASCADE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
grant select, insert, update, delete on public.pinned_insights to service_role;

CREATE INDEX IF NOT EXISTS idx_pinned_insights_profile ON pinned_insights (profile_id, created_at DESC);
