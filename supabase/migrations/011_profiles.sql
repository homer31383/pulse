-- Migration 011: Multi-profile support
-- Run this in your Supabase SQL editor.
-- Chris gets all existing data. Krista starts empty.

-- ── 1. Create profiles table ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS profiles (
  id   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── 2. Insert default profiles ────────────────────────────────────────────────
INSERT INTO profiles (id, name) VALUES
  ('00000000-0000-0000-0000-000000000001', 'Chris'),
  ('00000000-0000-0000-0000-000000000002', 'Krista')
ON CONFLICT (id) DO NOTHING;

-- ── 3. Add profile_id to channels ─────────────────────────────────────────────
ALTER TABLE channels ADD COLUMN IF NOT EXISTS profile_id UUID REFERENCES profiles(id) ON DELETE CASCADE;
UPDATE channels SET profile_id = '00000000-0000-0000-0000-000000000001' WHERE profile_id IS NULL;
ALTER TABLE channels ALTER COLUMN profile_id SET NOT NULL;

-- ── 4. Add profile_id to channel_groups ───────────────────────────────────────
ALTER TABLE channel_groups ADD COLUMN IF NOT EXISTS profile_id UUID REFERENCES profiles(id) ON DELETE CASCADE;
UPDATE channel_groups SET profile_id = '00000000-0000-0000-0000-000000000001' WHERE profile_id IS NULL;
ALTER TABLE channel_groups ALTER COLUMN profile_id SET NOT NULL;

-- ── 5. Migrate settings ───────────────────────────────────────────────────────
-- The settings table uses `id` as its PK (was 'default').
-- We repurpose it to hold the profile UUID as a string.
-- Update existing 'default' row → Chris's profile UUID
UPDATE settings SET id = '00000000-0000-0000-0000-000000000001' WHERE id = 'default';
-- Ensure Chris has a settings row (in case it didn't exist)
INSERT INTO settings (id) VALUES ('00000000-0000-0000-0000-000000000001')
  ON CONFLICT (id) DO NOTHING;
-- Create default settings row for Krista
INSERT INTO settings (id) VALUES ('00000000-0000-0000-0000-000000000002')
  ON CONFLICT (id) DO NOTHING;

-- ── 6. Add profile_id to digests ──────────────────────────────────────────────
ALTER TABLE digests ADD COLUMN IF NOT EXISTS profile_id UUID REFERENCES profiles(id) ON DELETE CASCADE;
UPDATE digests SET profile_id = '00000000-0000-0000-0000-000000000001' WHERE profile_id IS NULL;

-- ── 7. Add profile_id to weekly_summaries ─────────────────────────────────────
ALTER TABLE weekly_summaries ADD COLUMN IF NOT EXISTS profile_id UUID REFERENCES profiles(id) ON DELETE CASCADE;
UPDATE weekly_summaries SET profile_id = '00000000-0000-0000-0000-000000000001' WHERE profile_id IS NULL;

-- ── 8. Indexes for common queries ─────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_channels_profile_id ON channels(profile_id);
CREATE INDEX IF NOT EXISTS idx_channel_groups_profile_id ON channel_groups(profile_id);
CREATE INDEX IF NOT EXISTS idx_digests_profile_id ON digests(profile_id);
CREATE INDEX IF NOT EXISTS idx_weekly_summaries_profile_id ON weekly_summaries(profile_id);
