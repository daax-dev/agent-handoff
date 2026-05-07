import { z } from "zod";
import type { Database } from "bun:sqlite";

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
});

export type CheckRun = z.infer<typeof CheckRunSchema>;
export type CheckRunName = z.infer<typeof CheckRunNameSchema>;
export type CheckRunStatus = z.infer<typeof CheckRunStatusSchema>;

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
  updates: { status: CheckRunStatus; output?: string; exitCode?: number; completedAt?: string }
): CheckRun {
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
