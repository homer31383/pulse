-- Axiom task for new scheduled content.
--
-- After a scheduled cron run saves briefings/digests (and they join the listen
-- queue), Pulse sends one task to Axiom's POST /api/inbound/pulse-task
-- ("Pulse: <channels> ready to read"). This per-profile switch turns that off.
-- Default on. Manual and live generations never send a task.
--
-- A new column on the existing settings row (one row per profile, already
-- granted to service_role), so no new table and no new grant. anon and
-- authenticated get nothing.
ALTER TABLE settings
  ADD COLUMN IF NOT EXISTS axiom_task_enabled BOOLEAN NOT NULL DEFAULT TRUE;
