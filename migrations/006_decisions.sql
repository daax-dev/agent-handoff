-- Migration 006: Per-task decision log (PRD-012)

CREATE TABLE IF NOT EXISTS decisions (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  change_set_id TEXT NOT NULL,
  topic TEXT NOT NULL,
  options_considered TEXT NOT NULL,  -- JSON array
  choice TEXT NOT NULL,
  rationale TEXT NOT NULL,
  sources_cited TEXT,                -- JSON array of strings
  author_agent TEXT,                 -- null if human
  ts TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_decisions_task ON decisions(task_id, ts);
CREATE INDEX IF NOT EXISTS idx_decisions_cs   ON decisions(change_set_id, ts);

INSERT OR IGNORE INTO sequences (name, value) VALUES ('decisions', 0);
