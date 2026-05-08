import { describe, it, expect, beforeEach } from "bun:test";
import { openTestDb } from "../db.js";
import type { Database } from "bun:sqlite";
import { upsertAssignment } from "../domain/agent-assignment.js";
import { registerSession, markBusy, getSession } from "../domain/agent-session.js";
import { dispatchToSession } from "../orchestrator/dispatcher.js";
import { AgentOrchestrator } from "../orchestrator/index.js";
import { spawnAgent, isToolSpawnable } from "../orchestrator/spawner.js";
import { handleClaimTask, handleCompleteTask } from "../mcp-tools/claim-task.js";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtempSync, existsSync } from "node:fs";

let db: Database;
let workRoot: string;

beforeEach(() => {
  db = openTestDb();
  workRoot = mkdtempSync(join(tmpdir(), "orch-test-"));
  // Seed a change_set + task for context builder (change_sets first due to FK)
  db.run(`INSERT INTO change_sets (id, task_id, title, description, source_branch, target_branch, worktree_path, status, created_at, updated_at)
    VALUES ('chg_001', 'TSK_001', 'Test', '', 'feat/TSK_001', 'main', '/tmp', 'implementing', '2024-01-01T00:00:00Z', '2024-01-01T00:00:00Z')`);
  db.run(`INSERT INTO tasks (id, change_set_id, title, spec_path, acceptance_path, created_at)
    VALUES ('TSK_001', 'chg_001', 'Test Task', '/tmp/spec.md', '/tmp/acceptance.md', '2024-01-01T00:00:00Z')`);
});

// ─── Dispatcher ────────────────────────────────────────────────────────────────

describe("dispatchToSession", () => {
  it("returns dispatched=false when no waiting session", () => {
    const result = dispatchToSession(db, "claude-code", "implementer", "chg_001");
    expect(result.dispatched).toBe(false);
  });

  it("dispatches to a waiting session and queues the task", () => {
    const session = registerSession(db, "claude-code", ["implementer"]);
    const result = dispatchToSession(db, "claude-code", "implementer", "chg_001");
    expect(result.dispatched).toBe(true);
    if (!result.dispatched) throw new Error("expected dispatched");
    expect(result.sessionId).toBe(session.id);

    // Queued columns should be set
    const row = db
      .query<{ queued_change_set_id: string | null; queued_role: string | null }, [string]>(
        "SELECT queued_change_set_id, queued_role FROM agent_sessions WHERE id = ?"
      )
      .get(session.id);
    expect(row?.queued_change_set_id).toBe("chg_001");
    expect(row?.queued_role).toBe("implementer");
  });

  it("does not dispatch to a busy session", () => {
    const session = registerSession(db, "claude-code", ["implementer"]);
    markBusy(db, session.id, "chg_001");
    const result = dispatchToSession(db, "claude-code", "implementer", "chg_001");
    expect(result.dispatched).toBe(false);
  });

  it("dispatches to session with empty roles (accepts any role)", () => {
    registerSession(db, "claude-code", []); // any role
    const result = dispatchToSession(db, "claude-code", "reviewer", "chg_001");
    expect(result.dispatched).toBe(true);
  });
});

// ─── Spawner ───────────────────────────────────────────────────────────────────

describe("isToolSpawnable", () => {
  it("returns true for CLI tools", () => {
    expect(isToolSpawnable("claude-code")).toBe(true);
    expect(isToolSpawnable("codex")).toBe(true);
    expect(isToolSpawnable("gemini")).toBe(true);
    expect(isToolSpawnable("copilot-cli")).toBe(true);
  });

  it("returns false for human", () => {
    expect(isToolSpawnable("human")).toBe(false);
  });
});

describe("spawnAgent", () => {
  it("throws when tool is human", () => {
    expect(() =>
      spawnAgent("human", { changeSetId: "chg_001", role: "reviewer", handoffContent: "x", workRoot })
    ).toThrow("Cannot spawn a human agent");
  });

  it("writes handoff.md to workRoot/tasks/<id>/handoff.md", () => {
    // We can't actually spawn claude without it being installed, so mock the spawn
    // by checking the handoff file is written (the spawn itself will fail, that's ok in tests)
    const ctx = { changeSetId: "chg_001", role: "implementer", handoffContent: "# Test handoff\nDo the thing.", workRoot };
    try {
      spawnAgent("claude-code", ctx);
    } catch {
      // spawn may fail if claude is not installed — that's acceptable in CI
    }
    const hPath = join(workRoot, "tasks", "chg_001", "handoff.md");
    expect(existsSync(hPath)).toBe(true);
    const { readFileSync } = require("node:fs");
    expect(readFileSync(hPath, "utf-8")).toContain("# Test handoff");
  });
});

// ─── claim_task MCP tool ────────────────────────────────────────────────────────

describe("handleClaimTask", () => {
  it("returns claimed=false when no task queued", async () => {
    const session = registerSession(db, "claude-code", ["implementer"]);
    const result = await handleClaimTask({ sessionId: session.id }, db);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.claimed).toBe(false);
  });

  it("returns error for unknown session", async () => {
    const result = await handleClaimTask({ sessionId: "nonexistent" }, db);
    expect(result.isError).toBe(true);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.error).toMatch(/not found/);
  });

  it("claims a queued task and marks session busy", async () => {
    const session = registerSession(db, "claude-code", ["implementer"]);
    // Simulate orchestrator queuing a task
    db.run(
      "UPDATE agent_sessions SET queued_change_set_id = ?, queued_role = ? WHERE id = ?",
      ["chg_001", "implementer", session.id]
    );

    const result = await handleClaimTask({ sessionId: session.id }, db);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.claimed).toBe(true);
    expect(parsed.changeSetId).toBe("chg_001");
    expect(parsed.role).toBe("implementer");

    // Session should now be busy
    const updated = getSession(db, session.id);
    expect(updated?.status).toBe("busy");
    expect(updated?.current_change_set_id).toBe("chg_001");

    // Queue columns should be cleared
    const row = db
      .query<{ queued_change_set_id: string | null }, [string]>(
        "SELECT queued_change_set_id FROM agent_sessions WHERE id = ?"
      )
      .get(session.id);
    expect(row?.queued_change_set_id).toBeNull();
  });

  it("refreshes heartbeat on each poll", async () => {
    const session = registerSession(db, "claude-code", []);
    const before = getSession(db, session.id)?.last_heartbeat;
    await new Promise((r) => setTimeout(r, 10));
    await handleClaimTask({ sessionId: session.id }, db);
    const after = getSession(db, session.id)?.last_heartbeat;
    expect(after! >= before!).toBe(true);
  });
});

describe("handleCompleteTask", () => {
  it("marks session waiting after task completion", () => {
    const session = registerSession(db, "claude-code", []);
    markBusy(db, session.id, "chg_001");
    const result = handleCompleteTask({ sessionId: session.id }, db);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.ok).toBe(true);
    const updated = getSession(db, session.id);
    expect(updated?.status).toBe("waiting");
    expect(updated?.current_change_set_id).toBeNull();
  });
});

// ─── AgentOrchestrator ─────────────────────────────────────────────────────────

describe("AgentOrchestrator", () => {
  it("skips when no assignment configured", async () => {
    // Use a state not in default seeds (007 migration only seeds implementing/reviewing/planned/changes_requested/merged)
    const orch = new AgentOrchestrator(db, { workRoot });
    const result = await orch.run("chg_001", "deploying", "deployer");
    expect(result.mode).toBe("skipped");
  });

  it("returns hitl mode when tool is human", async () => {
    upsertAssignment(db, { fsmState: "implementing", role: "implementer", tool: "human" });
    const orch = new AgentOrchestrator(db, { workRoot });
    const result = await orch.run("chg_001", "implementing", "implementer");
    expect(result.mode).toBe("hitl");
  });

  it("prefers dispatching to a waiting session over spawning", async () => {
    upsertAssignment(db, { fsmState: "implementing", role: "implementer", tool: "claude-code" });
    const session = registerSession(db, "claude-code", ["implementer"]);
    const orch = new AgentOrchestrator(db, { workRoot });
    const result = await orch.run("chg_001", "implementing", "implementer");
    expect(result.mode).toBe("dispatched");
    if (result.mode !== "dispatched") throw new Error("expected dispatched");
    expect(result.sessionId).toBe(session.id);
  });

  it("skips when already busy session exists for change set", async () => {
    upsertAssignment(db, { fsmState: "implementing", role: "implementer", tool: "claude-code" });
    const session = registerSession(db, "claude-code", ["implementer"]);
    markBusy(db, session.id, "chg_001");
    const orch = new AgentOrchestrator(db, { workRoot });
    const result = await orch.run("chg_001", "implementing", "implementer");
    expect(result.mode).toBe("skipped");
    const skipped = result as { mode: "skipped"; reason: string };
    expect(skipped.reason).toMatch(/already busy/);
  });

  it("skips when assignment is disabled", async () => {
    upsertAssignment(db, { fsmState: "implementing", role: "implementer", tool: "claude-code", enabled: false });
    const orch = new AgentOrchestrator(db, { workRoot });
    const result = await orch.run("chg_001", "implementing", "implementer");
    expect(result.mode).toBe("skipped");
  });
});
