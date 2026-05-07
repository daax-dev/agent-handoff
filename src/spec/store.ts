import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve, join, relative } from "node:path";
import { SPEC_TEMPLATE, ACCEPTANCE_TEMPLATE } from "./templates.js";

export type SpecKind = "spec" | "plan" | "acceptance";

const FILE_NAMES: Record<SpecKind, string> = {
  spec: "spec.md",
  plan: "plan.md",
  acceptance: "acceptance.md",
};

const TASK_ID_RE = /^TSK[_-]\d{6}$/;
const TASKS_ROOT = ".work/tasks";

export class SpecPathError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SpecPathError";
  }
}

export class SpecStore {
  private readonly repoRoot: string;

  constructor(repoRoot?: string) {
    this.repoRoot = repoRoot ?? process.cwd();
  }

  private validateTaskId(taskId: string): void {
    if (!TASK_ID_RE.test(taskId)) {
      throw new SpecPathError(
        `Invalid task ID "${taskId}": must match TSK_XXXXXX or TSK-XXXXXX`
      );
    }
  }

  private taskDir(taskId: string): string {
    this.validateTaskId(taskId);
    const dir = resolve(this.repoRoot, TASKS_ROOT, taskId);

    // Verify path stays within .work/tasks/
    const root = resolve(this.repoRoot, TASKS_ROOT);
    const rel = relative(root, dir);
    if (rel.startsWith("..") || rel.includes("..")) {
      throw new SpecPathError(
        `Path traversal detected for task ID "${taskId}"`
      );
    }

    return dir;
  }

  filePath(taskId: string, kind: SpecKind): string {
    return join(this.taskDir(taskId), FILE_NAMES[kind]);
  }

  read(taskId: string, kind: SpecKind): string | null {
    const path = this.filePath(taskId, kind);
    if (!existsSync(path)) return null;
    return readFileSync(path, "utf-8");
  }

  write(taskId: string, kind: SpecKind, content: string): void {
    const dir = this.taskDir(taskId);
    mkdirSync(dir, { recursive: true });
    writeFileSync(this.filePath(taskId, kind), content, "utf-8");
  }

  exists(taskId: string, kind: SpecKind): boolean {
    return existsSync(this.filePath(taskId, kind));
  }

  initDefaults(taskId: string): void {
    if (!this.exists(taskId, "spec")) {
      this.write(taskId, "spec", SPEC_TEMPLATE);
    }
    if (!this.exists(taskId, "acceptance")) {
      this.write(taskId, "acceptance", ACCEPTANCE_TEMPLATE);
    }
  }
}
