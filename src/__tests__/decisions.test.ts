import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import type { Database } from "bun:sqlite";
import { resolve } from "node:path";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { openTestDb } from "../db.js";
import { createChangeSet } from "../domain/change-set.js";
import {
  createDecision,
  listDecisionsByTask,
  listDecisionsByChangeSet,
  exportToJSONL,
} from "../domain/decision.js";
import { handleLogDecision } from "../mcp-tools/log-decision.js";
import { createApiServer } from "../api/server.js";

const MIGRATIONS_DIR = resolve(process.cwd(), "migrations");
const REPO_ROOT = resolve(process.cwd());

let db: Database;

function newCs(suffix = "001") {
  return createChangeSet(db, {
    task_id: `TSK_${suffix.padStart(6, "0")}`,
    title: `Test CS ${suffix}`,
    source_branch: `feat/TSK-${suffix}`,
    worktree_path: `.work/worktrees/TSK-${suffix}`,
  });
}

function decisionInput(cs: { id: string; task_id: string }, overrides: object = {}) {
  return {
    taskId: cs.task_id,
    changeSetId: cs.id,
    topic: "Test decision",
    optionsConsidered: ["Option A", "Option B"],
    choice: "Option A",
    rationale: "Option A is simpler",
    ...overrides,
  };
}

beforeEach(() => {
  db = openTestDb(MIGRATIONS_DIR);
});

afterEach(() => {
  const dir = resolve(REPO_ROOT, ".work", "tasks");
  for (const suffix of ["000001", "000002", "000003", "000004", "000005"]) {
    const taskDir = resolve(dir, `TSK_${suffix}`);
    if (existsSync(taskDir)) rmSync(taskDir, { recursive: true });
  }
  db.close();
});

// ---------------------------------------------------------------------------
// Domain layer
// ---------------------------------------------------------------------------

describe("createDecision", () => {
  test("creates decision with DEC-XXXXXX ID", () => {
    const cs = newCs("001");
    const d = createDecision(db, decisionInput(cs));
    expect(d.id).toMatch(/^DEC-\d{6}$/);
    expect(d.topic).toBe("Test decision");
    expect(d.choice).toBe("Option A");
  });

  test("stores options_considered as JSON string", () => {
    const cs = newCs("002");
    const d = createDecision(db, decisionInput(cs));
    expect(() => JSON.parse(d.options_considered)).not.toThrow();
    const opts = JSON.parse(d.options_considered) as string[];
    expect(opts).toEqual(["Option A", "Option B"]);
  });
});

describe("Decision ID uniqueness", () => {
  test("IDs are unique across tasks", () => {
    const cs1 = newCs("001");
    const cs2 = newCs("002");
    const d1 = createDecision(db, decisionInput(cs1));
    const d2 = createDecision(db, decisionInput(cs2));
    expect(d1.id).not.toBe(d2.id);
  });
});

describe("listDecisionsByTask", () => {
  test("returns decisions in ts order", () => {
    const cs = newCs("003");
    createDecision(db, decisionInput(cs, { topic: "First" }));
    createDecision(db, decisionInput(cs, { topic: "Second" }));
    const list = listDecisionsByTask(db, cs.task_id);
    expect(list).toHaveLength(2);
    expect(list[0].topic).toBe("First");
    expect(list[1].topic).toBe("Second");
  });
});

describe("listDecisionsByChangeSet", () => {
  test("returns decisions for the change set", () => {
    const cs = newCs("004");
    createDecision(db, decisionInput(cs));
    createDecision(db, decisionInput(cs));
    expect(listDecisionsByChangeSet(db, cs.id)).toHaveLength(2);
  });
});

describe("exportToJSONL", () => {
  test("writes valid JSONL file with all decisions", () => {
    const cs = newCs("005");
    createDecision(db, decisionInput(cs, { topic: "D1" }));
    createDecision(db, decisionInput(cs, { topic: "D2" }));
    createDecision(db, decisionInput(cs, { topic: "D3" }));

    const outPath = exportToJSONL(db, cs.task_id, REPO_ROOT);
    expect(existsSync(outPath)).toBe(true);

    const lines = readFileSync(outPath, "utf-8").trim().split("\n");
    expect(lines).toHaveLength(3);
    for (const line of lines) {
      expect(() => JSON.parse(line)).not.toThrow();
      const obj = JSON.parse(line) as { topic: string; options_considered: string[] };
      expect(Array.isArray(obj.options_considered)).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// MCP tool layer
// ---------------------------------------------------------------------------

describe("log_decision MCP tool", () => {
  test("creates a decision entry and returns decisionId", async () => {
    const cs = newCs("001");
    const result = await handleLogDecision(decisionInput(cs), db);
    const data = JSON.parse(result.content[0].text) as { decisionId: string };
    expect(data.decisionId).toMatch(/^DEC-\d{6}$/);

    const list = listDecisionsByTask(db, cs.task_id);
    expect(list).toHaveLength(1);
  });

  test("rejects empty rationale", async () => {
    const cs = newCs("002");
    const result = await handleLogDecision(decisionInput(cs, { rationale: "" }), db);
    const data = JSON.parse(result.content[0].text) as { error: string };
    expect(result.isError).toBe(true);
    expect(data.error).toContain("rationale");
  });

  test("rejects empty topic", async () => {
    const cs = newCs("003");
    const result = await handleLogDecision(decisionInput(cs, { topic: "" }), db);
    expect(result.isError).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// REST API layer
// ---------------------------------------------------------------------------

describe("decisions REST API", () => {
  test("GET /api/tasks/:id/decisions returns empty list", async () => {
    const cs = newCs("001");
    const { server } = createApiServer({ db, port: 0 });
    const res = await fetch(`http://localhost:${server.port}/api/tasks/${cs.task_id}/decisions`);
    expect(res.status).toBe(200);
    const data = await res.json() as unknown[];
    expect(data).toHaveLength(0);
    server.stop();
  });

  test("POST /api/tasks/:id/decisions creates decision", async () => {
    const cs = newCs("002");
    const { server } = createApiServer({ db, port: 0 });
    const res = await fetch(
      `http://localhost:${server.port}/api/tasks/${cs.task_id}/decisions`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          changeSetId: cs.id,
          topic: "REST test",
          optionsConsidered: ["X", "Y"],
          choice: "X",
          rationale: "X is better",
        }),
      }
    );
    expect(res.status).toBe(201);
    const data = await res.json() as { id: string };
    expect(data.id).toMatch(/^DEC-/);
    server.stop();
  });

  test("GET /api/change-sets/:id/decisions returns decisions", async () => {
    const cs = newCs("003");
    createDecision(db, decisionInput(cs));
    const { server } = createApiServer({ db, port: 0 });
    const res = await fetch(`http://localhost:${server.port}/api/change-sets/${cs.id}/decisions`);
    expect(res.status).toBe(200);
    const data = await res.json() as unknown[];
    expect(data).toHaveLength(1);
    server.stop();
  });

  test("POST returns 400 for missing rationale", async () => {
    const cs = newCs("004");
    const { server } = createApiServer({ db, port: 0 });
    const res = await fetch(
      `http://localhost:${server.port}/api/tasks/${cs.task_id}/decisions`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          changeSetId: cs.id,
          topic: "Bad",
          optionsConsidered: ["A"],
          choice: "A",
          rationale: "",
        }),
      }
    );
    expect(res.status).toBe(400);
    server.stop();
  });
});
