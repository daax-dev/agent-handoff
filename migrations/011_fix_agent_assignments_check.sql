-- Migration 011: Add 'cursor' to agent_assignments CHECK constraint
-- SQLite does not support ALTER COLUMN, so recreate the table.

CREATE TABLE agent_assignments_new (
  id TEXT PRIMARY KEY,
  fsm_state TEXT NOT NULL,
  role TEXT NOT NULL,
  tool TEXT NOT NULL CHECK (tool IN ('claude-code','codex','cursor','copilot-cli','gemini','aider','human')),
  enabled INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL,
  UNIQUE(fsm_state, role)
);

INSERT INTO agent_assignments_new SELECT * FROM agent_assignments;
DROP TABLE agent_assignments;
ALTER TABLE agent_assignments_new RENAME TO agent_assignments;
