import type { Database } from "bun:sqlite";

export const SUPPORTED_TOOLS = ["claude-code", "codex", "cursor", "copilot-cli", "gemini", "human"] as const;
export type AgentTool = (typeof SUPPORTED_TOOLS)[number];

export const TOOL_LABELS: Record<AgentTool, string> = {
  "claude-code":  "Claude Code",
  "codex":        "Codex",
  "cursor":       "Cursor",
  "copilot-cli":  "Copilot CLI",
  "gemini":       "Gemini",
  "human":        "Human (HITL)",
};

export interface AgentAssignment {
  id: string;
  fsm_state: string;
  role: string;
  tool: AgentTool;
  enabled: boolean;
  updated_at: string;
  model: string | null;
  prompt_override: string | null;
  mcps: string[] | null;
  auto_launch: boolean;
  skills: string[] | null;
}

interface RawRow {
  id: string;
  fsm_state: string;
  role: string;
  tool: string;
  enabled: number;
  updated_at: string;
  model: string | null;
  prompt_override: string | null;
  mcps: string | null;
  auto_launch: number;
  skills: string | null;
}

function parseStringArray(raw: string | null): string[] | null {
  if (raw === null) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.every((x) => typeof x === "string")) {
      return parsed as string[];
    }
  } catch {
    // malformed JSON — treat as null
  }
  return null;
}

function toAssignment(row: RawRow): AgentAssignment {
  return {
    ...row,
    tool: row.tool as AgentTool,
    enabled: row.enabled === 1,
    auto_launch: row.auto_launch === 1,
    mcps: parseStringArray(row.mcps),
    skills: parseStringArray(row.skills),
  };
}

export function listAssignments(db: Database): AgentAssignment[] {
  return db
    .query<RawRow, []>("SELECT * FROM agent_assignments ORDER BY fsm_state, role")
    .all()
    .map(toAssignment);
}

export function listAssignmentsByStates(db: Database, states: string[]): AgentAssignment[] {
  if (states.length === 0) return [];
  const placeholders = states.map(() => "?").join(", ");
  return db
    .query<RawRow, string[]>(
      `SELECT * FROM agent_assignments WHERE fsm_state IN (${placeholders}) ORDER BY fsm_state, role`
    )
    .all(...states)
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

export interface UpsertParams {
  fsmState: string;
  role: string;
  tool: AgentTool;
  enabled?: boolean;
  model?: string | null;
  prompt_override?: string | null;
  mcps?: string[] | null;
  auto_launch?: boolean;
  skills?: string[] | null;
}

export function deleteAssignment(db: Database, fsmState: string, role: string): boolean {
  const result = db.run("DELETE FROM agent_assignments WHERE fsm_state = ? AND role = ?", [fsmState, role]);
  return result.changes > 0;
}

export function upsertAssignment(db: Database, params: UpsertParams): AgentAssignment {
  const { fsmState, role, tool, enabled = true, model = null, prompt_override = null, mcps, auto_launch = false, skills } = params;
  const now = new Date().toISOString();
  const id = `aa_${fsmState}_${role}`.replace(/[^a-z0-9_]/g, "_");
  // Preserve null vs [] distinction: null = "use defaults", [] = "explicitly none"
  const mcpsJson = mcps === undefined || mcps === null ? null : JSON.stringify(mcps);
  const skillsJson = skills === undefined || skills === null ? null : JSON.stringify(skills);
  db.run(
    `INSERT INTO agent_assignments (id, fsm_state, role, tool, enabled, updated_at, model, prompt_override, mcps, auto_launch, skills)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(fsm_state, role) DO UPDATE SET
       tool = excluded.tool,
       enabled = excluded.enabled,
       updated_at = excluded.updated_at,
       model = excluded.model,
       prompt_override = excluded.prompt_override,
       mcps = excluded.mcps,
       auto_launch = excluded.auto_launch,
       skills = excluded.skills`,
    [id, fsmState, role, tool, enabled ? 1 : 0, now, model, prompt_override, mcpsJson, auto_launch ? 1 : 0, skillsJson]
  );
  return getAssignment(db, fsmState, role)!;
}
