import type { Database } from "bun:sqlite";
import { createDecision, CreateDecisionInputSchema } from "../domain/decision.js";

import { mcpText, mcpError } from "./response.js";

export async function handleLogDecision(args: Record<string, unknown>, db: Database) {
  const parsed = CreateDecisionInputSchema.safeParse(args);
  if (!parsed.success) {
    const firstIssue = parsed.error.issues[0];
    return mcpError({ error: firstIssue?.message ?? parsed.error.message });
  }
  try {
    const decision = createDecision(db, parsed.data);
    return mcpText({ decisionId: decision.id });
  } catch (e) {
    return mcpError({ error: e instanceof Error ? e.message : String(e) });
  }
}
