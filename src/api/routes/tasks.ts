import type { Database } from "bun:sqlite";
import { resolve } from "node:path";
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
): Response | Promise<Response> | null {
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

  // GET /api/tasks/:id/log
  const logMatch = path.match(/^\/api\/tasks\/(TSK_\d{6})\/log$/);
  if (logMatch && method === "GET") {
    const id = logMatch[1];
    return (async () => {
      try {
        const logPath = resolve(process.cwd(), ".work", "logs", `${id}.log`);
        const file = Bun.file(logPath);
        const exists = await file.exists();
        const text = exists ? await file.text() : "";
        return new Response(text, {
          status: 200,
          headers: { "Content-Type": "text/plain; charset=utf-8" },
        });
      } catch {
        return new Response("", {
          status: 200,
          headers: { "Content-Type": "text/plain; charset=utf-8" },
        });
      }
    })();
  }

  return null;
}
