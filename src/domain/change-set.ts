import { z } from "zod";
import type { Database } from "bun:sqlite";
import { InvalidTransitionError } from "../fsm/errors.js";

// ---------------------------------------------------------------------------
// Status enum + valid transition table
// ---------------------------------------------------------------------------

export const ChangeSetStatusSchema = z.enum([
  "draft",
  "planned",
  "implementing",
  "reviewing",
  "changes_requested",
  "approved",
  "conflict_detected",
  "merged",
  "abandoned",
  "escalated",
  "awaiting_human_approval",
]);

export type ChangeSetStatus = z.infer<typeof ChangeSetStatusSchema>;

export const VALID_TRANSITIONS: Readonly<
  Record<ChangeSetStatus, readonly ChangeSetStatus[]>
> = {
  draft: ["planned", "abandoned"],
  planned: ["implementing", "abandoned"],
  implementing: ["reviewing", "abandoned"],
  reviewing: ["approved", "changes_requested", "abandoned"],
  changes_requested: ["implementing", "abandoned"],
  approved: ["merged", "conflict_detected", "abandoned"],
  conflict_detected: ["implementing", "reviewing", "abandoned"],
  merged: [],
  abandoned: [],
  escalated: ["abandoned"],
  awaiting_human_approval: ["approved", "abandoned"],
};

// ---------------------------------------------------------------------------
// Zod schema + inferred TypeScript type
// ---------------------------------------------------------------------------

export const ChangeSetSchema = z.object({
  id: z.string().regex(/^chg_\d{6}$/),
  task_id: z.string().min(1),
  title: z.string().min(1),
  description: z.string().default(""),
  source_branch: z.string().min(1),
  target_branch: z.string().default("main"),
  worktree_path: z.string().min(1),
  status: ChangeSetStatusSchema.default("draft"),
  created_at: z.string().min(1),
  updated_at: z.string().min(1),
  merged_at: z.string().nullable().default(null),
  github_issue_url: z.string().nullable().default(null),
  github_pr_url: z.string().nullable().default(null),
  remote_branch: z.string().nullable().default(null),
});

export type ChangeSet = z.infer<typeof ChangeSetSchema>;

export const CreateChangeSetInputSchema = z.object({
  task_id: z.string().min(1),
  title: z.string().min(1),
  description: z.string().optional().default(""),
  source_branch: z.string().min(1),
  target_branch: z.string().optional().default("main"),
  worktree_path: z.string().min(1),
});

export type CreateChangeSetInput = z.input<typeof CreateChangeSetInputSchema>;

// ---------------------------------------------------------------------------
// ID generation (uses sequences table)
// ---------------------------------------------------------------------------

function nextChangeSetId(db: Database): string {
  const row = db
    .query<{ value: number }, []>(
      "UPDATE sequences SET value = value + 1 WHERE name = 'change_set' RETURNING value"
    )
    .get();
  if (!row) throw new Error("sequences table not initialized");
  return `chg_${String(row.value).padStart(6, "0")}`;
}

// ---------------------------------------------------------------------------
// Row → ChangeSet (parses raw SQLite row via Zod)
// ---------------------------------------------------------------------------

function parseRow(row: unknown): ChangeSet {
  return ChangeSetSchema.parse(row);
}

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

export function createChangeSet(
  db: Database,
  input: CreateChangeSetInput
): ChangeSet {
  const v = CreateChangeSetInputSchema.parse(input);
  const id = nextChangeSetId(db);
  const now = new Date().toISOString();

  db.run(
    `INSERT INTO change_sets
       (id, task_id, title, description, source_branch, target_branch,
        worktree_path, status, created_at, updated_at,
        merged_at, github_issue_url, github_pr_url, remote_branch)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?, NULL, NULL, NULL, NULL)`,
    [
      id,
      v.task_id,
      v.title,
      v.description,
      v.source_branch,
      v.target_branch,
      v.worktree_path,
      now,
      now,
    ]
  );

  return getChangeSet(db, id)!;
}

export function getChangeSet(
  db: Database,
  id: string
): ChangeSet | undefined {
  const row = db
    .query("SELECT * FROM change_sets WHERE id = ?")
    .get(id) as unknown;
  if (!row) return undefined;
  return parseRow(row);
}

export function listChangeSets(db: Database): ChangeSet[] {
  const rows = db
    .query("SELECT * FROM change_sets ORDER BY created_at DESC")
    .all() as unknown[];
  return rows.map(parseRow);
}

export function updateChangeSet(
  db: Database,
  id: string,
  updates: Partial<Omit<ChangeSet, "id" | "created_at">>
): ChangeSet | undefined {
  const existing = getChangeSet(db, id);
  if (!existing) return undefined;

  const merged = {
    ...existing,
    ...updates,
    updated_at: new Date().toISOString(),
  };

  db.run(
    `UPDATE change_sets SET
       task_id = ?, title = ?, description = ?,
       source_branch = ?, target_branch = ?, worktree_path = ?,
       status = ?, updated_at = ?, merged_at = ?,
       github_issue_url = ?, github_pr_url = ?, remote_branch = ?
     WHERE id = ?`,
    [
      merged.task_id,
      merged.title,
      merged.description,
      merged.source_branch,
      merged.target_branch,
      merged.worktree_path,
      merged.status,
      merged.updated_at,
      merged.merged_at,
      merged.github_issue_url,
      merged.github_pr_url,
      merged.remote_branch,
      id,
    ]
  );

  return getChangeSet(db, id);
}

// ---------------------------------------------------------------------------
// Status transition guard
// ---------------------------------------------------------------------------

export function setChangeSetStatus(
  db: Database,
  id: string,
  newStatus: ChangeSetStatus
): ChangeSet {
  const cs = getChangeSet(db, id);
  if (!cs) throw new Error(`ChangeSet ${id} not found`);

  const allowed = VALID_TRANSITIONS[cs.status];
  if (!(allowed as readonly string[]).includes(newStatus)) {
    throw new InvalidTransitionError(cs.status, newStatus);
  }

  const mergedAt =
    newStatus === "merged" ? new Date().toISOString() : cs.merged_at;

  return updateChangeSet(db, id, { status: newStatus, merged_at: mergedAt })!;
}
