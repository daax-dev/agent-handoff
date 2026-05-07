import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import type { Database } from "bun:sqlite";
import { resolve } from "node:path";
import { openTestDb } from "../db.js";
import { createChangeSet } from "../domain/change-set.js";
import {
  createReviewComment,
  getReviewComment,
  listReviewComments,
  listBlockingComments,
  resolveComment,
  CommentAlreadyResolvedError,
  CommentNotFoundError,
} from "../domain/review-comment.js";
import { createApiServer } from "../api/server.js";

const MIGRATIONS_DIR = resolve(process.cwd(), "migrations");

let db: Database;

function newCs(suffix = "001") {
  return createChangeSet(db, {
    task_id: `TSK_${suffix.padStart(6, "0")}`,
    title: `Test CS ${suffix}`,
    source_branch: `feat/TSK-${suffix}`,
    worktree_path: `.work/worktrees/TSK-${suffix}`,
  });
}

beforeEach(() => {
  db = openTestDb(MIGRATIONS_DIR);
});

afterEach(() => {
  db.close();
});

// ---------------------------------------------------------------------------
// Domain layer
// ---------------------------------------------------------------------------

describe("createReviewComment", () => {
  test("creates comment with generated id", () => {
    const cs = newCs("001");
    const comment = createReviewComment(db, {
      changeSetId: cs.id,
      body: "Fix the off-by-one error",
      severity: "blocking",
    });
    expect(comment.id).toMatch(/^cmt_\d{6}$/);
    expect(comment.severity).toBe("blocking");
    expect(comment.resolved).toBe(0);
    expect(comment.resolved_by).toBeNull();
    expect(comment.body).toBe("Fix the off-by-one error");
  });

  test("auto-increments IDs", () => {
    const cs = newCs("002");
    const a = createReviewComment(db, { changeSetId: cs.id, body: "a", severity: "nit" });
    const b = createReviewComment(db, { changeSetId: cs.id, body: "b", severity: "nit" });
    expect(a.id).not.toBe(b.id);
  });
});

describe("listReviewComments", () => {
  test("returns all comments for a change set", () => {
    const cs = newCs("010");
    createReviewComment(db, { changeSetId: cs.id, body: "b1", severity: "blocking" });
    createReviewComment(db, { changeSetId: cs.id, body: "a1", severity: "advisory" });
    createReviewComment(db, { changeSetId: cs.id, body: "n1", severity: "nit" });
    expect(listReviewComments(db, cs.id)).toHaveLength(3);
  });

  test("filters by severity", () => {
    const cs = newCs("011");
    createReviewComment(db, { changeSetId: cs.id, body: "b1", severity: "blocking" });
    createReviewComment(db, { changeSetId: cs.id, body: "b2", severity: "blocking" });
    createReviewComment(db, { changeSetId: cs.id, body: "a1", severity: "advisory" });
    const blocking = listReviewComments(db, cs.id, { severity: "blocking" });
    expect(blocking).toHaveLength(2);
    expect(blocking.every((c) => c.severity === "blocking")).toBe(true);
  });

  test("filters by resolved=false", () => {
    const cs = newCs("012");
    const b1 = createReviewComment(db, { changeSetId: cs.id, body: "b1", severity: "blocking" });
    createReviewComment(db, { changeSetId: cs.id, body: "b2", severity: "blocking" });
    resolveComment(db, b1.id, "human");
    const unresolved = listReviewComments(db, cs.id, { resolved: false });
    expect(unresolved).toHaveLength(1);
    expect(unresolved[0].body).toBe("b2");
  });
});

describe("listBlockingComments", () => {
  test("returns only unresolved blocking comments", () => {
    const cs = newCs("020");
    const b1 = createReviewComment(db, { changeSetId: cs.id, body: "b1", severity: "blocking" });
    createReviewComment(db, { changeSetId: cs.id, body: "b2", severity: "blocking" });
    const resolvedB = createReviewComment(db, { changeSetId: cs.id, body: "b3-resolved", severity: "blocking" });
    createReviewComment(db, { changeSetId: cs.id, body: "a1", severity: "advisory" });
    resolveComment(db, resolvedB.id, "agent");
    resolveComment(db, b1.id, "agent");

    const result = listBlockingComments(db, cs.id);
    expect(result).toHaveLength(1);
    expect(result[0].body).toBe("b2");
  });
});

describe("resolveComment", () => {
  test("marks comment resolved with timestamp", () => {
    const cs = newCs("030");
    const comment = createReviewComment(db, { changeSetId: cs.id, body: "fix", severity: "blocking" });
    const resolved = resolveComment(db, comment.id, "qa_agent");
    expect(resolved.resolved).toBe(1);
    expect(resolved.resolved_by).toBe("qa_agent");
    expect(resolved.resolved_at).toBeString();
  });

  test("throws CommentAlreadyResolvedError on double resolve", () => {
    const cs = newCs("031");
    const comment = createReviewComment(db, { changeSetId: cs.id, body: "fix", severity: "blocking" });
    resolveComment(db, comment.id, "agent");
    expect(() => resolveComment(db, comment.id, "agent")).toThrow(CommentAlreadyResolvedError);
  });

  test("throws CommentNotFoundError for unknown id", () => {
    expect(() => resolveComment(db, "cmt_999999", "agent")).toThrow(CommentNotFoundError);
  });
});

// ---------------------------------------------------------------------------
// REST API layer
// ---------------------------------------------------------------------------

describe("review comment REST API", () => {
  test("POST /api/change-sets/:id/comments creates comment", async () => {
    const cs = newCs("040");
    const { server } = createApiServer({ db, port: 0 });
    const url = `http://localhost:${server.port}/api/change-sets/${cs.id}/comments`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body: "Something is broken", severity: "blocking" }),
    });
    expect(res.status).toBe(201);
    const data = await res.json() as { id: string; severity: string };
    expect(data.id).toMatch(/^cmt_/);
    expect(data.severity).toBe("blocking");
    server.stop();
  });

  test("POST returns 400 for invalid severity", async () => {
    const cs = newCs("041");
    const { server } = createApiServer({ db, port: 0 });
    const url = `http://localhost:${server.port}/api/change-sets/${cs.id}/comments`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body: "test", severity: "critical" }),
    });
    expect(res.status).toBe(400);
    server.stop();
  });

  test("GET /api/change-sets/:id/comments returns comments", async () => {
    const cs = newCs("042");
    createReviewComment(db, { changeSetId: cs.id, body: "b1", severity: "blocking" });
    createReviewComment(db, { changeSetId: cs.id, body: "n1", severity: "nit" });
    const { server } = createApiServer({ db, port: 0 });
    const url = `http://localhost:${server.port}/api/change-sets/${cs.id}/comments`;
    const res = await fetch(url);
    expect(res.status).toBe(200);
    const data = await res.json() as unknown[];
    expect(data).toHaveLength(2);
    server.stop();
  });

  test("GET with ?severity=blocking&resolved=false filters correctly", async () => {
    const cs = newCs("043");
    const b1 = createReviewComment(db, { changeSetId: cs.id, body: "b1", severity: "blocking" });
    createReviewComment(db, { changeSetId: cs.id, body: "b2", severity: "blocking" });
    createReviewComment(db, { changeSetId: cs.id, body: "a1", severity: "advisory" });
    resolveComment(db, b1.id, "agent");
    const { server } = createApiServer({ db, port: 0 });
    const url = `http://localhost:${server.port}/api/change-sets/${cs.id}/comments?severity=blocking&resolved=false`;
    const res = await fetch(url);
    const data = await res.json() as unknown[];
    expect(data).toHaveLength(1);
    server.stop();
  });

  test("PATCH /resolve marks comment resolved", async () => {
    const cs = newCs("044");
    const comment = createReviewComment(db, { changeSetId: cs.id, body: "fix", severity: "blocking" });
    const { server } = createApiServer({ db, port: 0 });
    const url = `http://localhost:${server.port}/api/change-sets/${cs.id}/comments/${comment.id}/resolve`;
    const res = await fetch(url, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ resolvedBy: "qa_agent" }),
    });
    expect(res.status).toBe(200);
    const data = await res.json() as { resolved: boolean; resolvedAt: string };
    expect(data.resolved).toBe(true);
    expect(data.resolvedAt).toBeString();
    server.stop();
  });

  test("PATCH /resolve returns 409 for already-resolved comment", async () => {
    const cs = newCs("045");
    const comment = createReviewComment(db, { changeSetId: cs.id, body: "fix", severity: "blocking" });
    resolveComment(db, comment.id, "agent");
    const { server } = createApiServer({ db, port: 0 });
    const url = `http://localhost:${server.port}/api/change-sets/${cs.id}/comments/${comment.id}/resolve`;
    const res = await fetch(url, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ resolvedBy: "agent" }),
    });
    expect(res.status).toBe(409);
    server.stop();
  });
});
