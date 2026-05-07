-- Add task queuing columns to agent_sessions so the orchestrator can
-- dispatch work to a pre-spawned agent without a separate table.
ALTER TABLE agent_sessions ADD COLUMN queued_change_set_id TEXT;
ALTER TABLE agent_sessions ADD COLUMN queued_role TEXT;
