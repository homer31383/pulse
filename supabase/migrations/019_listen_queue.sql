-- Listen Queue: an ordered, per-profile playlist of briefings/digests for
-- sequential audio playback. Independent of read state and of history —
-- an item leaves the queue only when it completes, is removed, or its
-- briefing/digest is deleted (handled in code; rows are polymorphic, no FK).
--
-- Resume state lives on the row: standard (browser) voice resumes by
-- sentence index, premium audio by seconds. "Where I left off" is derived:
-- the unplayed row with the newest last_played_at, else the lowest position.
CREATE TABLE IF NOT EXISTS listen_queue (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id        UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  kind              TEXT NOT NULL CHECK (kind IN ('briefing', 'digest')),
  item_id           UUID NOT NULL,
  position          INTEGER NOT NULL DEFAULT 0,
  source            TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('scheduled', 'live', 'manual')),
  added_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  played_at         TIMESTAMPTZ,                      -- NULL = unplayed
  progress_sentence INTEGER NOT NULL DEFAULT 0,
  progress_seconds  NUMERIC NOT NULL DEFAULT 0,
  last_played_at    TIMESTAMPTZ,
  UNIQUE (profile_id, kind, item_id)
);

CREATE INDEX IF NOT EXISTS listen_queue_profile_idx ON listen_queue (profile_id, played_at, position);
CREATE INDEX IF NOT EXISTS listen_queue_item_idx ON listen_queue (kind, item_id);
