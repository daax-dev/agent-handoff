import { Database } from "bun:sqlite";
import { resolve } from "node:path";
import { mkdirSync } from "node:fs";
import { runMigrations } from "../src/migrations/runner.js";

const dbPath = resolve(process.cwd(), ".work", "agent-handoff.db");
mkdirSync(resolve(process.cwd(), ".work"), { recursive: true });
const db = new Database(dbPath);
db.exec("PRAGMA foreign_keys = ON;");
runMigrations(db);

const tables = ["jobs", "change_sets", "tasks"];

for (const table of tables) {
  console.log(`\n=== ${table} ===`);
  const cols = db
    .query(`PRAGMA table_info(${table})`)
    .all() as { cid: number; name: string; type: string; notnull: number; dflt_value: string | null; pk: number }[];
  for (const col of cols) {
    console.log(`  ${col.name}: ${col.type}${col.notnull ? " NOT NULL" : ""}`);
  }
}

db.close();
