import { describe, test, expect, afterAll } from "bun:test";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { WorktreeManager, WorktreePathError } from "../worktree/manager.js";
import { $ } from "bun";

// Integration tests run against the actual git repo.
const REPO_ROOT = resolve(process.cwd());
const manager = new WorktreeManager(REPO_ROOT);

// Track created worktrees so we always clean up
const created: string[] = [];

afterAll(async () => {
  for (const taskId of created) {
    await manager.teardown(taskId, { deleteBranch: true }).catch(() => {});
  }
});

// ---------------------------------------------------------------------------
// Path validation
// ---------------------------------------------------------------------------

describe("WorktreeManager path validation", () => {
  test("invalid task ID throws WorktreePathError", () => {
    expect(() => manager.worktreePath("../../etc/passwd")).toThrow(
      WorktreePathError
    );
  });

  test("task ID with traversal segments throws WorktreePathError", () => {
    expect(() => manager.worktreePath("../injected")).toThrow(WorktreePathError);
  });

  test("valid TSK_XXXXXX format is accepted", () => {
    expect(() => manager.worktreePath("TSK_999999")).not.toThrow();
  });

  test("valid TSK-XXXXXX format is accepted", () => {
    expect(() => manager.worktreePath("TSK-888888")).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Branch name helper
// ---------------------------------------------------------------------------

describe("WorktreeManager branchName", () => {
  test("returns feat/TSK-XXXXXX format", () => {
    expect(manager.branchName("TSK_000001")).toBe("feat/TSK-000001");
  });
});

// ---------------------------------------------------------------------------
// Create / teardown (requires git repo)
// ---------------------------------------------------------------------------

describe("WorktreeManager create/teardown", () => {
  const TEST_TASK = "TSK_990001";

  test("create() creates worktree at expected path", async () => {
    created.push(TEST_TASK);
    const result = await manager.create(TEST_TASK);
    const expectedPath = manager.worktreePath(TEST_TASK);
    expect(result.path).toBe(expectedPath);
    expect(result.branch).toBe("feat/TSK-990001");
    expect(result.existed).toBe(false);
    expect(existsSync(expectedPath)).toBe(true);
  });

  test("create() is idempotent — second call returns existed=true", async () => {
    const result = await manager.create(TEST_TASK);
    expect(result.existed).toBe(true);
  });

  test("git worktree list shows the created worktree", async () => {
    const out = await $`git worktree list`.cwd(REPO_ROOT).text();
    expect(out).toContain("TSK-990001");
  });

  test("teardown() removes worktree directory", async () => {
    const path = manager.worktreePath(TEST_TASK);
    await manager.teardown(TEST_TASK, { deleteBranch: true });
    expect(existsSync(path)).toBe(false);
    // Remove from cleanup list since we already tore it down
    const idx = created.indexOf(TEST_TASK);
    if (idx !== -1) created.splice(idx, 1);
  });

  test("teardown() called on non-existent worktree is a no-op", async () => {
    await expect(
      manager.teardown("TSK_990002", { deleteBranch: false })
    ).resolves.toBeUndefined();
  });

  test("branch is deleted when deleteBranch:true", async () => {
    const BRANCH_TASK = "TSK_990003";
    created.push(BRANCH_TASK);
    await manager.create(BRANCH_TASK);
    await manager.teardown(BRANCH_TASK, { deleteBranch: true });
    created.splice(created.indexOf(BRANCH_TASK), 1);

    const branches = await $`git branch --list feat/TSK-990003`
      .cwd(REPO_ROOT)
      .text();
    expect(branches.trim()).toBe("");
  });

  test("branch is NOT deleted when deleteBranch:false", async () => {
    const KEEP_TASK = "TSK_990004";
    created.push(KEEP_TASK);
    await manager.create(KEEP_TASK);
    await manager.teardown(KEEP_TASK, { deleteBranch: false });

    const branches = await $`git branch --list feat/TSK-990004`
      .cwd(REPO_ROOT)
      .text();
    expect(branches.trim()).toContain("feat/TSK-990004");

    // Cleanup the branch manually
    await $`git branch -D feat/TSK-990004`.cwd(REPO_ROOT).quiet().nothrow();
    created.splice(created.indexOf(KEEP_TASK), 1);
  });
});
