import type { Database } from "bun:sqlite";
import { HandoffContextBuilder } from "../context/handoff-context.js";
import { AgentRoleRegistry } from "../roles/registry.js";

interface Input { changeSetId: string; role: string }

function mcpText(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
}
function mcpError(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }], isError: true };
}

export async function handleGetHandoffContext(
  args: Input,
  db: Database,
  repoRoot?: string
) {
  try {
    const registry = new AgentRoleRegistry(repoRoot ?? process.cwd());
    const builder = new HandoffContextBuilder(db, repoRoot, registry);
    const payload = await builder.build(args.changeSetId, args.role);
    return mcpText({ context: payload, tokenEstimate: payload.tokenEstimate });
  } catch (e) {
    return mcpError({ error: e instanceof Error ? e.message : String(e) });
  }
}
