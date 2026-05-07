import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import type { Database } from "bun:sqlite";
import { resolve } from "node:path";
import { openTestDb } from "../db.js";
import { FSMEngine } from "../fsm/engine.js";
import { InvalidTransitionError, CircuitBreakerError } from "../fsm/errors.js";
import { createChangeSet } from "../domain/change-set.js";

const MIGRATIONS_DIR = resolve(process.cwd(), "migrations");

let db: Database;
let fsm: FSMEngine;

function newCs(db: Database, suffix = "001") {
  return createChangeSet(db, {
    task_id: `TSK_${suffix}`,
    title: `FSM test ${suffix}`,
    source_branch: `feat/TSK-${suffix}`,
    worktree_path: `.work/worktrees/TSK-${suffix}`,
  });
}

beforeEach(() => {
  db = openTestDb(MIGRATIONS_DIR);
  fsm = new FSMEngine(db);
});

afterEach(() => {
  db.close();
});

// ---------------------------------------------------------------------------
// Happy path transitions
// ---------------------------------------------------------------------------

describe("FSMEngine happy path", () => {
  test("draft → planned via plan_accepted", () => {
    const cs = newCs(db);
    const status = fsm.transition(cs.id, "plan_accepted");
    expect(status).toBe("planned");

    const row = db
      .query<{ status: string }, [string]>("SELECT status FROM change_sets WHERE id = ?")
      .get(cs.id);
    expect(row?.status).toBe("planned");
  });

  test("full happy path: draft → merged", () => {
    const cs = newCs(db, "002");
    fsm.transition(cs.id, "plan_accepted");
    fsm.transition(cs.id, "assign_implementer");
    fsm.transition(cs.id, "submit_for_review");
    fsm.transition(cs.id, "approve");
    const status = fsm.transition(cs.id, "merge");
    expect(status).toBe("merged");
  });

  test("rejection loop: implementing → reviewing → changes_requested → implementing", () => {
    const cs = newCs(db, "003");
    fsm.transition(cs.id, "plan_accepted");
    fsm.transition(cs.id, "assign_implementer");
    fsm.transition(cs.id, "submit_for_review");
    fsm.transition(cs.id, "request_changes");
    const status = fsm.transition(cs.id, "pick_up_revision");
    expect(status).toBe("implementing");
  });

  test("conflict_detected path: approved → conflict_detected → reviewing → approved → merged", () => {
    const cs = newCs(db, "004");
    fsm.transition(cs.id, "plan_accepted");
    fsm.transition(cs.id, "assign_implementer");
    fsm.transition(cs.id, "submit_for_review");
    fsm.transition(cs.id, "approve");
    fsm.transition(cs.id, "merge_conflict_detected");
    fsm.transition(cs.id, "conflict_resolved");
    fsm.transition(cs.id, "approve");
    const status = fsm.transition(cs.id, "merge");
    expect(status).toBe("merged");
  });

  test("abandon from any non-terminal state", () => {
    const states = ["draft", "planned", "implementing", "reviewing", "changes_requested", "approved"];
    for (let i = 0; i < states.length; i++) {
      const cs = newCs(db, String(10 + i).padStart(3, "0"));
      // Drive to the target state
      const path: string[] = [];
      if (i >= 1) path.push("plan_accepted");
      if (i >= 2) path.push("assign_implementer");
      if (i >= 3) path.push("submit_for_review");
      if (i >= 4) path.push("request_changes");
      if (i >= 5) { path.push("pick_up_revision"); path.push("submit_for_review"); path.push("approve"); }
      for (const trigger of path) fsm.transition(cs.id, trigger);
      const status = fsm.transition(cs.id, "abandon");
      expect(status).toBe("abandoned");
    }
  });
});

// ---------------------------------------------------------------------------
// Checkpoint persistence
// ---------------------------------------------------------------------------

describe("FSMEngine checkpoints", () => {
  test("writes checkpoint row on every transition", () => {
    const cs = newCs(db, "020");
    fsm.transition(cs.id, "plan_accepted");
    fsm.transition(cs.id, "assign_implementer");
    const history = fsm.getHistory(cs.id);
    expect(history.length).toBe(2);
    expect(history[0].from_status).toBe("draft");
    expect(history[0].to_status).toBe("planned");
    expect(history[1].from_status).toBe("planned");
    expect(history[1].to_status).toBe("implementing");
  });

  test("getHistory returns rows ordered by ts ASC", () => {
    const cs = newCs(db, "021");
    fsm.transition(cs.id, "plan_accepted");
    fsm.transition(cs.id, "assign_implementer");
    fsm.transition(cs.id, "submit_for_review");
    const history = fsm.getHistory(cs.id);
    const timestamps = history.map((r) => r.ts);
    const sorted = [...timestamps].sort();
    expect(timestamps).toEqual(sorted);
  });

  test("checkpoint row has correct trigger", () => {
    const cs = newCs(db, "022");
    fsm.transition(cs.id, "plan_accepted");
    const history = fsm.getHistory(cs.id);
    expect(history[0].trigger).toBe("plan_accepted");
  });

  test("transition and checkpoint are atomic — invalid trigger leaves no checkpoint", () => {
    const cs = newCs(db, "023");
    expect(() => fsm.transition(cs.id, "merge")).toThrow(InvalidTransitionError);
    const history = fsm.getHistory(cs.id);
    expect(history.length).toBe(0);
    // Status unchanged
    const row = db
      .query<{ status: string }, [string]>("SELECT status FROM change_sets WHERE id = ?")
      .get(cs.id);
    expect(row?.status).toBe("draft");
  });
});

// ---------------------------------------------------------------------------
// Invalid transitions
// ---------------------------------------------------------------------------

describe("FSMEngine invalid transitions", () => {
  test("draft → merge throws InvalidTransitionError", () => {
    const cs = newCs(db, "030");
    expect(() => fsm.transition(cs.id, "merge")).toThrow(InvalidTransitionError);
  });

  test("unknown trigger throws InvalidTransitionError", () => {
    const cs = newCs(db, "031");
    expect(() => fsm.transition(cs.id, "unknown_trigger")).toThrow(
      InvalidTransitionError
    );
  });

  test("merged is terminal — no outgoing transitions", () => {
    const cs = newCs(db, "032");
    fsm.transition(cs.id, "plan_accepted");
    fsm.transition(cs.id, "assign_implementer");
    fsm.transition(cs.id, "submit_for_review");
    fsm.transition(cs.id, "approve");
    fsm.transition(cs.id, "merge");
    expect(() => fsm.transition(cs.id, "abandon")).toThrow(InvalidTransitionError);
  });

  test("unknown changeSetId throws", () => {
    expect(() => fsm.transition("chg_999999", "plan_accepted")).toThrow();
  });
});

// ---------------------------------------------------------------------------
// Circuit breaker
// ---------------------------------------------------------------------------

describe("FSMEngine circuit breaker", () => {
  function driveToReviewing(db: Database, csId: string) {
    fsm.transition(csId, "plan_accepted");
    fsm.transition(csId, "assign_implementer");
    fsm.transition(csId, "submit_for_review");
  }

  test("3 review cycles succeed; 4th triggers CircuitBreakerError and escalates", () => {
    const cs = newCs(db, "040");

    for (let cycle = 0; cycle < 3; cycle++) {
      if (cycle === 0) {
        driveToReviewing(db, cs.id);
      } else {
        // Pick up revision → reimplement → resubmit
        fsm.transition(cs.id, "pick_up_revision");
        fsm.transition(cs.id, "submit_for_review");
      }
      fsm.transition(cs.id, "request_changes");
    }

    // 3 cycles done — next pick_up + submit + request_changes should trigger breaker
    fsm.transition(cs.id, "pick_up_revision");
    fsm.transition(cs.id, "submit_for_review");

    expect(() => fsm.transition(cs.id, "request_changes")).toThrow(
      CircuitBreakerError
    );

    // Status should be "escalated"
    const row = db
      .query<{ status: string }, [string]>("SELECT status FROM change_sets WHERE id = ?")
      .get(cs.id);
    expect(row?.status).toBe("escalated");
  });

  test("CircuitBreakerError contains cycle count", () => {
    const cs = newCs(db, "041");

    driveToReviewing(db, cs.id);
    for (let i = 0; i < 3; i++) {
      fsm.transition(cs.id, "request_changes");
      if (i < 2) {
        fsm.transition(cs.id, "pick_up_revision");
        fsm.transition(cs.id, "submit_for_review");
      }
    }
    fsm.transition(cs.id, "pick_up_revision");
    fsm.transition(cs.id, "submit_for_review");

    try {
      fsm.transition(cs.id, "request_changes");
      expect(true).toBe(false); // should not reach
    } catch (e) {
      expect(e).toBeInstanceOf(CircuitBreakerError);
      expect((e as CircuitBreakerError).cycles).toBeGreaterThanOrEqual(3);
    }
  });
});

// ---------------------------------------------------------------------------
// Concurrency
// ---------------------------------------------------------------------------

describe("FSMEngine concurrency", () => {
  test("10 concurrent transition calls — only one succeeds per step", async () => {
    const cs = newCs(db, "050");

    // Drive to implementing first
    fsm.transition(cs.id, "plan_accepted");
    fsm.transition(cs.id, "assign_implementer");

    // Fire 10 concurrent submit_for_review — only one should succeed
    const results = await Promise.allSettled(
      Array.from({ length: 10 }, () =>
        Promise.resolve().then(() => fsm.transition(cs.id, "submit_for_review"))
      )
    );

    const succeeded = results.filter((r) => r.status === "fulfilled");
    const failed = results.filter((r) => r.status === "rejected");

    expect(succeeded.length).toBe(1);
    expect(failed.length).toBe(9);

    // Status should be reviewing (not corrupted)
    const row = db
      .query<{ status: string }, [string]>("SELECT status FROM change_sets WHERE id = ?")
      .get(cs.id);
    expect(row?.status).toBe("reviewing");
  });
});
