-- Migration 012: Extend agent_assignments with model, prompt_override, mcps, auto_launch

ALTER TABLE agent_assignments ADD COLUMN model            TEXT;
ALTER TABLE agent_assignments ADD COLUMN prompt_override  TEXT;
ALTER TABLE agent_assignments ADD COLUMN mcps             TEXT;        -- JSON array of MCP server names (NULL = defaults)
ALTER TABLE agent_assignments ADD COLUMN auto_launch      INTEGER NOT NULL DEFAULT 0;
