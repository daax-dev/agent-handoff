import type { Database } from "bun:sqlite";
import { resolve } from "node:path";
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
import { FSMEngine } from "../../fsm/engine.js";
import type { SSEBroadcaster } from "../sse.js";
import { json, notFound, badRequest, err } from "../response.js";

export function changeSetRoutes(
  db: Database,
  sse: SSEBroadcaster,
  path: string,
  req: Request
): Response | Promise<Response> | null {
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

  // GET /api/change-sets/:id/diff
  const diffMatch = path.match(/^\/api\/change-sets\/(chg_\d{6})\/diff$/);
  if (diffMatch && method === "GET") {
    const id = diffMatch[1];
    const cs = getChangeSet(db, id);
    if (!cs) return notFound("ChangeSet not found");
    return (async () => {
      try {
        const worktreePath = resolve(process.cwd(), cs.worktree_path);
        const proc = Bun.spawn(["git", "diff", "main...HEAD"], {
          cwd: worktreePath,
          stdout: "pipe",
          stderr: "pipe",
        });
        const text = await new Response(proc.stdout).text();
        await proc.exited;
        return new Response(text || "", {
          status: 200,
          headers: { "Content-Type": "text/plain; charset=utf-8" },
        });
      } catch {
        return new Response("[diff unavailable: worktree not found or git error]", {
          status: 200,
          headers: { "Content-Type": "text/plain; charset=utf-8" },
        });
      }
    })();
  }

  // GET /api/change-sets/:id/checkpoints
  const checkpointsMatch = path.match(/^\/api\/change-sets\/(chg_\d{6})\/checkpoints$/);
  if (checkpointsMatch && method === "GET") {
    const id = checkpointsMatch[1];
    const cs = getChangeSet(db, id);
    if (!cs) return notFound("ChangeSet not found");
    const engine = new FSMEngine(db);
    return json(engine.getHistory(id));
  }

  return null;
}
