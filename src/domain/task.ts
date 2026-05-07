import { z } from "zod";
import type { Database } from "bun:sqlite";

// ---------------------------------------------------------------------------
// Zod schema + inferred TypeScript type
// ---------------------------------------------------------------------------

export const TaskStatusSchema = z.enum([
  "backlog",
  "in_progress",
  "done",
  "blocked",
]);

export type TaskStatus = z.infer<typeof TaskStatusSchema>;

export const TaskSchema = z.object({
  id: z.string().regex(/^TSK_\d{6}$/),
  change_set_id: z.string().min(1),
  title: z.string().min(1),
  spec_path: z.string().min(1),
  plan_path: z.string().nullable().default(null),
  acceptance_path: z.string().min(1),
  assigned_agent: z.string().nullable().default(null),
  agent_role: z.string().nullable().default(null),
  status: TaskStatusSchema.default("backlog"),
  created_at: z.string().min(1),
});

export type Task = z.infer<typeof TaskSchema>;

export const CreateTaskInputSchema = z.object({
  change_set_id: z.string().min(1),
  title: z.string().min(1),
  spec_path: z.string().min(1),
  acceptance_path: z.string().min(1),
  plan_path: z.string().optional().default(""),
  assigned_agent: z.string().optional(),
  agent_role: z.string().optional(),
});

export type CreateTaskInput = z.input<typeof CreateTaskInputSchema>;

// ---------------------------------------------------------------------------
// ID generation
// ---------------------------------------------------------------------------

function nextTaskId(db: Database): string {
  const row = db
    .query<{ value: number }, []>(
      "UPDATE sequences SET value = value + 1 WHERE name = 'task' RETURNING value"
    )
    .get();
  if (!row) throw new Error("sequences table not initialized");
  return `TSK_${String(row.value).padStart(6, "0")}`;
}

// ---------------------------------------------------------------------------
// Row → Task
// ---------------------------------------------------------------------------

function parseRow(row: unknown): Task {
  return TaskSchema.parse(row);
}

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

export function createTask(db: Database, input: CreateTaskInput): Task {
  const v = CreateTaskInputSchema.parse(input);
  const id = nextTaskId(db);
  const now = new Date().toISOString();

  db.run(
    `INSERT INTO tasks
       (id, change_set_id, title, spec_path, plan_path, acceptance_path,
        assigned_agent, agent_role, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'backlog', ?)`,
    [
      id,
      v.change_set_id,
      v.title,
      v.spec_path,
      v.plan_path || null,
      v.acceptance_path,
      v.assigned_agent ?? null,
      v.agent_role ?? null,
      now,
    ]
  );

  return getTask(db, id)!;
}

export function getTask(db: Database, id: string): Task | undefined {
  const row = db.query("SELECT * FROM tasks WHERE id = ?").get(id) as unknown;
  if (!row) return undefined;
  return parseRow(row);
}

export function listTasks(db: Database, changeSetId?: string): Task[] {
  const rows = changeSetId
    ? (db
        .query(
          "SELECT * FROM tasks WHERE change_set_id = ? ORDER BY created_at ASC"
        )
        .all(changeSetId) as unknown[])
    : (db
        .query("SELECT * FROM tasks ORDER BY created_at ASC")
        .all() as unknown[]);
  return rows.map(parseRow);
}

export function updateTask(
  db: Database,
  id: string,
  updates: Partial<Omit<Task, "id" | "created_at">>
): Task | undefined {
  const existing = getTask(db, id);
  if (!existing) return undefined;

  const merged = { ...existing, ...updates };

  db.run(
    `UPDATE tasks SET
       change_set_id = ?, title = ?, spec_path = ?, plan_path = ?,
       acceptance_path = ?, assigned_agent = ?, agent_role = ?, status = ?
     WHERE id = ?`,
    [
      merged.change_set_id,
      merged.title,
      merged.spec_path,
      merged.plan_path,
      merged.acceptance_path,
      merged.assigned_agent,
      merged.agent_role,
      merged.status,
      id,
    ]
  );

  return getTask(db, id);
}
