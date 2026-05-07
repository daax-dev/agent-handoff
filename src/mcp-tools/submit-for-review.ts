import type { Database } from "bun:sqlite";
import { FSMEngine } from "../fsm/engine.js";
import { InvalidTransitionError } from "../fsm/errors.js";

interface Input { changeSetId: string }

function mcpText(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
}
function mcpError(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }], isError: true };
}

export async function handleSubmitForReview(args: Input, db: Database) {
  const fsm = new FSMEngine(db);
  try {
    const newStatus = fsm.transition(args.changeSetId, "submit_for_review");
    return mcpText({ changeSetId: args.changeSetId, status: newStatus });
  } catch (e) {
    if (e instanceof InvalidTransitionError) {
      return mcpError({ error: e.message, changeSetId: args.changeSetId });
    }
    return mcpError({ error: e instanceof Error ? e.message : String(e) });
  }
}
