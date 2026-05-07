import type { Database } from "bun:sqlite";
import { findWaitingSession } from "../domain/agent-session.js";
import type { AgentTool } from "../domain/agent-assignment.js";

export interface DispatchResult {
  dispatched: true;
  sessionId: string;
}

export interface DispatchMiss {
  dispatched: false;
}

export type DispatchOutcome = DispatchResult | DispatchMiss;

export function dispatchToSession(
  db: Database,
  tool: AgentTool,
  role: string,
  changeSetId: string
): DispatchOutcome {
  const session = findWaitingSession(db, tool, role);
  if (!session) return { dispatched: false };

  db.run(
    "UPDATE agent_sessions SET queued_change_set_id = ?, queued_role = ? WHERE id = ?",
    [changeSetId, role, session.id]
  );

  return { dispatched: true, sessionId: session.id };
}
