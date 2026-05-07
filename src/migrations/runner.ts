import type { Database } from "bun:sqlite";
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

export function runMigrations(db: Database, migrationsDir?: string): void {
  const dir = migrationsDir ?? resolve(process.cwd(), "migrations");

  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL
    );
  `);

  let files: string[];
  try {
    files = readdirSync(dir)
      .filter((f) => f.endsWith(".sql"))
      .sort();
  } catch {
    return;
  }

  for (const file of files) {
    const id = file.replace(".sql", "");
    const applied = db
      .query<{ id: string }, [string]>(
        "SELECT id FROM schema_migrations WHERE id = ?"
      )
      .get(id);

    if (applied) continue;

    const sql = readFileSync(join(dir, file), "utf-8");
    db.exec(sql);
    db.run("INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)", [
      id,
      new Date().toISOString(),
    ]);
  }
}
