-- Premium TTS (ElevenLabs) alongside the free browser Web Speech engine.
--
-- Provider + ElevenLabs voice live on settings (per profile). tts_voice keeps
-- holding the browser voice URI so switching providers never loses either
-- choice.
ALTER TABLE settings
  ADD COLUMN IF NOT EXISTS tts_provider TEXT NOT NULL DEFAULT 'browser'
    CHECK (tts_provider IN ('browser', 'elevenlabs')),
  ADD COLUMN IF NOT EXISTS tts_elevenlabs_voice_id TEXT;

-- Generated audio cache: one object per (item, voice, model). Re-listening
-- never re-charges. Rows are polymorphic over briefings/digests (no FK);
-- the delete routes and retention cleanup remove audio explicitly, since
-- Storage has no cascade.
CREATE TABLE IF NOT EXISTS tts_audio (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kind             TEXT NOT NULL CHECK (kind IN ('briefing', 'digest')),
  item_id          UUID NOT NULL,
  voice_id         TEXT NOT NULL,
  model_id         TEXT NOT NULL,
  storage_path     TEXT NOT NULL,          -- object key in the 'tts-audio' bucket
  char_count       INTEGER NOT NULL,
  chunk_count      INTEGER NOT NULL DEFAULT 1,
  duration_seconds NUMERIC,
  cost_usd         NUMERIC NOT NULL DEFAULT 0,
  -- Sentence-level highlighting data: the exact sentences the audio was
  -- generated from and the audio time (seconds) each one starts at.
  sentences        JSONB NOT NULL DEFAULT '[]'::jsonb,
  sentence_times   JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (kind, item_id, voice_id, model_id)
);

CREATE INDEX IF NOT EXISTS tts_audio_item_idx ON tts_audio (kind, item_id);

-- TTS spend is logged to usage_logs with call_type = 'tts',
-- model = 'elevenlabs/<model_id>', input_tokens = characters billed,
-- output_tokens = 0, so it lands in the same dashboard totals.
