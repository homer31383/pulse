-- Post-Pulse "While you were away" catch-up panel.
--
-- All per-profile state lives on the existing settings row (one row per
-- profile, already granted to service_role), so no new table and no grant.
--
-- post_pulse_last_seen: the upper bound of the last catch-up snapshot the
--   profile dismissed. Written ONLY by "Mark all as seen" (never on load,
--   leave, reload, tab close or collapse), and only ever moved forward.
--   NULL = never dismissed (the panel then shows the last 7 days).
-- post_pulse_catchup_collapsed: the panel's collapsed state, shared across
--   devices.
-- post_pulse_catchup_summary: the one cached on-demand summary,
--   {item_key, content, model, cost_usd, created_at}. Reused while the panel's
--   item set (hashed into item_key) is unchanged.
ALTER TABLE settings
  ADD COLUMN IF NOT EXISTS post_pulse_last_seen TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS post_pulse_catchup_collapsed BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS post_pulse_catchup_summary JSONB;
