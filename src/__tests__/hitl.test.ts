import { describe, test, expect, beforeEach } from "bun:test";
import { openTestDb } from "../db.js";
import { HITLGate, HITLPendingError } from "../fsm/hitl.js";
import { createChangeSet } from "../domain/change-set.js";
import { FSMEngine } from "../fsm/engine.js";
import type { Database } from "bun:sqlite";

function makeDb(): Database {
  return openTestDb();
}

function makeChangeSet(db: Database, status = "reviewing") {
  const cs = createChangeSet(db, {
    title: "Test",
    description: "",
    source_branch: "feat/test",
    target_branch: "main",
    worktree_path: ".work/worktrees/test",
    task_id: "TSK_000001",
  });
  // Advance to desired status via direct DB update (bypasses FSM for test setup)
  if (status !== "draft") {
    db.run("UPDATE change_sets SET status = ? WHERE id = ?", [status, cs.id]);
  }
  return cs;
}

// ── Gate disabled (HITL_ENABLED=false) ───────────────────────────────────────

describe("HITLGate — disabled mode", () => {
  test("passes all triggers through to FSM when disabled", () => {
    const db = makeDb();
    const gate = new HITLGate(db, undefined, { enabled: false, gatedTriggers: ["approve"] });
    const cs = makeChangeSet(db, "reviewing");

    const result = gate.transition(cs.id, "approve");
    expect(result.status).toBe("ok");
    expect((result as { status: "ok"; newStatus: string }).newStatus).toBe("approved");
  });
});

// ── Gate enabled — approve trigger ───────────────────────────────────────────

describe("HITLGate — approve trigger", () => {
  test("pauses in awaiting_human_approval", () => {
    const db = makeDb();
    const gate = new HITLGate(db, undefined, { enabled: true, gatedTriggers: ["approve"] });
    const cs = makeChangeSet(db, "reviewing");

    const result = gate.transition(cs.id, "approve");
    expect(result.status).toBe("pending");

    const row = db.query<{ status: string }, [string]>(
      "SELECT status FROM change_sets WHERE id = ?"
    ).get(cs.id);
    expect(row?.status).toBe("awaiting_human_approval");
  });

  test("inserts hitl_approvals row with trigger", () => {
    const db = makeDb();
    const gate = new HITLGate(db, undefined, { enabled: true, gatedTriggers: ["approve"] });
    const cs = makeChangeSet(db, "reviewing");

    const result = gate.transition(cs.id, "approve") as { status: "pending"; approvalId: string };
    const row = gate.getApproval(result.approvalId);
    expect(row).not.toBeNull();
    expect(row!.trigger).toBe("approve");
    expect(row!.decided_at).toBeNull();
  });

  test("approve() resumes FSM → approved", () => {
    const db = makeDb();
    const gate = new HITLGate(db, undefined, { enabled: true, gatedTriggers: ["approve"] });
    const cs = makeChangeSet(db, "reviewing");

    const result = gate.transition(cs.id, "approve") as { status: "pending"; approvalId: string };
    const newStatus = gate.approve(result.approvalId, "jason");
    expect(newStatus).toBe("approved");

    const row = gate.getApproval(result.approvalId);
    expect(row!.decision).toBe("approved");
    expect(row!.decided_by).toBe("jason");
  });

  test("reject() transitions to changes_requested", () => {
    const db = makeDb();
    const gate = new HITLGate(db, undefined, { enabled: true, gatedTriggers: ["approve"] });
    const cs = makeChangeSet(db, "reviewing");

    const result = gate.transition(cs.id, "approve") as { status: "pending"; approvalId: string };
    const newStatus = gate.reject(result.approvalId, "security concern", "jason");
    expect(newStatus).toBe("changes_requested");

    const row = gate.getApproval(result.approvalId);
    expect(row!.decision).toBe("rejected");
    expect(row!.reason).toBe("security concern");
  });
});

// ── Gate enabled — merge trigger ─────────────────────────────────────────────

describe("HITLGate — merge trigger", () => {
  test("reject() on merge trigger → abandoned", () => {
    const db = makeDb();
    const gate = new HITLGate(db, undefined, { enabled: true, gatedTriggers: ["merge"] });
    const cs = makeChangeSet(db, "approved");

    const result = gate.transition(cs.id, "merge") as { status: "pending"; approvalId: string };
    const newStatus = gate.reject(result.approvalId, "not ready", "jason");
    expect(newStatus).toBe("abandoned");
  });

  test("approve() on merge → merged", () => {
    const db = makeDb();
    const gate = new HITLGate(db, undefined, { enabled: true, gatedTriggers: ["merge"] });
    const cs = makeChangeSet(db, "approved");

    const result = gate.transition(cs.id, "merge") as { status: "pending"; approvalId: string };
    // FSM needs to be in approved state; set it back since we set it to awaiting above
    db.run("UPDATE change_sets SET status = 'approved' WHERE id = ?", [cs.id]);
    const newStatus = gate.approve(result.approvalId);
    expect(newStatus).toBe("merged");
  });
});

// ── Block agent when gate is open ────────────────────────────────────────────

describe("HITLGate — HITLPendingError blocks concurrent transitions", () => {
  test("throws HITLPendingError if a gate is already open", () => {
    const db = makeDb();
    const gate = new HITLGate(db, undefined, { enabled: true, gatedTriggers: ["approve"] });
    const cs = makeChangeSet(db, "reviewing");

    gate.transition(cs.id, "approve"); // opens gate

    expect(() => gate.transition(cs.id, "approve")).toThrow(HITLPendingError);
  });

  test("HITLPendingError carries approvalId", () => {
    const db = makeDb();
    const gate = new HITLGate(db, undefined, { enabled: true, gatedTriggers: ["approve"] });
    const cs = makeChangeSet(db, "reviewing");

    gate.transition(cs.id, "approve");

    try {
      gate.transition(cs.id, "approve");
      expect(true).toBe(false); // should not reach here
    } catch (e) {
      expect(e).toBeInstanceOf(HITLPendingError);
      expect((e as HITLPendingError).approvalId).toBeTruthy();
    }
  });
});

// ── Error cases ───────────────────────────────────────────────────────────────

describe("HITLGate — error cases", () => {
  test("approve unknown approvalId throws", () => {
    const db = makeDb();
    const gate = new HITLGate(db, undefined, { enabled: true, gatedTriggers: ["approve"] });
    expect(() => gate.approve("00000000-0000-0000-0000-000000000000")).toThrow("not found");
  });

  test("reject without reason is enforced at API level (approve row still needs reason)", () => {
    const db = makeDb();
    const gate = new HITLGate(db, undefined, { enabled: true, gatedTriggers: ["approve"] });
    const cs = makeChangeSet(db, "reviewing");
    const result = gate.transition(cs.id, "approve") as { status: "pending"; approvalId: string };
    // Domain allows empty string; API route enforces non-empty
    expect(() => gate.reject(result.approvalId, "")).not.toThrow();
  });

  test("double-approve throws", () => {
    const db = makeDb();
    const gate = new HITLGate(db, undefined, { enabled: true, gatedTriggers: ["approve"] });
    const cs = makeChangeSet(db, "reviewing");
    const result = gate.transition(cs.id, "approve") as { status: "pending"; approvalId: string };
    gate.approve(result.approvalId);
    expect(() => gate.approve(result.approvalId)).toThrow("already decided");
  });
});

// ── Non-gated triggers pass through unchanged ─────────────────────────────────

describe("HITLGate — non-gated triggers", () => {
  test("request_changes passes through when not in gatedTriggers", () => {
    const db = makeDb();
    const gate = new HITLGate(db, undefined, { enabled: true, gatedTriggers: ["approve"] });
    const cs = makeChangeSet(db, "reviewing");

    const result = gate.transition(cs.id, "request_changes");
    expect(result.status).toBe("ok");
  });
});
