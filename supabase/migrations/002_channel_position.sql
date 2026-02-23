-- Add position column for drag-to-reorder on the home screen

ALTER TABLE channels ADD COLUMN IF NOT EXISTS position INTEGER NOT NULL DEFAULT 0;

-- Set initial positions based on created_at order so existing channels
-- get stable positions without any reordering needed.
UPDATE channels c
SET position = sub.rn
FROM (
  SELECT id, (ROW_NUMBER() OVER (ORDER BY created_at ASC)) - 1 AS rn
  FROM channels
) sub
WHERE c.id = sub.id;
