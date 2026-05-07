-- Migration 007: Agent Assignments (PRD-020)

CREATE TABLE IF NOT EXISTS agent_assignments (
  id TEXT PRIMARY KEY,
  fsm_state TEXT NOT NULL,
  role TEXT NOT NULL,
  tool TEXT NOT NULL CHECK (tool IN ('claude-code','codex','copilot-cli','gemini','aider','human')),
  enabled INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL,
  UNIQUE(fsm_state, role)
);

-- Default assignments: claude-code handles everything
INSERT OR IGNORE INTO agent_assignments (id, fsm_state, role, tool, enabled, updated_at) VALUES
  ('aa_implementing_implementer',   'implementing',     'implementer',      'claude-code', 1, datetime('now')),
  ('aa_reviewing_reviewer',         'reviewing',        'reviewer',         'claude-code', 1, datetime('now')),
  ('aa_reviewing_security',         'reviewing',        'security_reviewer','claude-code', 1, datetime('now')),
  ('aa_planned_planner',            'planned',          'planner',          'claude-code', 1, datetime('now')),
  ('aa_changes_fixer',              'changes_requested','fixer',            'claude-code', 1, datetime('now')),
  ('aa_merged_summarizer',          'merged',           'summarizer',       'claude-code', 1, datetime('now'));
