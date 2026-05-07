import type { Database } from "bun:sqlite";
import {
  createDecision,
  listDecisionsByTask,
  listDecisionsByChangeSet,
  CreateDecisionInputSchema,
} from "../../domain/decision.js";
import { json, badRequest, err } from "../response.js";

export function decisionRoutes(
  db: Database,
  path: string,
  req: Request
): Response | Promise<Response> | null {
  const { method } = req;

  // GET /api/tasks/:id/decisions
  const taskMatch = path.match(/^\/api\/tasks\/(TSK_\d{6})\/decisions$/);
  if (taskMatch && method === "GET") {
    return json(listDecisionsByTask(db, taskMatch[1]));
  }

  // POST /api/tasks/:id/decisions (human entry)
  if (taskMatch && method === "POST") {
    const taskId = taskMatch[1];
    return req.json().then((body: unknown) => {
      const parsed = CreateDecisionInputSchema.safeParse({
        ...(body as Record<string, unknown>),
        taskId,
      });
      if (!parsed.success) {
        return badRequest(parsed.error.issues[0]?.message ?? parsed.error.message);
      }
      try {
        const decision = createDecision(db, parsed.data);
        return json(decision, 201);
      } catch (e) {
        return err(e instanceof Error ? e.message : String(e));
      }
    });
  }

  // GET /api/change-sets/:id/decisions
  const csMatch = path.match(/^\/api\/change-sets\/(chg_\d{6})\/decisions$/);
  if (csMatch && method === "GET") {
    return json(listDecisionsByChangeSet(db, csMatch[1]));
  }

  return null;
}
