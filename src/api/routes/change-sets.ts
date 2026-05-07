import type { Database } from "bun:sqlite";
import {
  createChangeSet,
  getChangeSet,
  listChangeSets,
  updateChangeSet,
  setChangeSetStatus,
  ChangeSetStatusSchema,
  CreateChangeSetInputSchema,
} from "../../domain/change-set.js";
import { InvalidTransitionError } from "../../fsm/errors.js";
import type { SSEBroadcaster } from "../sse.js";
import { json, notFound, badRequest, err } from "../response.js";

export function changeSetRoutes(
  db: Database,
  sse: SSEBroadcaster,
  path: string,
  req: Request
): Response | null {
  const url = new URL(req.url);
  const { method } = req;

  // GET /api/change-sets
  if (method === "GET" && path === "/api/change-sets") {
    return json(listChangeSets(db));
  }

  // POST /api/change-sets
  if (method === "POST" && path === "/api/change-sets") {
    return req.json().then((body: unknown) => {
      const parsed = CreateChangeSetInputSchema.safeParse(body);
      if (!parsed.success) {
        return badRequest(parsed.error.message);
      }
      const cs = createChangeSet(db, parsed.data);
      sse.emit({ type: "change_set_created", payload: cs as unknown as Record<string, unknown>, ts: new Date().toISOString() });
      return json(cs, 201);
    }) as unknown as Response;
  }

  // GET /api/change-sets/:id
  const detailMatch = path.match(/^\/api\/change-sets\/(chg_\d{6})$/);
  if (detailMatch) {
    const id = detailMatch[1];
    if (method === "GET") {
      const cs = getChangeSet(db, id);
      return cs ? json(cs) : notFound("ChangeSet not found");
    }
  }

  // PATCH /api/change-sets/:id/status
  const statusMatch = path.match(/^\/api\/change-sets\/(chg_\d{6})\/status$/);
  if (statusMatch && method === "PATCH") {
    const id = statusMatch[1];
    return req.json().then((body: unknown) => {
      const parsed = ChangeSetStatusSchema.safeParse(
        (body as Record<string, unknown>)?.status
      );
      if (!parsed.success) {
        return badRequest(`Invalid status: ${(body as Record<string, unknown>)?.status}`);
      }
      try {
        const cs = setChangeSetStatus(db, id, parsed.data);
        sse.emit({ type: "change_set_updated", payload: cs as unknown as Record<string, unknown>, ts: new Date().toISOString() });
        return json(cs);
      } catch (e) {
        if (e instanceof InvalidTransitionError) {
          return badRequest(e.message, 422);
        }
        return err(e instanceof Error ? e.message : String(e));
      }
    }) as unknown as Response;
  }

  return null;
}
