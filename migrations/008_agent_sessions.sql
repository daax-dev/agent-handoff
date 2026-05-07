-- Migration 008: Agent Sessions (PRD-020)

CREATE TABLE IF NOT EXISTS agent_sessions (
  id TEXT PRIMARY KEY,
  tool TEXT NOT NULL,
  roles TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting','busy','done','disconnected')),
  connected_at TEXT NOT NULL,
  last_heartbeat TEXT NOT NULL,
  current_change_set_id TEXT REFERENCES change_sets(id)
);

CREATE INDEX IF NOT EXISTS idx_agent_sessions_status ON agent_sessions(status, last_heartbeat);
