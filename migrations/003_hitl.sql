-- Migration 003: HITL Gate System (PRD-006)

CREATE TABLE IF NOT EXISTS hitl_approvals (
  id TEXT PRIMARY KEY,
  change_set_id TEXT NOT NULL REFERENCES change_sets(id),
  trigger TEXT NOT NULL,
  original_status TEXT NOT NULL,
  requested_at TEXT NOT NULL,
  decided_at TEXT,
  decision TEXT CHECK (decision IN ('approved', 'rejected')),
  decided_by TEXT,
  reason TEXT
);

CREATE INDEX IF NOT EXISTS idx_hitl_approvals_cs ON hitl_approvals(change_set_id, decided_at);
