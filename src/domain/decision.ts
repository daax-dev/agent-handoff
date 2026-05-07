import { z } from "zod";
import type { Database } from "bun:sqlite";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";

const TASKS_ROOT = ".work/tasks";

export const DecisionEntrySchema = z.object({
  id: z.string(),
  task_id: z.string(),
  change_set_id: z.string(),
  topic: z.string().min(1),
  options_considered: z.string(), // stored as JSON string in DB
  choice: z.string().min(1),
  rationale: z.string().min(1),
  sources_cited: z.string().nullable(),
  author_agent: z.string().nullable(),
  ts: z.string(),
});

export type DecisionEntry = z.infer<typeof DecisionEntrySchema>;

export const CreateDecisionInputSchema = z.object({
  taskId: z.string().min(1),
  changeSetId: z.string().min(1),
  topic: z.string().min(1, "topic is required"),
  optionsConsidered: z.array(z.string()).min(1),
  choice: z.string().min(1, "choice is required"),
  rationale: z.string().min(1, "rationale is required"),
  sourcesCited: z.array(z.string()).optional(),
  authorAgent: z.string().optional(),
});

export type CreateDecisionInput = z.infer<typeof CreateDecisionInputSchema>;

function nextId(db: Database): string {
  const row = db
    .query<{ value: number }, []>(
      "UPDATE sequences SET value = value + 1 WHERE name = 'decisions' RETURNING value"
    )
    .get();
  if (!row) throw new Error("sequences table not initialized for decisions");
  return `DEC-${String(row.value).padStart(6, "0")}`;
}

export function createDecision(db: Database, input: CreateDecisionInput): DecisionEntry {
  const id = nextId(db);
  const now = new Date().toISOString();
  db.run(
    `INSERT INTO decisions
      (id, task_id, change_set_id, topic, options_considered, choice, rationale, sources_cited, author_agent, ts)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.taskId,
      input.changeSetId,
      input.topic,
      JSON.stringify(input.optionsConsidered),
      input.choice,
      input.rationale,
      input.sourcesCited ? JSON.stringify(input.sourcesCited) : null,
      input.authorAgent ?? null,
      now,
    ]
  );
  return getDecision(db, id)!;
}

export function getDecision(db: Database, id: string): DecisionEntry | null {
  return db
    .query<DecisionEntry, [string]>("SELECT * FROM decisions WHERE id = ?")
    .get(id) ?? null;
}

export function listDecisionsByTask(db: Database, taskId: string): DecisionEntry[] {
  return db
    .query<DecisionEntry, [string]>(
      "SELECT * FROM decisions WHERE task_id = ? ORDER BY ts ASC"
    )
    .all(taskId);
}

export function listDecisionsByChangeSet(db: Database, changeSetId: string): DecisionEntry[] {
  return db
    .query<DecisionEntry, [string]>(
      "SELECT * FROM decisions WHERE change_set_id = ? ORDER BY ts ASC"
    )
    .all(changeSetId);
}

export function exportToJSONL(db: Database, taskId: string, repoRoot = process.cwd()): string {
  const decisions = listDecisionsByTask(db, taskId);
  const dir = resolve(repoRoot, TASKS_ROOT, taskId);
  mkdirSync(dir, { recursive: true });
  const outPath = join(dir, "decisions.jsonl");
  const lines = decisions.map((d) =>
    JSON.stringify({
      id: d.id,
      task_id: d.task_id,
      change_set_id: d.change_set_id,
      topic: d.topic,
      options_considered: JSON.parse(d.options_considered),
      choice: d.choice,
      rationale: d.rationale,
      sources_cited: d.sources_cited ? JSON.parse(d.sources_cited) : null,
      author_agent: d.author_agent,
      ts: d.ts,
    })
  );
  writeFileSync(outPath, lines.join("\n") + (lines.length ? "\n" : ""), "utf-8");
  return outPath;
}
