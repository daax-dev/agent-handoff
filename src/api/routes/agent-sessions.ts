import type { Database } from "bun:sqlite";
import {
  listSessions,
  registerSession,
  heartbeat,
  disconnectSession,
  getSession,
} from "../../domain/agent-session.js";
import { json, notFound, badRequest } from "../response.js";

export function agentSessionRoutes(
  db: Database,
  path: string,
  req: Request
): Response | Promise<Response> | null {
  const { method } = req;

  // GET /api/agent-sessions
  if (method === "GET" && path === "/api/agent-sessions") {
    return json(listSessions(db));
  }

  // POST /api/agent-sessions — register (used by pre-spawned agents)
  if (method === "POST" && path === "/api/agent-sessions") {
    return req.json().then((body: unknown) => {
      const b = body as Record<string, unknown>;
      const tool = b?.tool as string;
      if (!tool) return badRequest("tool is required");
      const roles = Array.isArray(b?.roles) ? (b.roles as string[]) : [];
      const session = registerSession(db, tool, roles);
      return json(session, 201);
    }) as unknown as Response;
  }

  // POST /api/agent-sessions/:id/heartbeat
  const hbMatch = path.match(/^\/api\/agent-sessions\/([0-9a-f-]{36})\/heartbeat$/);
  if (hbMatch && method === "POST") {
    const session = heartbeat(db, hbMatch[1]);
    return session ? json(session) : notFound("Session not found");
  }

  // DELETE /api/agent-sessions/:id
  const delMatch = path.match(/^\/api\/agent-sessions\/([0-9a-f-]{36})$/);
  if (delMatch && method === "DELETE") {
    const session = getSession(db, delMatch[1]);
    if (!session) return notFound("Session not found");
    disconnectSession(db, delMatch[1]);
    return json({ ok: true });
  }

  return null;
}
