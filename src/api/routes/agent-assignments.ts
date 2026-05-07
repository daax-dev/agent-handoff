import type { Database } from "bun:sqlite";
import {
  listAssignments,
  listAssignmentsByStates,
  upsertAssignment,
  SUPPORTED_TOOLS,
  type AgentTool,
} from "../../domain/agent-assignment.js";
import { json, badRequest } from "../response.js";

// GSD and changeset state sets for mode-scoped filtering
const GSD_STATES = new Set([
  "project_init", "roadmap_ready", "discussing", "planning", "plan_ready",
  "executing", "verifying", "gap_fixing", "shipping", "phase_done",
  "milestone_complete", "escalated",
]);

const CS_STATES = new Set([
  "draft", "planned", "implementing", "reviewing", "changes_requested",
  "approved", "conflict_detected", "merged", "abandoned", "escalated",
]);

// ── Type guards ───────────────────────────────────────────────────────────────

function isAgentTool(v: unknown): v is AgentTool {
  return typeof v === "string" && (SUPPORTED_TOOLS as readonly string[]).includes(v);
}

function isMcpsArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === "string");
}

function isNullableString(v: unknown): v is string | null {
  return v === null || typeof v === "string";
}

// ── Route handler ─────────────────────────────────────────────────────────────

export async function agentAssignmentRoutes(
  db: Database,
  path: string,
  req: Request
): Promise<Response | null> {
  const { method } = req;

  // GET /api/agent-assignments
  if (method === "GET" && path === "/api/agent-assignments") {
    return json(listAssignments(db));
  }

  // GET /api/agent-assignments/by-mode/:mode
  const byModeMatch = path.match(/^\/api\/agent-assignments\/by-mode\/(changeset|gsd)$/);
  if (byModeMatch && method === "GET") {
    const [, mode] = byModeMatch;
    const states = mode === "gsd" ? [...GSD_STATES] : [...CS_STATES];
    return json(listAssignmentsByStates(db, states));
  }

  // PUT /api/agent-assignments/:fsmState/:role
  const putMatch = path.match(/^\/api\/agent-assignments\/([^/]+)\/([^/]+)$/);
  if (putMatch && method === "PUT") {
    const [, fsmState, role] = putMatch;

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return badRequest("Invalid JSON body");
    }

    if (typeof body !== "object" || body === null) {
      return badRequest("Request body must be an object");
    }

    const b = body as Record<string, unknown>;

    if (!isAgentTool(b.tool)) {
      return badRequest(`Invalid tool "${String(b.tool)}". Supported: ${SUPPORTED_TOOLS.join(", ")}`);
    }

    if ("model" in b && !isNullableString(b.model)) {
      return badRequest("model must be a string or null");
    }

    if ("prompt_override" in b && !isNullableString(b.prompt_override)) {
      return badRequest("prompt_override must be a string or null");
    }

    if ("mcps" in b && b.mcps !== null && !isMcpsArray(b.mcps)) {
      return badRequest("mcps must be an array of strings or null");
    }

    if ("auto_launch" in b && typeof b.auto_launch !== "boolean") {
      return badRequest("auto_launch must be a boolean");
    }

    const updated = upsertAssignment(db, {
      fsmState,
      role,
      tool: b.tool,
      enabled: b.enabled !== false,
      model: isNullableString(b.model) ? b.model : null,
      prompt_override: isNullableString(b.prompt_override) ? b.prompt_override : null,
      mcps: "mcps" in b ? (b.mcps === null ? null : (b.mcps as string[])) : undefined,
      auto_launch: typeof b.auto_launch === "boolean" ? b.auto_launch : false,
    });

    return json(updated);
  }

  return null;
}
