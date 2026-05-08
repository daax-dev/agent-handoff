import { z } from "zod";
import type { Database } from "bun:sqlite";
import { createHash } from "node:crypto";

export const CheckRunNameSchema = z.enum(["typecheck", "lint", "test", "security", "custom"]);
export const CheckRunStatusSchema = z.enum(["pending", "running", "passed", "failed", "skipped"]);

export const CheckRunSchema = z.object({
  id: z.string(),
  change_set_id: z.string(),
  name: CheckRunNameSchema,
  status: CheckRunStatusSchema,
  output: z.string().nullable(),
  exit_code: z.number().int().nullable(),
  started_at: z.string(),
  completed_at: z.string().nullable(),
  output_sha256: z.string().nullable().optional(),
  subject_commit: z.string().nullable().optional(),
});

export type CheckRun = z.infer<typeof CheckRunSchema>;
export type CheckRunName = z.infer<typeof CheckRunNameSchema>;
export type CheckRunStatus = z.infer<typeof CheckRunStatusSchema>;

/**
 * Compute SHA-256 of the given string.
 * Returns hex digest.
 */
function sha256(content: string): string {
  return createHash("sha256").update(content, "utf-8").digest("hex");
}

/**
 * Read the current HEAD commit SHA from git.
 * Returns null if git is unavailable or not in a git repo.
 */
function getGitHead(cwd?: string): string | null {
  try {
    const result = Bun.spawnSync(["git", "rev-parse", "HEAD"], {
      cwd: cwd ?? process.cwd(),
      stdout: "pipe",
      stderr: "pipe",
    });
    if (result.exitCode !== 0) return null;
    const out = result.stdout instanceof Buffer
      ? result.stdout.toString("utf-8")
      : new TextDecoder().decode(result.stdout as Uint8Array);
    return out.trim() || null;
  } catch {
    return null;
  }
}

function nextId(db: Database): string {
  const row = db
    .query<{ value: number }, []>(
      "UPDATE sequences SET value = value + 1 WHERE name = 'check_runs' RETURNING value"
    )
    .get();
  if (!row) throw new Error("sequences table not initialized for check_runs");
  return `chk_${String(row.value).padStart(6, "0")}`;
}

export function createCheckRun(
  db: Database,
  changeSetId: string,
  name: CheckRunName
): CheckRun {
  const id = nextId(db);
  const now = new Date().toISOString();
  db.run(
    `INSERT INTO check_runs (id, change_set_id, name, status, output, exit_code, started_at, completed_at)
     VALUES (?, ?, ?, 'pending', NULL, NULL, ?, NULL)`,
    [id, changeSetId, name, now]
  );
  return getCheckRun(db, id)!;
}

export function getCheckRun(db: Database, id: string): CheckRun | null {
  return db
    .query<CheckRun, [string]>("SELECT * FROM check_runs WHERE id = ?")
    .get(id) ?? null;
}

export function updateCheckRun(
  db: Database,
  id: string,
  updates: { status: CheckRunStatus; output?: string; exitCode?: number; completedAt?: string; worktreePath?: string }
): CheckRun {
  // Compute content-addressing fields for all terminal status updates.
  const isTerminal = updates.status === "passed" || updates.status === "failed";
  let outputSha256: string | null = null;
  let subjectCommit: string | null = null;

  if (isTerminal) {
    if (updates.output != null) {
      try {
        outputSha256 = sha256(updates.output);
      } catch (err) {
        process.stderr.write(`[check-run] Failed to compute output_sha256: ${err}\n`);
      }
    }
    try {
      subjectCommit = getGitHead(updates.worktreePath);
    } catch (err) {
      process.stderr.write(`[check-run] Failed to get git HEAD: ${err}\n`);
    }
  }

  // Use a column-existence guard: if output_sha256 column exists (migration 015 applied), store it.
  try {
    db.run(
      `UPDATE check_runs SET status = ?, output = ?, exit_code = ?, completed_at = ?, output_sha256 = ?, subject_commit = ? WHERE id = ?`,
      [
        updates.status,
        updates.output ?? null,
        updates.exitCode ?? null,
        updates.completedAt ?? null,
        outputSha256,
        subjectCommit,
        id,
      ]
    );
  } catch (err) {
    // Migration 015 may not be applied in some test environments; fall back gracefully.
    const errMsg = String(err);
    if (errMsg.includes("output_sha256") || errMsg.includes("subject_commit")) {
      process.stderr.write(`[check-run] output_sha256/subject_commit columns not available (migration 015 not applied?): ${err}\n`);
      db.run(
        `UPDATE check_runs SET status = ?, output = ?, exit_code = ?, completed_at = ? WHERE id = ?`,
        [
          updates.status,
          updates.output ?? null,
          updates.exitCode ?? null,
          updates.completedAt ?? null,
          id,
        ]
      );
    } else {
      throw err;
    }
  }

  return getCheckRun(db, id)!;
}

export function listCheckRuns(db: Database, changeSetId: string): CheckRun[] {
  return db
    .query<CheckRun, [string]>(
      "SELECT * FROM check_runs WHERE change_set_id = ? ORDER BY started_at ASC"
    )
    .all(changeSetId);
}

export function allRequiredPassed(db: Database, changeSetId: string, requiredNames: CheckRunName[]): boolean {
  for (const name of requiredNames) {
    const run = db
      .query<{ status: string }, [string, string]>(
        "SELECT status FROM check_runs WHERE change_set_id = ? AND name = ? ORDER BY started_at DESC LIMIT 1"
      )
      .get(changeSetId, name);
    if (!run || run.status !== "passed") return false;
  }
  return true;
}
