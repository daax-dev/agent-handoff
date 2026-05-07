import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import type { Database } from "bun:sqlite";
import { resolve } from "node:path";
import { openTestDb } from "../db.js";
import {
  createChangeSet,
  getChangeSet,
  updateChangeSet,
  listChangeSets,
  setChangeSetStatus,
  ChangeSetSchema,
  VALID_TRANSITIONS,
  type ChangeSetStatus,
} from "../domain/change-set.js";
import { createTask, getTask, listTasks } from "../domain/task.js";
import { InvalidTransitionError } from "../fsm/errors.js";

const MIGRATIONS_DIR = resolve(process.cwd(), "migrations");

let db: Database;

beforeEach(() => {
  db = openTestDb(MIGRATIONS_DIR);
});

afterEach(() => {
  db.close();
});

// ---------------------------------------------------------------------------
// Migration tests
// ---------------------------------------------------------------------------

describe("migrations", () => {
  test("creates change_sets table", () => {
    const row = db
      .query(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='change_sets'"
      )
      .get() as { name: string } | null;
    expect(row?.name).toBe("change_sets");
  });

  test("creates tasks table", () => {
    const row = db
      .query(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='tasks'"
      )
      .get() as { name: string } | null;
    expect(row?.name).toBe("tasks");
  });

  test("creates jobs table with change_set_id column", () => {
    const cols = db
      .query("PRAGMA table_info(jobs)")
      .all() as { name: string }[];
    const names = cols.map((c) => c.name);
    expect(names).toContain("change_set_id");
  });

  test("migration idempotency — running twice does not fail", () => {
    const { runMigrations } = require("../migrations/runner.js");
    expect(() => runMigrations(db, MIGRATIONS_DIR)).not.toThrow();
  });

  test("schema_migrations table tracks applied migrations", () => {
    const rows = db
      .query("SELECT id FROM schema_migrations")
      .all() as { id: string }[];
    expect(rows.some((r) => r.id === "001_changeset")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// ChangeSet ID format
// ---------------------------------------------------------------------------

describe("ChangeSet ID format", () => {
  test("IDs are formatted as chg_000001", () => {
    const cs = createChangeSet(db, {
      task_id: "TSK_000001",
      title: "Test",
      source_branch: "feat/TSK-000001",
      worktree_path: ".work/worktrees/TSK_000001",
    });
    expect(cs.id).toMatch(/^chg_\d{6}$/);
  });

  test("sequential IDs increment", () => {
    const a = createChangeSet(db, {
      task_id: "TSK_000001",
      title: "First",
      source_branch: "feat/TSK-000001",
      worktree_path: ".work/worktrees/TSK_000001",
    });
    const b = createChangeSet(db, {
      task_id: "TSK_000002",
      title: "Second",
      source_branch: "feat/TSK-000002",
      worktree_path: ".work/worktrees/TSK_000002",
    });
    const numA = parseInt(a.id.replace("chg_", ""), 10);
    const numB = parseInt(b.id.replace("chg_", ""), 10);
    expect(numB).toBe(numA + 1);
  });
});

// ---------------------------------------------------------------------------
// ChangeSet CRUD
// ---------------------------------------------------------------------------

describe("ChangeSet CRUD", () => {
  function makeInput(suffix = "001") {
    return {
      task_id: `TSK_${suffix}`,
      title: `Change ${suffix}`,
      description: "A test change set",
      source_branch: `feat/TSK-${suffix}`,
      worktree_path: `.work/worktrees/TSK_${suffix}`,
    };
  }

  test("createChangeSet returns a valid ChangeSet", () => {
    const cs = createChangeSet(db, makeInput());
    expect(cs.title).toBe("Change 001");
    expect(cs.status).toBe("draft");
    expect(cs.target_branch).toBe("main");
    expect(cs.merged_at).toBeNull();
    expect(cs.github_issue_url).toBeNull();
    expect(cs.github_pr_url).toBeNull();
    expect(cs.remote_branch).toBeNull();
  });

  test("createChangeSet fails without title", () => {
    expect(() =>
      createChangeSet(db, {
        task_id: "TSK_001",
        title: "",
        source_branch: "feat/TSK-001",
        worktree_path: ".work/worktrees/TSK_001",
      })
    ).toThrow();
  });

  test("createChangeSet fails without task_id", () => {
    expect(() =>
      createChangeSet(db, {
        task_id: "",
        title: "Valid title",
        source_branch: "feat/TSK-001",
        worktree_path: ".work/worktrees/TSK_001",
      })
    ).toThrow();
  });

  test("getChangeSet returns the created record", () => {
    const cs = createChangeSet(db, makeInput("002"));
    const found = getChangeSet(db, cs.id);
    expect(found).toBeDefined();
    expect(found!.id).toBe(cs.id);
    expect(found!.title).toBe("Change 002");
  });

  test("getChangeSet returns undefined for unknown ID", () => {
    expect(getChangeSet(db, "chg_999999")).toBeUndefined();
  });

  test("updateChangeSet merges partial updates", () => {
    const cs = createChangeSet(db, makeInput("003"));
    const updated = updateChangeSet(db, cs.id, {
      description: "Updated description",
      github_issue_url: "https://github.com/org/repo/issues/1",
    });
    expect(updated!.description).toBe("Updated description");
    expect(updated!.github_issue_url).toBe(
      "https://github.com/org/repo/issues/1"
    );
    expect(updated!.title).toBe("Change 003"); // unchanged
  });

  test("updateChangeSet returns undefined for unknown ID", () => {
    expect(updateChangeSet(db, "chg_999999", { title: "x" })).toBeUndefined();
  });

  test("listChangeSets returns all records", () => {
    createChangeSet(db, makeInput("010"));
    createChangeSet(db, makeInput("011"));
    const list = listChangeSets(db);
    expect(list.length).toBeGreaterThanOrEqual(2);
  });

  test("Zod schema rejects object with missing title", () => {
    const result = ChangeSetSchema.safeParse({
      id: "chg_000001",
      task_id: "TSK_001",
      // title missing
      source_branch: "feat/test",
      worktree_path: ".work/worktrees/TSK_001",
      status: "draft",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// State transitions
// ---------------------------------------------------------------------------

describe("State transitions", () => {
  function newCs() {
    return createChangeSet(db, {
      task_id: "TSK_000001",
      title: "Transition test",
      source_branch: "feat/TSK-000001",
      worktree_path: ".work/worktrees/TSK_000001",
    });
  }

  test("draft → planned succeeds", () => {
    const cs = newCs();
    const updated = setChangeSetStatus(db, cs.id, "planned");
    expect(updated.status).toBe("planned");
  });

  test("planned → implementing succeeds", () => {
    const cs = newCs();
    setChangeSetStatus(db, cs.id, "planned");
    const updated = setChangeSetStatus(db, cs.id, "implementing");
    expect(updated.status).toBe("implementing");
  });

  test("implementing → reviewing succeeds", () => {
    const cs = newCs();
    setChangeSetStatus(db, cs.id, "planned");
    setChangeSetStatus(db, cs.id, "implementing");
    const updated = setChangeSetStatus(db, cs.id, "reviewing");
    expect(updated.status).toBe("reviewing");
  });

  test("reviewing → approved succeeds", () => {
    const cs = newCs();
    setChangeSetStatus(db, cs.id, "planned");
    setChangeSetStatus(db, cs.id, "implementing");
    setChangeSetStatus(db, cs.id, "reviewing");
    const updated = setChangeSetStatus(db, cs.id, "approved");
    expect(updated.status).toBe("approved");
  });

  test("approved → merged sets merged_at", () => {
    const cs = newCs();
    setChangeSetStatus(db, cs.id, "planned");
    setChangeSetStatus(db, cs.id, "implementing");
    setChangeSetStatus(db, cs.id, "reviewing");
    setChangeSetStatus(db, cs.id, "approved");
    const merged = setChangeSetStatus(db, cs.id, "merged");
    expect(merged.status).toBe("merged");
    expect(merged.merged_at).not.toBeNull();
  });

  test("rejection loop: reviewing → changes_requested → implementing", () => {
    const cs = newCs();
    setChangeSetStatus(db, cs.id, "planned");
    setChangeSetStatus(db, cs.id, "implementing");
    setChangeSetStatus(db, cs.id, "reviewing");
    setChangeSetStatus(db, cs.id, "changes_requested");
    const reimpl = setChangeSetStatus(db, cs.id, "implementing");
    expect(reimpl.status).toBe("implementing");
  });

  test("conflict_detected path: approved → conflict_detected → implementing", () => {
    const cs = newCs();
    setChangeSetStatus(db, cs.id, "planned");
    setChangeSetStatus(db, cs.id, "implementing");
    setChangeSetStatus(db, cs.id, "reviewing");
    setChangeSetStatus(db, cs.id, "approved");
    setChangeSetStatus(db, cs.id, "conflict_detected");
    const reimpl = setChangeSetStatus(db, cs.id, "implementing");
    expect(reimpl.status).toBe("implementing");
  });

  test("planned → merged throws InvalidTransitionError", () => {
    const cs = newCs();
    setChangeSetStatus(db, cs.id, "planned");
    expect(() => setChangeSetStatus(db, cs.id, "merged")).toThrow(
      InvalidTransitionError
    );
  });

  test("draft → reviewing throws InvalidTransitionError", () => {
    const cs = newCs();
    expect(() => setChangeSetStatus(db, cs.id, "reviewing")).toThrow(
      InvalidTransitionError
    );
  });

  test("merged → any state throws InvalidTransitionError", () => {
    const cs = newCs();
    setChangeSetStatus(db, cs.id, "planned");
    setChangeSetStatus(db, cs.id, "implementing");
    setChangeSetStatus(db, cs.id, "reviewing");
    setChangeSetStatus(db, cs.id, "approved");
    setChangeSetStatus(db, cs.id, "merged");
    expect(() => setChangeSetStatus(db, cs.id, "draft")).toThrow(
      InvalidTransitionError
    );
  });

  test("any state → abandoned succeeds", () => {
    const statuses: ChangeSetStatus[] = [
      "draft",
      "planned",
      "implementing",
      "reviewing",
      "changes_requested",
      "approved",
      "conflict_detected",
    ];
    for (const from of statuses) {
      expect(
        (VALID_TRANSITIONS[from] as readonly string[]).includes("abandoned")
      ).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// Task CRUD
// ---------------------------------------------------------------------------

describe("Task CRUD", () => {
  function makeChangeSet() {
    return createChangeSet(db, {
      task_id: "TSK_PARENT",
      title: "Parent CS",
      source_branch: "feat/parent",
      worktree_path: ".work/worktrees/parent",
    });
  }

  test("createTask returns a valid Task with TSK_ prefix", () => {
    const cs = makeChangeSet();
    const task = createTask(db, {
      change_set_id: cs.id,
      title: "Implement feature",
      spec_path: `.work/tasks/TSK_000001/spec.md`,
      acceptance_path: `.work/tasks/TSK_000001/acceptance.md`,
    });
    expect(task.id).toMatch(/^TSK_\d{6}$/);
    expect(task.status).toBe("backlog");
    expect(task.change_set_id).toBe(cs.id);
  });

  test("getTask returns the created task", () => {
    const cs = makeChangeSet();
    const task = createTask(db, {
      change_set_id: cs.id,
      title: "Get me",
      spec_path: ".work/tasks/TSK_X/spec.md",
      acceptance_path: ".work/tasks/TSK_X/acceptance.md",
    });
    const found = getTask(db, task.id);
    expect(found).toBeDefined();
    expect(found!.title).toBe("Get me");
  });

  test("listTasks filters by changeSetId", () => {
    const cs1 = makeChangeSet();
    const cs2 = makeChangeSet();
    createTask(db, {
      change_set_id: cs1.id,
      title: "Task A",
      spec_path: ".work/tasks/A/spec.md",
      acceptance_path: ".work/tasks/A/acceptance.md",
    });
    createTask(db, {
      change_set_id: cs2.id,
      title: "Task B",
      spec_path: ".work/tasks/B/spec.md",
      acceptance_path: ".work/tasks/B/acceptance.md",
    });
    const forCs1 = listTasks(db, cs1.id);
    expect(forCs1.every((t) => t.change_set_id === cs1.id)).toBe(true);
  });
});
