import type { Database } from "bun:sqlite";
import { appendFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { createCheckRun, updateCheckRun, allRequiredPassed } from "../domain/check-run.js";
import { DEFAULT_CHECKS, REQUIRED_CHECK_NAMES, type CheckConfig } from "./check-config.js";
import type { CheckRunName } from "../domain/check-run.js";

const MAX_OUTPUT_BYTES = 50 * 1024; // 50 KB

export class CheckRunner {
  constructor(
    private readonly db: Database,
    private readonly repoRoot: string = process.cwd(),
    private readonly checks: CheckConfig[] = DEFAULT_CHECKS
  ) {}

  async run(changeSetId: string, worktreePath: string): Promise<void> {
    const logsDir = resolve(this.repoRoot, ".work", "logs");
    mkdirSync(logsDir, { recursive: true });

    // Derive task log path from changeSetId → task_id
    const csRow = this.db
      .query<{ task_id: string }, [string]>(
        "SELECT task_id FROM change_sets WHERE id = ?"
      )
      .get(changeSetId);
    const taskId = csRow?.task_id ?? changeSetId;
    const logPath = resolve(logsDir, `${taskId}.log`);

    for (const cfg of this.checks) {
      const run = createCheckRun(this.db, changeSetId, cfg.name);

      // Transition to running
      updateCheckRun(this.db, run.id, { status: "running" });
      appendFileSync(logPath, `[check:${cfg.name}] starting: ${cfg.command}\n`);

      let output = "";
      let exitCode = 0;

      try {
        const [cmd, ...args] = cfg.command.split(" ");
        const proc = Bun.spawn([cmd, ...args], {
          cwd: worktreePath,
          stdout: "pipe",
          stderr: "pipe",
        });

        const [stdoutBytes, stderrBytes] = await Promise.all([
          new Response(proc.stdout).arrayBuffer(),
          new Response(proc.stderr).arrayBuffer(),
        ]);

        exitCode = await proc.exited;
        const combined = Buffer.concat([
          Buffer.from(stdoutBytes),
          Buffer.from(stderrBytes),
        ]).toString("utf-8");

        output = combined.length > MAX_OUTPUT_BYTES
          ? combined.slice(0, MAX_OUTPUT_BYTES) + "\n[truncated]"
          : combined;
      } catch (e) {
        output = e instanceof Error ? e.message : String(e);
        exitCode = 1;
      }

      appendFileSync(logPath, output);
      appendFileSync(logPath, `[check:${cfg.name}] exit_code=${exitCode}\n`);

      updateCheckRun(this.db, run.id, {
        status: exitCode === 0 ? "passed" : "failed",
        output,
        exitCode,
        completedAt: new Date().toISOString(),
      });
    }
  }

  allRequiredPassed(changeSetId: string): boolean {
    const required = this.checks
      .filter((c) => c.required)
      .map((c) => c.name) as CheckRunName[];
    return allRequiredPassed(this.db, changeSetId, required);
  }
}
