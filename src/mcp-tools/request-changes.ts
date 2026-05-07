import type { Database } from "bun:sqlite";
import { FSMEngine } from "../fsm/engine.js";
import { InvalidTransitionError, CircuitBreakerError } from "../fsm/errors.js";

interface Input { changeSetId: string; summary: string }

function mcpText(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
}
function mcpError(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }], isError: true };
}

export async function handleRequestChanges(args: Input, db: Database) {
  // Guard: require at least one blocking comment
  const blockingCount = db
    .query<{ n: number }, [string]>(
      "SELECT COUNT(*) as n FROM review_comments WHERE change_set_id = ? AND severity = 'blocking' AND resolved = 0"
    )
    .get(args.changeSetId);

  if (!blockingCount || blockingCount.n === 0) {
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
      blockingCommentCount: blockingCount.n,
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
