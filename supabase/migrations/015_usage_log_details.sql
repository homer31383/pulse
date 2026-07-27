-- Full-cost usage logging: the web-search server loop bills most of its
-- tokens as cache writes/reads, and each search request costs $10/1000.
-- These were previously invisible in usage_logs (cost_usd underreported).
ALTER TABLE usage_logs
  ADD COLUMN IF NOT EXISTS cache_creation_tokens INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cache_read_tokens     INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS web_search_count      INTEGER NOT NULL DEFAULT 0;
