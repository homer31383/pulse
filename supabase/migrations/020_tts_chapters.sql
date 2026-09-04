-- Spoken-script versioning + chapter markers for cached premium audio.
--
-- The TTS input is now a "speech script" (lib/speechScript.ts) with verbal
-- signposts and chapter markers. Cache rows record which script version
-- produced them; the lookup requires the current version, so audio generated
-- from the older plain text is regenerated the next time it is played
-- (same storage path — the object is overwritten, nothing accumulates).
ALTER TABLE tts_audio
  ADD COLUMN IF NOT EXISTS script_version INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS chapters JSONB NOT NULL DEFAULT '[]'::jsonb;  -- [{label, sentenceIndex}]
