import type { Database } from "bun:sqlite";
import { listAssignments, upsertAssignment, SUPPORTED_TOOLS } from "../../domain/agent-assignment.js";
import { json, badRequest, notFound } from "../response.js";

export function agentAssignmentRoutes(
  db: Database,
  path: string,
  req: Request
): Response | Promise<Response> | null {
  const { method } = req;

  // GET /api/agent-assignments
  if (method === "GET" && path === "/api/agent-assignments") {
    return json(listAssignments(db));
  }

  // PUT /api/agent-assignments/:fsmState/:role
  const putMatch = path.match(/^\/api\/agent-assignments\/([^/]+)\/([^/]+)$/);
  if (putMatch && method === "PUT") {
    const [, fsmState, role] = putMatch;
    return req.json().then((body: unknown) => {
      const b = body as Record<string, unknown>;
      const tool = b?.tool as string;
      if (!SUPPORTED_TOOLS.includes(tool as never)) {
        return badRequest(`Invalid tool "${tool}". Supported: ${SUPPORTED_TOOLS.join(", ")}`);
      }
      const enabled = b?.enabled !== false;
      const updated = upsertAssignment(db, fsmState, role, tool as never, enabled);
      return json(updated);
    }) as unknown as Response;
  }

  return null;
}
