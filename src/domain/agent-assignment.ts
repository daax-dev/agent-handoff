import type { Database } from "bun:sqlite";

export const SUPPORTED_TOOLS = ["claude-code", "codex", "cursor", "copilot-cli", "gemini", "aider", "human"] as const;
export type AgentTool = (typeof SUPPORTED_TOOLS)[number];

export const TOOL_LABELS: Record<AgentTool, string> = {
  "claude-code":  "Claude Code",
  "codex":        "Codex",
  "cursor":       "Cursor",
  "copilot-cli":  "Copilot CLI",
  "gemini":       "Gemini",
  "aider":        "Aider",
  "human":        "Human (HITL)",
};

export interface AgentAssignment {
  id: string;
  fsm_state: string;
  role: string;
  tool: AgentTool;
  enabled: boolean;
  updated_at: string;
}

interface RawRow {
  id: string;
  fsm_state: string;
  role: string;
  tool: string;
  enabled: number;
  updated_at: string;
}

function toAssignment(row: RawRow): AgentAssignment {
  return { ...row, tool: row.tool as AgentTool, enabled: row.enabled === 1 };
}

export function listAssignments(db: Database): AgentAssignment[] {
  return db
    .query<RawRow, []>("SELECT * FROM agent_assignments ORDER BY fsm_state, role")
    .all()
    .map(toAssignment);
}

export function getAssignment(db: Database, fsmState: string, role: string): AgentAssignment | null {
  const row = db
    .query<RawRow, [string, string]>(
      "SELECT * FROM agent_assignments WHERE fsm_state = ? AND role = ?"
    )
    .get(fsmState, role);
  return row ? toAssignment(row) : null;
}

export function upsertAssignment(
  db: Database,
  fsmState: string,
  role: string,
  tool: AgentTool,
  enabled = true
): AgentAssignment {
  const now = new Date().toISOString();
  const id = `aa_${fsmState}_${role}`.replace(/[^a-z0-9_]/g, "_");
  db.run(
    `INSERT INTO agent_assignments (id, fsm_state, role, tool, enabled, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(fsm_state, role) DO UPDATE SET tool = excluded.tool, enabled = excluded.enabled, updated_at = excluded.updated_at`,
    [id, fsmState, role, tool, enabled ? 1 : 0, now]
  );
  return getAssignment(db, fsmState, role)!;
}
