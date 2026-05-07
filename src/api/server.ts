import type { Database } from "bun:sqlite";
import { SSEBroadcaster, broadcaster as defaultBroadcaster } from "./sse.js";
import { changeSetRoutes } from "./routes/change-sets.js";
import { taskRoutes } from "./routes/tasks.js";
import { eventsRoute } from "./routes/events.js";
import { reviewCommentRoutes } from "./routes/review-comments.js";
import { checkRunRoutes } from "./routes/check-runs.js";
import { decisionRoutes } from "./routes/decisions.js";
import { json, notFound } from "./response.js";

const ALLOWED_ORIGINS = ["http://localhost:5173", "http://localhost:4000", "http://127.0.0.1:5173"];

function corsHeaders(origin: string | null): Record<string, string> {
  const allowed = origin && ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allowed,
    "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  };
}

function addCors(response: Response, origin: string | null): Response {
  const headers = new Headers(response.headers);
  for (const [k, v] of Object.entries(corsHeaders(origin))) {
    headers.set(k, v);
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export interface ServerOptions {
  port?: number;
  db: Database;
  sse?: SSEBroadcaster;
}

export function createApiServer(options: ServerOptions) {
  const { db } = options;
  const sse = options.sse ?? defaultBroadcaster;
  const port = options.port ?? parseInt(process.env.PORT ?? "4000", 10);

  const server = Bun.serve({
    port,
    async fetch(req) {
      const url = new URL(req.url);
      const path = url.pathname;
      const origin = req.headers.get("Origin");

      // Preflight
      if (req.method === "OPTIONS") {
        return new Response(null, { status: 204, headers: corsHeaders(origin) });
      }

      // Health
      if (req.method === "GET" && path === "/api/health") {
        return addCors(json({ ok: true, ts: new Date().toISOString() }), origin);
      }

      // SSE events stream
      const eventsResponse = eventsRoute(sse, path, req);
      if (eventsResponse) return addCors(eventsResponse, origin);

      // ChangeSet routes
      const csResponse = changeSetRoutes(db, sse, path, req);
      if (csResponse instanceof Promise) {
        return csResponse.then((r) => addCors(r, origin));
      }
      if (csResponse) return addCors(csResponse, origin);

      // Task routes
      const taskResponse = taskRoutes(db, sse, path, req);
      if (taskResponse instanceof Promise) {
        return taskResponse.then((r) => addCors(r, origin));
      }
      if (taskResponse) return addCors(taskResponse, origin);

      // Review comment routes
      const commentResponse = reviewCommentRoutes(db, path, req);
      if (commentResponse instanceof Promise) {
        return commentResponse.then((r) => addCors(r, origin));
      }
      if (commentResponse) return addCors(commentResponse, origin);

      // Check run routes
      const checkResponse = checkRunRoutes(db, path, req);
      if (checkResponse) return addCors(checkResponse, origin);

      // Decision routes
      const decisionResponse = decisionRoutes(db, path, req);
      if (decisionResponse instanceof Promise) {
        return decisionResponse.then((r) => addCors(r, origin));
      }
      if (decisionResponse) return addCors(decisionResponse, origin);

      return addCors(notFound(), origin);
    },
  });

  return { server, sse };
}

// Entrypoint when run directly: bun run src/api/server.ts
if (import.meta.main) {
  const { getDb } = await import("../db.js");
  const db = getDb();
  const { server } = createApiServer({ db });
  console.log(`API server listening on http://localhost:${server.port}`);
}
