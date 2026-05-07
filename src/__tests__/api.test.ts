import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { resolve } from "node:path";
import { mkdirSync, writeFileSync } from "node:fs";
import { openTestDb } from "../db.js";
import { SSEBroadcaster } from "../api/sse.js";
import { createApiServer } from "../api/server.js";

const MIGRATIONS_DIR = resolve(process.cwd(), "migrations");

async function getJson<T = Record<string, unknown>>(res: Response): Promise<T> {
  return res.json() as Promise<T>;
}

let db: ReturnType<typeof openTestDb>;
let sse: SSEBroadcaster;
let server: ReturnType<typeof Bun.serve>;
let BASE: string;

beforeAll(() => {
  db = openTestDb(MIGRATIONS_DIR);
  sse = new SSEBroadcaster();
  const result = createApiServer({ db, sse, port: 0 }); // port 0 = random
  server = result.server;
  BASE = `http://localhost:${server.port}`;
});

afterAll(() => {
  sse.close();
  server.stop(true);
  db.close();
});

// ---------------------------------------------------------------------------
// Health
// ---------------------------------------------------------------------------

describe("GET /api/health", () => {
  test("returns 200 with ok: true", async () => {
    const res = await fetch(`${BASE}/api/health`);
    expect(res.status).toBe(200);
    const body = await getJson(res);
    expect(body.ok).toBe(true);
    expect(typeof body.ts).toBe("string");
  });
});

// ---------------------------------------------------------------------------
// ChangeSet REST endpoints
// ---------------------------------------------------------------------------

describe("ChangeSet REST API", () => {
  let csId: string;

  test("POST /api/change-sets creates a ChangeSet", async () => {
    const res = await fetch(`${BASE}/api/change-sets`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        task_id: "TSK_000001",
        title: "REST test change set",
        source_branch: "feat/TSK-000001",
        worktree_path: ".work/worktrees/TSK-000001",
      }),
    });
    expect(res.status).toBe(201);
    const cs = await getJson<{ id: string; title: string; status: string }>(res);
    expect(cs.id).toMatch(/^chg_\d{6}$/);
    expect(cs.title).toBe("REST test change set");
    expect(cs.status).toBe("draft");
    csId = cs.id;
  });

  test("GET /api/change-sets returns array with created ChangeSet", async () => {
    const res = await fetch(`${BASE}/api/change-sets`);
    expect(res.status).toBe(200);
    const list = await getJson<{ id: string }[]>(res);
    expect(Array.isArray(list)).toBe(true);
    expect(list.some((cs) => cs.id === csId)).toBe(true);
  });

  test("GET /api/change-sets/:id returns the ChangeSet", async () => {
    const res = await fetch(`${BASE}/api/change-sets/${csId}`);
    expect(res.status).toBe(200);
    const cs = await getJson(res);
    expect(cs.id).toBe(csId);
  });

  test("GET /api/change-sets/:id returns 404 for unknown ID", async () => {
    const res = await fetch(`${BASE}/api/change-sets/chg_999999`);
    expect(res.status).toBe(404);
  });

  test("PATCH /api/change-sets/:id/status transitions status", async () => {
    const res = await fetch(`${BASE}/api/change-sets/${csId}/status`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "planned" }),
    });
    expect(res.status).toBe(200);
    const cs = await getJson(res);
    expect(cs.status).toBe("planned");
  });

  test("PATCH /api/change-sets/:id/status rejects invalid transition", async () => {
    const res = await fetch(`${BASE}/api/change-sets/${csId}/status`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "merged" }),
    });
    expect(res.status).toBe(422);
    const body = await getJson(res);
    expect(body.error).toContain("Invalid transition");
  });

  test("POST /api/change-sets returns 400 for missing fields", async () => {
    const res = await fetch(`${BASE}/api/change-sets`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "no task_id" }),
    });
    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// Task REST endpoints
// ---------------------------------------------------------------------------

describe("Task REST API", () => {
  let csId: string;
  let taskId: string;

  test("POST /api/tasks creates a Task", async () => {
    // First create a ChangeSet to link to
    const csRes = await fetch(`${BASE}/api/change-sets`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        task_id: "TSK_000002",
        title: "Task parent CS",
        source_branch: "feat/TSK-000002",
        worktree_path: ".work/worktrees/TSK-000002",
      }),
    });
    const cs = await getJson<{ id: string }>(csRes);
    csId = cs.id;

    const res = await fetch(`${BASE}/api/tasks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        change_set_id: csId,
        title: "Implement feature",
        spec_path: ".work/tasks/TSK_000002/spec.md",
        acceptance_path: ".work/tasks/TSK_000002/acceptance.md",
      }),
    });
    expect(res.status).toBe(201);
    const task = await getJson<{ id: string; status: string }>(res);
    expect(task.id).toMatch(/^TSK_\d{6}$/);
    expect(task.status).toBe("backlog");
    taskId = task.id;
  });

  test("GET /api/tasks returns all tasks", async () => {
    const res = await fetch(`${BASE}/api/tasks`);
    expect(res.status).toBe(200);
    const list = await getJson<{ id: string }[]>(res);
    expect(Array.isArray(list)).toBe(true);
    expect(list.some((t) => t.id === taskId)).toBe(true);
  });

  test("GET /api/tasks?changeSetId=... filters correctly", async () => {
    const res = await fetch(`${BASE}/api/tasks?changeSetId=${csId}`);
    expect(res.status).toBe(200);
    const list = await getJson<{ change_set_id: string }[]>(res);
    expect(list.every((t) => t.change_set_id === csId)).toBe(true);
  });

  test("GET /api/tasks/:id returns the task", async () => {
    const res = await fetch(`${BASE}/api/tasks/${taskId}`);
    expect(res.status).toBe(200);
    const task = await getJson<{ id: string }>(res);
    expect(task.id).toBe(taskId);
  });
});

// ---------------------------------------------------------------------------
// SSE event emission
// ---------------------------------------------------------------------------

describe("SSE event emission", () => {
  test("SSEBroadcaster emits change_set_created event on POST", async () => {
    const received: unknown[] = [];

    // Subscribe to SSE
    const controller = new AbortController();
    const ssePromise = fetch(`${BASE}/events/stream`, {
      signal: controller.signal,
    }).then(async (res) => {
      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n\n");
        buf = lines.pop() ?? "";
        for (const block of lines) {
          const dataLine = block.split("\n").find((l) => l.startsWith("data:"));
          if (dataLine) {
            try {
              received.push(JSON.parse(dataLine.slice(5).trim()));
            } catch {}
          }
        }
        if (received.length > 0) break;
      }
      reader.cancel();
    }).catch(() => {});

    // Small delay to let SSE connection establish
    await new Promise((r) => setTimeout(r, 100));

    // Create a ChangeSet (should emit event)
    await fetch(`${BASE}/api/change-sets`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        task_id: "TSK_000099",
        title: "SSE test",
        source_branch: "feat/TSK-000099",
        worktree_path: ".work/worktrees/TSK-000099",
      }),
    });

    // Wait for event (up to 1s)
    const deadline = Date.now() + 1000;
    while (received.length === 0 && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 50));
    }

    controller.abort();
    await ssePromise;

    expect(received.some((e: any) => e.type === "change_set_created")).toBe(true);
  });

  test("SSEBroadcaster subscriber count increases during connection", async () => {
    const controller = new AbortController();
    // Start fetch but don't await — connection is pending
    const fetchPromise = fetch(`${BASE}/events/stream`, {
      signal: controller.signal,
    }).then((r) => {
      // Keep reading to maintain connection
      return r.body?.getReader().read();
    }).catch(() => {});

    // Wait for connection to establish and subscriber to be registered
    await new Promise((r) => setTimeout(r, 150));

    const during = sse.subscriberCount();
    controller.abort();
    await fetchPromise;

    expect(during).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Log-tail SSE
// ---------------------------------------------------------------------------

describe("Log-tail SSE", () => {
  test("watchLog emits agent_output events when log file is written", async () => {
    const taskId = "TSK_000088";
    const logsDir = resolve(process.cwd(), ".work", "logs");
    mkdirSync(logsDir, { recursive: true });
    const logPath = resolve(logsDir, `${taskId}.log`);

    sse.watchLog(taskId);

    const received: unknown[] = [];
    const controller = new AbortController();

    const ssePromise = fetch(`${BASE}/events/stream`, {
      signal: controller.signal,
    }).then(async (res) => {
      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n\n");
        buf = lines.pop() ?? "";
        for (const block of lines) {
          const dataLine = block.split("\n").find((l) => l.startsWith("data:"));
          if (dataLine) {
            try {
              const evt = JSON.parse(dataLine.slice(5).trim());
              if (evt.type === "agent_output") received.push(evt);
            } catch {}
          }
        }
        if (received.length > 0) break;
      }
      reader.cancel();
    }).catch(() => {});

    await new Promise((r) => setTimeout(r, 100));

    writeFileSync(logPath, "Hello from agent\n", "utf-8");

    const deadline = Date.now() + 1000;
    while (received.length === 0 && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 50));
    }

    controller.abort();
    await ssePromise;
    sse.stopWatchLog(taskId);

    expect(received.length).toBeGreaterThan(0);
    expect((received[0] as any).payload.taskId).toBe(taskId);
  });
});

// ---------------------------------------------------------------------------
// CORS headers
// ---------------------------------------------------------------------------

describe("CORS headers", () => {
  test("responses include Access-Control-Allow-Origin", async () => {
    const res = await fetch(`${BASE}/api/health`, {
      headers: { Origin: "http://localhost:5173" },
    });
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe(
      "http://localhost:5173"
    );
  });

  test("OPTIONS preflight returns 204", async () => {
    const res = await fetch(`${BASE}/api/change-sets`, {
      method: "OPTIONS",
      headers: { Origin: "http://localhost:5173" },
    });
    expect(res.status).toBe(204);
  });
});
