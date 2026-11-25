-- Applied by hand in the Supabase SQL editor on Nov 25 2026 (Ads Worth Watching channel).
-- 040_channel_max_searches.sql: optional per-channel web search cap (null = default 6).
alter table public.channels
  add column if not exists max_searches integer
  check (max_searches is null or max_searches between 1 and 20);
