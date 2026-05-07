import type { Database } from "bun:sqlite";
import { getSession, markBusy, markWaiting, heartbeat } from "../domain/agent-session.js";
import { HandoffContextBuilder } from "../context/handoff-context.js";
import { AgentRoleRegistry } from "../roles/registry.js";
import { mcpText, mcpError } from "./response.js";

interface ClaimTaskInput {
  sessionId: string;
  repoRoot?: string;
}

interface QueuedRow {
  queued_change_set_id: string | null;
  queued_role: string | null;
}

export async function handleClaimTask(args: ClaimTaskInput, db: Database) {
  try {
    const session = getSession(db, args.sessionId);
    if (!session) {
      return mcpError({ error: `Session ${args.sessionId} not found. Register first via POST /api/agent-sessions.` });
    }

    // Refresh heartbeat on every poll
    heartbeat(db, args.sessionId);

    const row = db
      .query<QueuedRow, [string]>(
        "SELECT queued_change_set_id, queued_role FROM agent_sessions WHERE id = ?"
      )
      .get(args.sessionId);

    if (!row?.queued_change_set_id || !row?.queued_role) {
      return mcpText({ claimed: false, message: "No task queued. Poll again in a few seconds." });
    }

    const { queued_change_set_id: changeSetId, queued_role: role } = row;

    // Claim it: mark busy and clear the queue columns
    markBusy(db, args.sessionId, changeSetId);
    db.run(
      "UPDATE agent_sessions SET queued_change_set_id = NULL, queued_role = NULL WHERE id = ?",
      [args.sessionId]
    );

    // Build handoff context
    let context: unknown = null;
    try {
      const registry = new AgentRoleRegistry(args.repoRoot ?? process.cwd());
      const builder = new HandoffContextBuilder(db, args.repoRoot ?? process.cwd(), registry);
      context = await builder.build(changeSetId, role);
    } catch (e) {
      context = { error: `Context build failed: ${e instanceof Error ? e.message : String(e)}` };
    }

    return mcpText({ claimed: true, changeSetId, role, context });
  } catch (e) {
    return mcpError({ error: e instanceof Error ? e.message : String(e) });
  }
}

interface CompleteTaskInput {
  sessionId: string;
}

export function handleCompleteTask(args: CompleteTaskInput, db: Database) {
  try {
    const session = getSession(db, args.sessionId);
    if (!session) {
      return mcpError({ error: `Session ${args.sessionId} not found.` });
    }
    markWaiting(db, args.sessionId);
    return mcpText({ ok: true, message: "Session marked waiting — ready for next task." });
  } catch (e) {
    return mcpError({ error: e instanceof Error ? e.message : String(e) });
  }
}
