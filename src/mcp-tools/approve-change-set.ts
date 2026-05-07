import type { Database } from "bun:sqlite";
import { InvalidTransitionError } from "../fsm/errors.js";
import { HITLGate, HITLPendingError } from "../fsm/hitl.js";
import { allRequiredPassed } from "../domain/check-run.js";
import { REQUIRED_CHECK_NAMES } from "../checks/check-config.js";
import { broadcaster } from "../api/sse.js";

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

  const gate = new HITLGate(db, broadcaster);
  try {
    const result = gate.transition(args.changeSetId, "approve");
    if (result.status === "pending") {
      return mcpText({
        changeSetId: args.changeSetId,
        status: "awaiting_human_approval",
        approvalId: result.approvalId,
        message: "Human approval required. Use `localsdlc approve` or the dashboard to proceed.",
      });
    }
    return mcpText({ changeSetId: args.changeSetId, status: result.newStatus });
  } catch (e) {
    if (e instanceof InvalidTransitionError) {
      return mcpError({ error: e.message, changeSetId: args.changeSetId });
    }
    if (e instanceof HITLPendingError) {
      return mcpError({ error: e.message, changeSetId: args.changeSetId });
    }
    return mcpError({ error: e instanceof Error ? e.message : String(e) });
  }
}
