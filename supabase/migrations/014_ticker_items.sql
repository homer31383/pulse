-- 014_ticker_items: Configurable ticker bar figures for the broadsheet home screen
-- Each item: { "label": "S&P 500", "value": "6,412.20", "change": "up" | "down" | "flat" }
ALTER TABLE settings
  ADD COLUMN IF NOT EXISTS ticker_items JSONB NOT NULL DEFAULT '[]';
