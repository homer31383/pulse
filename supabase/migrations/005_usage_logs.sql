-- 005_usage_logs: Track token usage and cost per API call

CREATE TABLE IF NOT EXISTS usage_logs (
  id            UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  call_type     TEXT          NOT NULL, -- 'briefing' | 'digest' | 'cross_channel' | 'discuss' | 'config_chat' | 'synthesize'
  channel_id    UUID          REFERENCES channels(id) ON DELETE SET NULL,
  channel_name  TEXT,
  model         TEXT          NOT NULL,
  input_tokens  INT           NOT NULL,
  output_tokens INT           NOT NULL,
  cost_usd      NUMERIC(12,8) NOT NULL,
  created_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS usage_logs_created_at  ON usage_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS usage_logs_channel_id  ON usage_logs (channel_id);
