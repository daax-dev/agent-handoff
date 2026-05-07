import type { Database } from "bun:sqlite";
import { FSMEngine } from "../fsm/engine.js";
import { InvalidTransitionError, CircuitBreakerError } from "../fsm/errors.js";
import { listBlockingComments } from "../domain/review-comment.js";

import { mcpText, mcpError } from "./response.js";

interface Input { changeSetId: string; summary: string }

export async function handleRequestChanges(args: Input, db: Database) {
  // Guard: require at least one blocking comment
  const blocking = listBlockingComments(db, args.changeSetId);

  if (blocking.length === 0) {
    return mcpError({
      error: "Cannot request changes: no blocking review comments exist. Add at least one blocking comment first.",
      changeSetId: args.changeSetId,
    });
  }

  const fsm = new FSMEngine(db);
  try {
    const newStatus = fsm.transition(args.changeSetId, "request_changes", {
      metadata: { summary: args.summary },
    });
    return mcpText({
      changeSetId: args.changeSetId,
      status: newStatus,
      blockingCommentCount: blocking.length,
    });
  } catch (e) {
    if (e instanceof CircuitBreakerError) {
      return mcpError({
        error: `Circuit breaker: ChangeSet escalated after ${e.cycles} review cycles. Human review required.`,
        changeSetId: args.changeSetId,
        status: "escalated",
        cycles: e.cycles,
      });
    }
    if (e instanceof InvalidTransitionError) {
      return mcpError({ error: e.message, changeSetId: args.changeSetId });
    }
    return mcpError({ error: e instanceof Error ? e.message : String(e) });
  }
}
