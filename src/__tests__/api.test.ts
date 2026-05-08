import { describe, test, expect, beforeAll, afterAll, beforeEach } from "bun:test";
import { resolve, join } from "node:path";
import { mkdirSync, writeFileSync, mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { openTestDb } from "../db.js";
import { SSEBroadcaster, type SSEEvent } from "../api/sse.js";
import { createApiServer } from "../api/server.js";

const MIGRATIONS_DIR = resolve(process.cwd(), "migrations");

async function getJson<T = Record<string, unknown>>(res: Response): Promise<T> {
  return res.json() as Promise<T>;
}

let db: ReturnType<typeof openTestDb>;
let sse: SSEBroadcaster;
let server: ReturnType<typeof Bun.serve>;
let BASE: string;

let topLevelApiToken: string | undefined;
beforeAll(() => {
  topLevelApiToken = process.env.API_TOKEN;
  delete process.env.API_TOKEN; // ensure server starts without auth
  db = openTestDb(MIGRATIONS_DIR);
  sse = new SSEBroadcaster();
  const result = createApiServer({ db, sse, port: 0 }); // port 0 = random
  server = result.server;
  BASE = `http://localhost:${server.port}`;
});

afterAll(() => {
  if (topLevelApiToken === undefined) {
    delete process.env.API_TOKEN;
  } else {
    process.env.API_TOKEN = topLevelApiToken;
  }
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
// Quick-create endpoint (localsdlc new command)
// ---------------------------------------------------------------------------

describe("POST /api/change-sets/quick-create", () => {
  test("creates a ChangeSet with auto-generated IDs from title only", async () => {
    const res = await fetch(`${BASE}/api/change-sets/quick-create`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Add dark mode" }),
    });
    expect(res.status).toBe(201);
    const cs = await getJson<{
      id: string; task_id: string; source_branch: string; worktree_path: string;
    }>(res);
    expect(cs.id).toMatch(/^chg_\d{6}$/);
    expect(cs.task_id).toMatch(/^TSK_\d{6}$/);
    expect(cs.source_branch).toMatch(/^feat\/tsk-\d{6}$/);
    expect(cs.worktree_path).toMatch(/^\.work\/worktrees\/TSK_\d{6}$/);
  });

  test("returns 400 for missing title", async () => {
    const res = await fetch(`${BASE}/api/change-sets/quick-create`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// Status filter on GET /api/change-sets
// ---------------------------------------------------------------------------

describe("GET /api/change-sets?status=", () => {
  test("filters by status", async () => {
    const csRes = await fetch(`${BASE}/api/change-sets`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        task_id: "TSK_000555",
        title: "Status filter test",
        source_branch: "feat/TSK-000555",
        worktree_path: ".work/worktrees/TSK-000555",
      }),
    });
    const cs = await getJson<{ id: string }>(csRes);
    const csId = cs.id;

    // Transition to planned
    await fetch(`${BASE}/api/change-sets/${csId}/status`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "planned" }),
    });

    const planned = await fetch(`${BASE}/api/change-sets?status=planned`);
    const list = await getJson<{ id: string; status: string }[]>(planned);
    expect(list.every((cs) => cs.status === "planned")).toBe(true);
    expect(list.some((cs) => cs.id === csId)).toBe(true);

    const draft = await fetch(`${BASE}/api/change-sets?status=draft`);
    const draftList = await getJson<{ id: string }[]>(draft);
    expect(draftList.some((cs) => cs.id === csId)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// GitHub issue import endpoint
// ---------------------------------------------------------------------------

describe("POST /api/change-sets/from-github-issue", () => {
  let importedId: string;

  test("creates a ChangeSet with auto-generated task_id / branch / worktree", async () => {
    const res = await fetch(`${BASE}/api/change-sets/from-github-issue`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "Fix login page crash",
        githubIssueUrl: "https://github.com/example/repo/issues/42",
        specContent: "## Problem\nLogin page crashes on mobile.",
      }),
    });
    expect(res.status).toBe(201);
    const cs = await getJson<{
      id: string; task_id: string; source_branch: string;
      worktree_path: string; github_issue_url: string; spec_content: string;
    }>(res);
    expect(cs.id).toMatch(/^chg_\d{6}$/);
    expect(cs.task_id).toMatch(/^TSK_\d{6}$/);
    expect(cs.source_branch).toMatch(/^feat\/tsk-\d{6}$/);
    expect(cs.worktree_path).toMatch(/^\.work\/worktrees\/TSK_\d{6}$/);
    expect(cs.github_issue_url).toBe("https://github.com/example/repo/issues/42");
    expect(cs.spec_content).toBe("## Problem\nLogin page crashes on mobile.");
    importedId = cs.id;
  });

  test("returns 400 for missing title", async () => {
    const res = await fetch(`${BASE}/api/change-sets/from-github-issue`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ githubIssueUrl: "https://github.com/example/repo/issues/43" }),
    });
    expect(res.status).toBe(400);
  });

  test("returns 400 for invalid githubIssueUrl", async () => {
    const res = await fetch(`${BASE}/api/change-sets/from-github-issue`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Test", githubIssueUrl: "not-a-url" }),
    });
    expect(res.status).toBe(400);
  });

  test("imported ChangeSet appears in GET /api/change-sets", async () => {
    const res = await fetch(`${BASE}/api/change-sets`);
    const list = await getJson<{ id: string }[]>(res);
    expect(list.some((cs) => cs.id === importedId)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// github-pr-url PATCH endpoint
// ---------------------------------------------------------------------------

describe("PATCH /api/change-sets/:id/github-pr-url", () => {
  let csId: string;

  test("sets github_pr_url on an existing ChangeSet", async () => {
    const createRes = await fetch(`${BASE}/api/change-sets`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        task_id: "TSK_000777",
        title: "PR URL test",
        source_branch: "feat/TSK-000777",
        worktree_path: ".work/worktrees/TSK-000777",
      }),
    });
    const cs = await getJson<{ id: string }>(createRes);
    csId = cs.id;

    const res = await fetch(`${BASE}/api/change-sets/${csId}/github-pr-url`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: "https://github.com/example/repo/pull/99" }),
    });
    expect(res.status).toBe(200);
    const updated = await getJson<{ github_pr_url: string }>(res);
    expect(updated.github_pr_url).toBe("https://github.com/example/repo/pull/99");
  });

  test("returns 404 for unknown ChangeSet", async () => {
    const res = await fetch(`${BASE}/api/change-sets/chg_999999/github-pr-url`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: "https://github.com/example/repo/pull/100" }),
    });
    expect(res.status).toBe(404);
  });

  test("returns 400 when url is missing", async () => {
    const res = await fetch(`${BASE}/api/change-sets/${csId}/github-pr-url`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// PR body endpoint
// ---------------------------------------------------------------------------

describe("GET /api/change-sets/:id/pr-body", () => {
  let csId: string;

  test("returns markdown PR body for an existing ChangeSet", async () => {
    const createRes = await fetch(`${BASE}/api/change-sets`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        task_id: "TSK_000888",
        title: "PR body test",
        source_branch: "feat/TSK-000888",
        worktree_path: ".work/worktrees/TSK-000888",
      }),
    });
    const cs = await getJson<{ id: string }>(createRes);
    csId = cs.id;

    const res = await fetch(`${BASE}/api/change-sets/${csId}/pr-body`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/markdown");
    const body = await res.text();
    expect(body).toContain("## Summary");
    expect(body).toContain("## Review Results");
    expect(body).toContain(csId);
  });

  test("returns 404 for unknown ChangeSet", async () => {
    const res = await fetch(`${BASE}/api/change-sets/chg_999998/pr-body`);
    expect(res.status).toBe(404);
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

// ---------------------------------------------------------------------------
// HITL Gate API — PRD-006
// ---------------------------------------------------------------------------

// Helper: creates a ChangeSet and advances it to "reviewing" via valid FSM transitions
async function makeCsInReviewing(base: string): Promise<string> {
  const qc = await fetch(`${base}/api/change-sets/quick-create`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title: "HITL test CS" }),
  });
  const cs = (await qc.json()) as { id: string };

  // Advance through valid transitions: draft → planned → implementing → reviewing
  for (const status of ["planned", "implementing", "reviewing"] as const) {
    await fetch(`${base}/api/change-sets/${cs.id}/status`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
  }
  return cs.id;
}

describe("HITL Gate — POST /api/change-sets/:id/status trigger=approve (PRD-006)", () => {
  test("pauses ChangeSet in awaiting_human_approval and returns approvalId (PRD-006: approve trigger pauses FSM)", async () => {
    const csId = await makeCsInReviewing(BASE);
    const res = await fetch(`${BASE}/api/change-sets/${csId}/status`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ trigger: "approve" }),
    });
    expect(res.status).toBe(202);
    const body = (await res.json()) as { status: string; approvalId: string };
    expect(body.status).toBe("awaiting_human_approval");
    expect(typeof body.approvalId).toBe("string");
  });
});

describe("HITL Gate — POST /api/approvals/:id/approve (PRD-006)", () => {
  let approvalId: string;
  let csId: string;

  beforeEach(async () => {
    csId = await makeCsInReviewing(BASE);
    const res = await fetch(`${BASE}/api/change-sets/${csId}/status`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ trigger: "approve" }),
    });
    const body = (await res.json()) as { approvalId: string };
    approvalId = body.approvalId;
  });

  test("approve resumes FSM → approved (PRD-006 acceptance: POST /api/approvals/:id/approve resumes FSM)", async () => {
    const res = await fetch(`${BASE}/api/approvals/${approvalId}/approve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ decided_by: "test" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { newStatus: string; decision: string };
    expect(body.decision).toBe("approved");
    expect(body.newStatus).toBe("approved");

    const cs = await fetch(`${BASE}/api/change-sets/${csId}`);
    const csBody = (await cs.json()) as { status: string };
    expect(csBody.status).toBe("approved");
  });

  test("reject transitions to changes_requested (PRD-006 acceptance: POST /api/approvals/:id/reject)", async () => {
    const res = await fetch(`${BASE}/api/approvals/${approvalId}/reject`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason: "security concern", decided_by: "test" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { newStatus: string; decision: string };
    expect(body.decision).toBe("rejected");
    expect(body.newStatus).toBe("changes_requested");

    const cs = await fetch(`${BASE}/api/change-sets/${csId}`);
    const csBody = (await cs.json()) as { status: string };
    expect(csBody.status).toBe("changes_requested");
  });

  test("reject without reason returns 400 (PRD-006 failure_conditions: reason is required)", async () => {
    const res = await fetch(`${BASE}/api/approvals/${approvalId}/reject`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ decided_by: "test" }),
    });
    expect(res.status).toBe(400);
  });

  test("GET /api/approvals/by-changeset/:id returns list with pending approval (PRD-006)", async () => {
    const res = await fetch(`${BASE}/api/approvals/by-changeset/${csId}`);
    expect(res.status).toBe(200);
    const list = (await res.json()) as Array<{ id: string; decided_at: null }>;
    expect(list.length).toBeGreaterThan(0);
    expect(list.some((a) => a.id === approvalId)).toBe(true);
  });
});

describe("HITL Gate — 404 for unknown approvalId (PRD-006 failure_conditions)", () => {
  const unknown = "00000000-0000-0000-0000-000000000000";

  test("GET /api/approvals/:id returns 404 for non-existent id", async () => {
    const res = await fetch(`${BASE}/api/approvals/${unknown}`);
    expect(res.status).toBe(404);
  });

  test("POST /api/approvals/:id/approve returns 404 for non-existent id", async () => {
    const res = await fetch(`${BASE}/api/approvals/${unknown}/approve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ decided_by: "test" }),
    });
    expect(res.status).toBe(404);
  });

  test("POST /api/approvals/:id/reject returns 404 for non-existent id", async () => {
    const res = await fetch(`${BASE}/api/approvals/${unknown}/reject`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason: "n/a" }),
    });
    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// SSE export event — PRD-017
// ---------------------------------------------------------------------------

class CapturingSSE extends SSEBroadcaster {
  captured: SSEEvent[] = [];
  emit(event: SSEEvent) {
    this.captured.push(event);
    super.emit(event);
  }
}

describe("PATCH /api/change-sets/:id/github-pr-url emits exported SSE event (PRD-017)", () => {
  let capDb: ReturnType<typeof openTestDb>;
  let capSse: CapturingSSE;
  let capServer: ReturnType<typeof Bun.serve>;
  let capBase: string;

  beforeAll(() => {
    capDb = openTestDb(MIGRATIONS_DIR);
    capSse = new CapturingSSE();
    const result = createApiServer({ db: capDb, sse: capSse, port: 0 });
    capServer = result.server;
    capBase = `http://localhost:${capServer.port}`;
  });

  afterAll(() => {
    capSse.close();
    capServer.stop(true);
    capDb.close();
  });

  test("emits { type: 'exported', changeSetId, prUrl } after PATCH (PRD-017: export updates github_pr_url + emits SSE)", async () => {
    const qc = await fetch(`${capBase}/api/change-sets/quick-create`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "SSE export test" }),
    });
    const cs = (await qc.json()) as { id: string };

    const prUrl = "https://github.com/example/repo/pull/42";
    const before = capSse.captured.length;
    const res = await fetch(`${capBase}/api/change-sets/${cs.id}/github-pr-url`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: prUrl }),
    });
    expect(res.status).toBe(200);

    const exportedEvents = capSse.captured.slice(before).filter((e) => e.type === "exported");
    expect(exportedEvents.length).toBe(1);
    expect(exportedEvents[0].payload.changeSetId).toBe(cs.id);
    expect(exportedEvents[0].payload.prUrl).toBe(prUrl);
  });
});

// ---------------------------------------------------------------------------
// from-github-issue writes spec.md — PRD-017
// ---------------------------------------------------------------------------

describe("POST /api/change-sets/from-github-issue writes spec.md (PRD-017)", () => {
  let tmpDir: string;
  let tmpDb: ReturnType<typeof openTestDb>;
  let tmpSse: SSEBroadcaster;
  let tmpServer: ReturnType<typeof Bun.serve>;
  let tmpBase: string;

  beforeAll(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "agent-handoff-spec-test-"));
    tmpDb = openTestDb(MIGRATIONS_DIR);
    tmpSse = new SSEBroadcaster();
    const result = createApiServer({ db: tmpDb, sse: tmpSse, port: 0, repoRoot: tmpDir });
    tmpServer = result.server;
    tmpBase = `http://localhost:${tmpServer.port}`;
  });

  afterAll(() => {
    tmpSse.close();
    tmpServer.stop(true);
    tmpDb.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("writes issue body to .work/tasks/:taskId/spec.md (PRD-017 acceptance: import-issue writes spec.md)", async () => {
    const specContent = "## Problem\nUsers cannot log in after password reset.";
    const res = await fetch(`${tmpBase}/api/change-sets/from-github-issue`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "Fix password reset login",
        githubIssueUrl: "https://github.com/example/repo/issues/77",
        specContent,
      }),
    });
    expect(res.status).toBe(201);
    const cs = (await res.json()) as { task_id: string };

    const specPath = join(tmpDir, ".work", "tasks", cs.task_id, "spec.md");
    expect(existsSync(specPath)).toBe(true);
    expect(readFileSync(specPath, "utf-8")).toBe(specContent);
  });

  test("spec_content in DB is unchanged when specContent is omitted (no write error)", async () => {
    const res = await fetch(`${tmpBase}/api/change-sets/from-github-issue`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "No spec content issue",
        githubIssueUrl: "https://github.com/example/repo/issues/78",
      }),
    });
    expect(res.status).toBe(201);
    const cs = (await res.json()) as { task_id: string; spec_content: null };
    expect(cs.spec_content).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Bearer token auth (API_TOKEN)
// ---------------------------------------------------------------------------

describe("Bearer token auth", () => {
  const TEST_TOKEN = "test-bearer-secret-99";
  let authServer: ReturnType<typeof Bun.serve>;
  let authBase: string;

  let previousApiToken: string | undefined;
  beforeAll(() => {
    previousApiToken = process.env.API_TOKEN;
    process.env.API_TOKEN = TEST_TOKEN;
    const result = createApiServer({ db, sse, port: 0 });
    authServer = result.server;
    authBase = `http://localhost:${authServer.port}`;
  });

  afterAll(() => {
    if (previousApiToken === undefined) {
      delete process.env.API_TOKEN;
    } else {
      process.env.API_TOKEN = previousApiToken;
    }
    authServer.stop(true);
  });

  test("GET /api/health is always exempt — returns 200 without token", async () => {
    const res = await fetch(`${authBase}/api/health`);
    expect(res.status).toBe(200);
  });

  test("protected route without Authorization header returns 401 with WWW-Authenticate", async () => {
    const res = await fetch(`${authBase}/api/change-sets`);
    expect(res.status).toBe(401);
    const body = await res.json() as { error: string };
    expect(body.error).toBe("Unauthorized");
    expect(res.headers.get("WWW-Authenticate")).toBe('Bearer realm="agent-handoff"');
  });

  test("protected route with wrong token returns 401 with WWW-Authenticate", async () => {
    const res = await fetch(`${authBase}/api/change-sets`, {
      headers: { Authorization: "Bearer wrong-token" },
    });
    expect(res.status).toBe(401);
    expect(res.headers.get("WWW-Authenticate")).toBe('Bearer realm="agent-handoff"');
  });

  test("protected route with correct token returns 200", async () => {
    const res = await fetch(`${authBase}/api/change-sets`, {
      headers: { Authorization: `Bearer ${TEST_TOKEN}` },
    });
    expect(res.status).toBe(200);
  });

  test("lowercase 'bearer' scheme with correct token is accepted", async () => {
    const res = await fetch(`${authBase}/api/change-sets`, {
      headers: { Authorization: `bearer ${TEST_TOKEN}` },
    });
    expect(res.status).toBe(200);
  });

  test("UI origin (localhost:5173) is exempt without token", async () => {
    const res = await fetch(`${authBase}/api/change-sets`, {
      headers: { Origin: "http://localhost:5173" },
    });
    expect(res.status).toBe(200);
  });

  test("API port origin (localhost:4000) is NOT exempt — requires token", async () => {
    const res = await fetch(`${authBase}/api/change-sets`, {
      headers: { Origin: "http://localhost:4000" },
    });
    expect(res.status).toBe(401);
  });

  test("server without API_TOKEN set passes all requests through", async () => {
    const previousApiToken = process.env.API_TOKEN;
    delete process.env.API_TOKEN;

    const result = createApiServer({ db, sse, port: 0 });
    const unauthServer = result.server;
    const unauthBase = `http://localhost:${unauthServer.port}`;

    try {
      const res = await fetch(`${unauthBase}/api/change-sets`);
      expect(res.status).toBe(200);
    } finally {
      unauthServer.stop(true);
      if (previousApiToken === undefined) {
        delete process.env.API_TOKEN;
      } else {
        process.env.API_TOKEN = previousApiToken;
      }
    }
  });
});
