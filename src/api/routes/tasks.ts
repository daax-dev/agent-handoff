import type { Database } from "bun:sqlite";
import {
  createTask,
  getTask,
  listTasks,
  CreateTaskInputSchema,
} from "../../domain/task.js";
import { json, notFound, badRequest } from "../response.js";
import type { SSEBroadcaster } from "../sse.js";

export function taskRoutes(
  db: Database,
  sse: SSEBroadcaster,
  path: string,
  req: Request
): Response | null {
  const url = new URL(req.url);
  const { method } = req;

  // GET /api/tasks[?changeSetId=chg_XXXXXX]
  if (method === "GET" && path === "/api/tasks") {
    const changeSetId = url.searchParams.get("changeSetId") ?? undefined;
    return json(listTasks(db, changeSetId));
  }

  // POST /api/tasks
  if (method === "POST" && path === "/api/tasks") {
    return req.json().then((body: unknown) => {
      const parsed = CreateTaskInputSchema.safeParse(body);
      if (!parsed.success) {
        return badRequest(parsed.error.message);
      }
      const task = createTask(db, parsed.data);
      sse.emit({ type: "task_created", payload: task as unknown as Record<string, unknown>, ts: new Date().toISOString() });
      return json(task, 201);
    }) as unknown as Response;
  }

  // GET /api/tasks/:id
  const detailMatch = path.match(/^\/api\/tasks\/(TSK_\d{6})$/);
  if (detailMatch && method === "GET") {
    const id = detailMatch[1];
    const task = getTask(db, id);
    return task ? json(task) : notFound("Task not found");
  }

  return null;
}
