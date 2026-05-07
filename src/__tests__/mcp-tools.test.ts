import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import type { Database } from "bun:sqlite";
import { resolve } from "node:path";
import { openTestDb } from "../db.js";
import { createChangeSet } from "../domain/change-set.js";
import { FSMEngine } from "../fsm/engine.js";
import { handleCreateChangeSet } from "../mcp-tools/create-change-set.js";
import { handleSubmitForReview } from "../mcp-tools/submit-for-review.js";
import { handleAddReviewComment } from "../mcp-tools/add-review-comment.js";
import { handleRequestChanges } from "../mcp-tools/request-changes.js";
import { handleApproveChangeSet } from "../mcp-tools/approve-change-set.js";
import { handleGetHandoffContext } from "../mcp-tools/get-handoff-context.js";
import { TOTAL_TOKEN_BUDGET } from "../context/slots.js";
import { resetRegistry } from "../roles/registry.js";
import { existsSync } from "node:fs";
import { createCheckRun, updateCheckRun } from "../domain/check-run.js";
import { REQUIRED_CHECK_NAMES } from "../checks/check-config.js";

const MIGRATIONS_DIR = resolve(process.cwd(), "migrations");
const REPO_ROOT = resolve(process.cwd());

let db: Database;

function parse(result: { content: { text: string }[] }) {
  return JSON.parse(result.content[0].text);
}

function newCs(db: Database, suffix = "001") {
  return createChangeSet(db, {
    task_id: `TSK_${suffix}`,
    title: `Test CS ${suffix}`,
    source_branch: `feat/TSK-${suffix}`,
    worktree_path: `.work/worktrees/TSK-${suffix}`,
  });
}

beforeEach(() => {
  db = openTestDb(MIGRATIONS_DIR);
  resetRegistry();
});

afterEach(async () => {
  // Clean up any worktrees created during tests
  const { WorktreeManager } = await import("../worktree/manager.js");
  const wm = new WorktreeManager(REPO_ROOT);
  for (const taskId of ["TSK_900001", "TSK_900002"]) {
    await wm.teardown(taskId, { deleteBranch: true }).catch(() => {});
  }
  db.close();
  resetRegistry();
});

// ---------------------------------------------------------------------------
// create_change_set
// ---------------------------------------------------------------------------

describe("create_change_set MCP tool", () => {
  test("creates ChangeSet + worktree + transitions to planned", async () => {
    const result = await handleCreateChangeSet(
      { taskId: "TSK_900001", title: "MCP tool test CS" },
      db,
      REPO_ROOT
    );
    const data = parse(result);
    expect(data.changeSetId).toMatch(/^chg_\d{6}$/);
    expect(data.status).toBe("planned");
    expect(data.worktreePath).toContain("TSK-900001");
    expect(existsSync(data.worktreePath)).toBe(true);

    // Verify DB state
    const row = db
      .query<{ status: string }, [string]>("SELECT status FROM change_sets WHERE id = ?")
      .get(data.changeSetId);
    expect(row?.status).toBe("planned");
  });

  test("returns error for invalid taskId", async () => {
    const result = await handleCreateChangeSet(
      { taskId: "INVALID", title: "Bad" },
      db,
      REPO_ROOT
    );
    const data = parse(result);
    expect(data.error).toBeTruthy();
    expect(result.isError).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// submit_for_review
// ---------------------------------------------------------------------------

describe("submit_for_review MCP tool", () => {
  test("transitions implementing → reviewing", async () => {
    const cs = newCs(db, "010");
    const fsm = new FSMEngine(db);
    fsm.transition(cs.id, "plan_accepted");
    fsm.transition(cs.id, "assign_implementer");

    const result = await handleSubmitForReview({ changeSetId: cs.id }, db);
    const data = parse(result);
    expect(data.status).toBe("reviewing");
  });

  test("returns error for invalid transition", async () => {
    const cs = newCs(db, "011"); // status: draft
    const result = await handleSubmitForReview({ changeSetId: cs.id }, db);
    const data = parse(result);
    expect(data.error).toBeTruthy();
    expect(result.isError).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// add_review_comment
// ---------------------------------------------------------------------------

describe("add_review_comment MCP tool", () => {
  test("creates a blocking comment and returns commentId", async () => {
    const cs = newCs(db, "020");
    const result = await handleAddReviewComment(
      {
        changeSetId: cs.id,
        body: "This is broken",
        severity: "blocking",
        filePath: "src/foo.ts",
        lineNumber: 42,
      },
      db
    );
    const data = parse(result);
    expect(data.commentId).toMatch(/^cmt_/);
    expect(data.severity).toBe("blocking");

    // Verify in DB
    const row = db
      .query<{ body: string; severity: string }, [string]>(
        "SELECT body, severity FROM review_comments WHERE id = ?"
      )
      .get(data.commentId);
    expect(row?.body).toBe("This is broken");
    expect(row?.severity).toBe("blocking");
  });

  test("returns error for unknown changeSetId", async () => {
    const result = await handleAddReviewComment(
      { changeSetId: "chg_999999", body: "x", severity: "nit" },
      db
    );
    expect(result.isError).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// request_changes
// ---------------------------------------------------------------------------

describe("request_changes MCP tool", () => {
  test("fails with zero blocking comments", async () => {
    const cs = newCs(db, "030");
    const fsm = new FSMEngine(db);
    fsm.transition(cs.id, "plan_accepted");
    fsm.transition(cs.id, "assign_implementer");
    fsm.transition(cs.id, "submit_for_review");

    const result = await handleRequestChanges(
      { changeSetId: cs.id, summary: "needs work" },
      db
    );
    const data = parse(result);
    expect(data.error).toContain("no blocking review comments");
    expect(result.isError).toBe(true);
  });

  test("succeeds with at least one blocking comment", async () => {
    const cs = newCs(db, "031");
    const fsm = new FSMEngine(db);
    fsm.transition(cs.id, "plan_accepted");
    fsm.transition(cs.id, "assign_implementer");
    fsm.transition(cs.id, "submit_for_review");

    // Add blocking comment
    await handleAddReviewComment(
      { changeSetId: cs.id, body: "Fix this", severity: "blocking" },
      db
    );

    const result = await handleRequestChanges(
      { changeSetId: cs.id, summary: "needs work" },
      db
    );
    const data = parse(result);
    expect(data.status).toBe("changes_requested");
    expect(data.blockingCommentCount).toBeGreaterThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// approve_change_set
// ---------------------------------------------------------------------------

function seedPassedChecks(db: Database, changeSetId: string) {
  for (const name of REQUIRED_CHECK_NAMES) {
    const run = createCheckRun(db, changeSetId, name);
    updateCheckRun(db, run.id, {
      status: "passed",
      exitCode: 0,
      completedAt: new Date().toISOString(),
    });
  }
}

describe("approve_change_set MCP tool", () => {
  test("transitions reviewing → awaiting_human_approval (HITL gates approve trigger)", async () => {
    const cs = newCs(db, "040");
    const fsm = new FSMEngine(db);
    fsm.transition(cs.id, "plan_accepted");
    fsm.transition(cs.id, "assign_implementer");
    fsm.transition(cs.id, "submit_for_review");
    seedPassedChecks(db, cs.id);

    const result = await handleApproveChangeSet(
      { changeSetId: cs.id, summary: "LGTM" },
      db
    );
    const data = parse(result);
    expect(result.isError).toBeFalsy();
    expect(data.status).toBe("awaiting_human_approval");
    expect(data.approvalId).toBeDefined();
  });

  test("transitions reviewing → approved when HITL disabled", async () => {
    process.env.LOCALSDLC_HITL_ENABLED = "false";
    try {
      const cs = newCs(db, "043");
      const fsm = new FSMEngine(db);
      fsm.transition(cs.id, "plan_accepted");
      fsm.transition(cs.id, "assign_implementer");
      fsm.transition(cs.id, "submit_for_review");
      seedPassedChecks(db, cs.id);

      const result = await handleApproveChangeSet(
        { changeSetId: cs.id, summary: "LGTM" },
        db
      );
      const data = parse(result);
      expect(result.isError).toBeFalsy();
      expect(data.status).toBe("approved");
    } finally {
      delete process.env.LOCALSDLC_HITL_ENABLED;
    }
  });

  test("returns error when required checks have not passed", async () => {
    const cs = newCs(db, "042");
    const fsm = new FSMEngine(db);
    fsm.transition(cs.id, "plan_accepted");
    fsm.transition(cs.id, "assign_implementer");
    fsm.transition(cs.id, "submit_for_review");
    // Seed a failed check
    const run = createCheckRun(db, cs.id, "typecheck");
    updateCheckRun(db, run.id, { status: "failed", exitCode: 1, completedAt: new Date().toISOString() });

    const result = await handleApproveChangeSet(
      { changeSetId: cs.id, summary: "LGTM" },
      db
    );
    const data = parse(result);
    expect(data.error).toContain("required checks failed");
    expect(result.isError).toBe(true);
  });

  test("returns error for invalid transition (draft → approve)", async () => {
    const cs = newCs(db, "041"); // draft, no checks seeded
    const result = await handleApproveChangeSet(
      { changeSetId: cs.id, summary: "LGTM" },
      db
    );
    expect(result.isError).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// get_handoff_context
// ---------------------------------------------------------------------------

describe("get_handoff_context MCP tool", () => {
  test("returns context with tokenEstimate <= 9728", async () => {
    const cs = newCs(db, "000050");
    const result = await handleGetHandoffContext(
      { changeSetId: cs.id, role: "reviewer" },
      db,
      REPO_ROOT
    );
    const data = parse(result);
    expect(data.tokenEstimate).toBeLessThanOrEqual(TOTAL_TOKEN_BUDGET);
    expect(data.context).toBeDefined();
    expect(data.context.taskSpec).toBeTruthy();
  });

  test("returns error for unknown role", async () => {
    const cs = newCs(db, "000051");
    const result = await handleGetHandoffContext(
      { changeSetId: cs.id, role: "nonexistent_role" },
      db,
      REPO_ROOT
    );
    expect(result.isError).toBe(true);
  });

  test("returns error for unknown changeSetId", async () => {
    const result = await handleGetHandoffContext(
      { changeSetId: "chg_999999", role: "reviewer" },
      db,
      REPO_ROOT
    );
    expect(result.isError).toBe(true);
  });
});
