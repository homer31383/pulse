-- Post Pulse: persist a research pass's "check these next" recommendations
-- A pass that runs out of budget usually knows exactly where it should
-- have looked (vp-land.com/tools, fxguide, a vendor's release notes). Until
-- now that advice was prose in the briefing and lost after reading. Each
-- research pass now writes its recommendations here, and the next pass for
-- the department — cron, manual trigger, or chat — starts from them.
-- Shape: [{"source": "https://…" | "Vendor release notes", "added_at": iso}]
-- Additive, idempotent. The code degrades gracefully until this is applied
-- (it warns and skips the write).

alter table pp_departments add column if not exists follow_up_sources jsonb not null default '[]'::jsonb;
