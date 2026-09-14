-- Post Pulse: research recency tracking
-- Stamped by any research run (scheduled sweep, global manual trigger,
-- or per-department manual trigger). Not used for cadence logic yet —
-- cadence stays uniform for now per spec §5 — but surfaced on the
-- department doc and gives future cadence work real data to start from.

alter table pp_departments add column if not exists last_researched_at timestamptz;
