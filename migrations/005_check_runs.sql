-- Migration 005: Check runs table (PRD-011)

CREATE TABLE IF NOT EXISTS check_runs (
  id TEXT PRIMARY KEY,
  change_set_id TEXT NOT NULL REFERENCES change_sets(id),
  name TEXT NOT NULL CHECK(name IN ('typecheck','lint','test','security','custom')),
  status TEXT NOT NULL CHECK(status IN ('pending','running','passed','failed','skipped')),
  output TEXT,
  exit_code INTEGER,
  started_at TEXT NOT NULL,
  completed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_check_runs_cs ON check_runs(change_set_id);

INSERT OR IGNORE INTO sequences (name, value) VALUES ('check_runs', 0);
