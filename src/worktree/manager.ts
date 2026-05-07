import { $ } from "bun";
import { existsSync, mkdirSync } from "node:fs";
import { resolve, join, relative } from "node:path";

export class WorktreePathError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorktreePathError";
  }
}

const WORKTREES_ROOT = ".work/worktrees";

function validateTaskId(taskId: string): void {
  // Must match TSK_XXXXXX or TSK-XXXXXX format — no path traversal
  if (!/^TSK[_-]\d{6}$/.test(taskId)) {
    throw new WorktreePathError(
      `Invalid task ID "${taskId}": must match TSK_XXXXXX or TSK-XXXXXX`
    );
  }
}

function worktreeDirName(taskId: string): string {
  return taskId.replace("_", "-");
}

function branchName(taskId: string): string {
  return `feat/${worktreeDirName(taskId)}`;
}

function worktreePath(taskId: string, repoRoot: string): string {
  const name = worktreeDirName(taskId);
  const absPath = resolve(repoRoot, WORKTREES_ROOT, name);

  // Verify it stays within .work/worktrees/
  const root = resolve(repoRoot, WORKTREES_ROOT);
  const rel = relative(root, absPath);
  if (rel.startsWith("..") || rel.includes("..")) {
    throw new WorktreePathError(
      `Path traversal detected for task ID "${taskId}"`
    );
  }

  return absPath;
}

export interface WorktreeResult {
  path: string;
  branch: string;
  existed: boolean;
}

export interface TeardownOptions {
  deleteBranch?: boolean;
}

export class WorktreeManager {
  private readonly repoRoot: string;

  constructor(repoRoot?: string) {
    this.repoRoot = repoRoot ?? process.cwd();
  }

  async create(
    taskId: string,
    targetBranch = "main"
  ): Promise<WorktreeResult> {
    validateTaskId(taskId);

    const path = worktreePath(taskId, this.repoRoot);
    const branch = branchName(taskId);

    // Idempotent: if worktree directory already exists, return early
    if (existsSync(path)) {
      return { path, branch, existed: true };
    }

    mkdirSync(resolve(this.repoRoot, WORKTREES_ROOT), { recursive: true });

    // Create the worktree on a new branch forked from targetBranch
    await $`git worktree add -b ${branch} ${path} ${targetBranch}`
      .cwd(this.repoRoot)
      .quiet();

    return { path, branch, existed: false };
  }

  async teardown(
    taskId: string,
    options: TeardownOptions = {}
  ): Promise<void> {
    validateTaskId(taskId);

    const path = worktreePath(taskId, this.repoRoot);
    const branch = branchName(taskId);

    if (!existsSync(path)) {
      return; // no-op if already gone
    }

    // Remove worktree and prune
    await $`git worktree remove --force ${path}`
      .cwd(this.repoRoot)
      .quiet()
      .nothrow();

    await $`git worktree prune`.cwd(this.repoRoot).quiet().nothrow();

    if (options.deleteBranch) {
      await $`git branch -D ${branch}`.cwd(this.repoRoot).quiet().nothrow();
    }
  }

  worktreePath(taskId: string): string {
    validateTaskId(taskId);
    return worktreePath(taskId, this.repoRoot);
  }

  branchName(taskId: string): string {
    validateTaskId(taskId);
    return branchName(taskId);
  }
}
