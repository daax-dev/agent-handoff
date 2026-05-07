import type { Database } from "bun:sqlite";
import { FSMEngine } from "../fsm/engine.js";
import { InvalidTransitionError } from "../fsm/errors.js";
import { allRequiredPassed } from "../domain/check-run.js";
import { REQUIRED_CHECK_NAMES } from "../checks/check-config.js";

import { mcpText, mcpError } from "./response.js";

interface Input { changeSetId: string; summary: string }

export async function handleApproveChangeSet(args: Input, db: Database) {
  // Guard: all required checks must have passed
  if (!allRequiredPassed(db, args.changeSetId, REQUIRED_CHECK_NAMES)) {
    return mcpError({
      error: "required checks failed: all required checks must pass before approval",
      changeSetId: args.changeSetId,
    });
  }

  // MVP-3/4: no HITL gate yet (PRD-006 is MVP-6).
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
