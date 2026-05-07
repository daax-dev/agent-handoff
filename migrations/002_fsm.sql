-- Migration 002: FSM Engine + Review Comments

-- Add escalated status support: no schema change needed (status is TEXT)
-- This comment documents the addition of "escalated" to the status domain.

-- FSM checkpoint log: one row per state transition
CREATE TABLE IF NOT EXISTS fsm_checkpoints (
  id TEXT PRIMARY KEY,
  change_set_id TEXT NOT NULL REFERENCES change_sets(id),
  from_status TEXT NOT NULL,
  to_status TEXT NOT NULL,
  trigger TEXT NOT NULL,
  ts TEXT NOT NULL,
  metadata TEXT
);

CREATE INDEX IF NOT EXISTS idx_fsm_checkpoints_cs ON fsm_checkpoints(change_set_id, ts);

-- Review comments (minimal schema for MVP-3; expanded in PRD-010)
CREATE TABLE IF NOT EXISTS review_comments (
  id TEXT PRIMARY KEY,
  change_set_id TEXT NOT NULL REFERENCES change_sets(id),
  author_agent TEXT NOT NULL DEFAULT 'unknown',
  author_role TEXT NOT NULL DEFAULT 'reviewer',
  file_path TEXT,
  line_number INTEGER,
  body TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'advisory',
  resolved INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_review_comments_cs ON review_comments(change_set_id, resolved);
