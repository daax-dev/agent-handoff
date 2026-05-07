import type { Database } from "bun:sqlite";
import { SSEBroadcaster, broadcaster as defaultBroadcaster } from "./sse.js";
import { changeSetRoutes } from "./routes/change-sets.js";
import { taskRoutes } from "./routes/tasks.js";
import { eventsRoute } from "./routes/events.js";
import { reviewCommentRoutes } from "./routes/review-comments.js";
import { checkRunRoutes } from "./routes/check-runs.js";
import { decisionRoutes } from "./routes/decisions.js";
import { approvalRoutes } from "./routes/approvals.js";
import { agentAssignmentRoutes } from "./routes/agent-assignments.js";
import { agentSessionRoutes } from "./routes/agent-sessions.js";
import { fsmMetaRoute } from "./routes/fsm-meta.js";
import { fsmWorkflowRoute } from "./routes/fsm-workflow.js";
import { json, notFound } from "./response.js";

function isAllowedOrigin(origin: string | null): boolean {
  if (!origin) return false;
  // Allow any localhost port in API range (4000-4009) or UI range (5173-5182)
  return /^http:\/\/(localhost|127\.0\.0\.1):(4\d{3}|517[3-9]|518[0-2])$/.test(origin);
}

function corsHeaders(origin: string | null): Record<string, string> {
  const allowed = isAllowedOrigin(origin) ? origin! : "http://localhost:5173";
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
  repoRoot?: string;
}

export function createApiServer(options: ServerOptions) {
  const { db } = options;
  const sse = options.sse ?? defaultBroadcaster;
  const repoRoot = options.repoRoot;
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
      const csResponse = changeSetRoutes(db, sse, path, req, repoRoot);
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

      // Agent assignment + session routes (PRD-020)
      const assignResponse = agentAssignmentRoutes(db, path, req);
      if (assignResponse instanceof Promise) return assignResponse.then((r) => addCors(r, origin));
      if (assignResponse) return addCors(assignResponse, origin);

      const sessionResponse = agentSessionRoutes(db, path, req);
      if (sessionResponse instanceof Promise) return sessionResponse.then((r) => addCors(r, origin));
      if (sessionResponse) return addCors(sessionResponse, origin);

      // FSM meta (transitions + role models)
      const fsmMetaResponse = fsmMetaRoute(path, req);
      if (fsmMetaResponse) return addCors(fsmMetaResponse, origin);

      // FSM workflow config (editable transitions + HITL config + layout)
      const fsmWorkflowResponse = fsmWorkflowRoute(path, req);
      if (fsmWorkflowResponse instanceof Promise) {
        return fsmWorkflowResponse.then((r) => addCors(r, origin));
      }
      if (fsmWorkflowResponse) return addCors(fsmWorkflowResponse, origin);

      // Approval routes (HITL)
      const approvalResponse = approvalRoutes(db, sse, path, req);
      if (approvalResponse instanceof Promise) {
        return approvalResponse.then((r) => addCors(r, origin));
      }
      if (approvalResponse) return addCors(approvalResponse, origin);

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
