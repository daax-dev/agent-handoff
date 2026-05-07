import type { Database } from "bun:sqlite";
import { FSMEngine } from "../fsm/engine.js";
import { InvalidTransitionError } from "../fsm/errors.js";

interface Input { changeSetId: string; summary: string }

function mcpText(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
}
function mcpError(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }], isError: true };
}

export async function handleApproveChangeSet(args: Input, db: Database) {
  // MVP-3: no HITL gate yet (PRD-006 is MVP-6).
  // HITL_ENABLED=true will be wired up in MVP-6.
  const fsm = new FSMEngine(db);
  try {
    const newStatus = fsm.transition(args.changeSetId, "approve", {
      metadata: { summary: args.summary },
    });
    return mcpText({ changeSetId: args.changeSetId, status: newStatus });
  } catch (e) {
    if (e instanceof InvalidTransitionError) {
      return mcpError({ error: e.message, changeSetId: args.changeSetId });
    }
    return mcpError({ error: e instanceof Error ? e.message : String(e) });
  }
}
