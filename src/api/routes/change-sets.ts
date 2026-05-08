import type { Database } from "bun:sqlite";
import { resolve } from "node:path";
import {
  createChangeSet,
  getChangeSet,
  listChangeSets,
  updateChangeSet,
  setChangeSetStatus,
  setGithubPrUrl,
  importChangeSetFromGitHub,
  quickCreateChangeSet,
  ChangeSetStatusSchema,
  CreateChangeSetInputSchema,
  ImportFromGitHubInputSchema,
  QuickCreateChangeSetInputSchema,
} from "../../domain/change-set.js";
import { InvalidTransitionError } from "../../fsm/errors.js";
import { FSMEngine } from "../../fsm/engine.js";
import { HITLGate, HITLPendingError } from "../../fsm/hitl.js";
import { PRBodyBuilder } from "../../bridge/pr-body-builder.js";
import { SpecStore } from "../../spec/store.js";
import type { SSEBroadcaster } from "../sse.js";
import { json, notFound, badRequest, err } from "../response.js";
import { preWarmSessions } from "../../orchestrator/pre-warm.js";

export function changeSetRoutes(
  db: Database,
  sse: SSEBroadcaster,
  path: string,
  req: Request,
  repoRoot?: string
): Response | Promise<Response> | null {
  const url = new URL(req.url);
  const { method } = req;

  // GET /api/change-sets[?status=<status>]
  if (method === "GET" && path === "/api/change-sets") {
    const statusFilter = url.searchParams.get("status");
    const list = listChangeSets(db);
    return json(statusFilter ? list.filter((cs) => cs.status === statusFilter) : list);
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
      // Fire-and-forget: pre-warm sessions for auto_launch=1 assignments
      preWarmSessions(db, cs.id);
      return json(cs, 201);
    }) as unknown as Response;
  }

  // POST /api/change-sets/quick-create  (new command — title only, auto-generates IDs)
  if (method === "POST" && path === "/api/change-sets/quick-create") {
    return req.json().then((body: unknown) => {
      const parsed = QuickCreateChangeSetInputSchema.safeParse(body);
      if (!parsed.success) {
        return badRequest(parsed.error.message);
      }
      const cs = quickCreateChangeSet(db, parsed.data);
      sse.emit({ type: "change_set_created", payload: cs as unknown as Record<string, unknown>, ts: new Date().toISOString() });
      // Fire-and-forget: pre-warm sessions for auto_launch=1 assignments
      preWarmSessions(db, cs.id);
      return json(cs, 201);
    }) as unknown as Response;
  }

  // POST /api/change-sets/from-github-issue
  if (method === "POST" && path === "/api/change-sets/from-github-issue") {
    return req.json().then((body: unknown) => {
      const parsed = ImportFromGitHubInputSchema.safeParse(body);
      if (!parsed.success) {
        return badRequest(parsed.error.message);
      }
      const cs = importChangeSetFromGitHub(db, parsed.data);
      if (parsed.data.specContent) {
        try {
          const store = new SpecStore(repoRoot);
          store.write(cs.task_id, "spec", parsed.data.specContent);
        } catch { /* non-fatal: spec_content is stored in DB as fallback */ }
      }
      sse.emit({ type: "change_set_created", payload: cs as unknown as Record<string, unknown>, ts: new Date().toISOString() });
      // Fire-and-forget: pre-warm sessions for auto_launch=1 assignments
      preWarmSessions(db, cs.id);
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
  // Accepts { trigger: string } for FSM-driven transitions (routed through HITLGate),
  // or legacy { status: string } for direct status overrides (admin/test use only).
  const statusMatch = path.match(/^\/api\/change-sets\/(chg_\d{6})\/status$/);
  if (statusMatch && method === "PATCH") {
    const id = statusMatch[1];
    return req.json().then((body: unknown) => {
      const b = body as Record<string, unknown>;

      // Trigger-based transition (preferred path)
      if (typeof b?.trigger === "string") {
        const cs = getChangeSet(db, id);
        if (!cs) return notFound("ChangeSet not found");
        try {
          const gate = new HITLGate(db, sse);
          const result = gate.transition(id, b.trigger);
          if (result.status === "pending") {
            return json({ status: "awaiting_human_approval", approvalId: result.approvalId }, 202);
          }
          return json(getChangeSet(db, id));
        } catch (e) {
          if (e instanceof InvalidTransitionError) return badRequest(e.message, 422);
          if (e instanceof HITLPendingError) return badRequest(e.message, 409);
          return err(e instanceof Error ? e.message : String(e));
        }
      }

      // Legacy direct-status override (bypasses FSM — kept for tests/admin)
      const parsed = ChangeSetStatusSchema.safeParse(b?.status);
      if (!parsed.success) {
        return badRequest(`Provide { trigger } for FSM transition or { status } for direct override`);
      }
      try {
        const cs = setChangeSetStatus(db, id, parsed.data);
        sse.emit({ type: "change_set_updated", payload: cs as unknown as Record<string, unknown>, ts: new Date().toISOString() });
        return json(cs);
      } catch (e) {
        if (e instanceof InvalidTransitionError) return badRequest(e.message, 422);
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

  // PATCH /api/change-sets/:id/github-pr-url
  const prUrlMatch = path.match(/^\/api\/change-sets\/(chg_\d{6})\/github-pr-url$/);
  if (prUrlMatch && method === "PATCH") {
    const id = prUrlMatch[1];
    return req.json().then((body: unknown) => {
      const b = body as Record<string, unknown>;
      if (typeof b?.url !== "string" || !b.url) {
        return badRequest("{ url: string } required");
      }
      const cs = setGithubPrUrl(db, id, b.url);
      if (!cs) return notFound("ChangeSet not found");
      sse.emit({
        type: "exported",
        payload: { changeSetId: id, prUrl: b.url },
        ts: new Date().toISOString(),
      });
      return json(cs);
    }) as unknown as Response;
  }

  // GET /api/change-sets/:id/pr-body
  const prBodyMatch = path.match(/^\/api\/change-sets\/(chg_\d{6})\/pr-body$/);
  if (prBodyMatch && method === "GET") {
    const id = prBodyMatch[1];
    const cs = getChangeSet(db, id);
    if (!cs) return notFound("ChangeSet not found");
    try {
      const builder = new PRBodyBuilder(db);
      const body = builder.build(id);
      return new Response(body, { status: 200, headers: { "Content-Type": "text/markdown; charset=utf-8" } });
    } catch (e) {
      return err(e instanceof Error ? e.message : String(e));
    }
  }

  return null;
}
