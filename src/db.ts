import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { runMigrations } from "./migrations/runner.js";

let _db: Database | null = null;

export function getDb(overridePath?: string): Database {
  if (_db) return _db;

  const dbPath =
    overridePath ??
    process.env.DB_PATH ??
    resolve(process.cwd(), ".work", "agent-handoff.db");

  if (dbPath !== ":memory:") {
    mkdirSync(dirname(dbPath), { recursive: true });
  }

  _db = new Database(dbPath);
  _db.exec("PRAGMA journal_mode = WAL;");
  _db.exec("PRAGMA foreign_keys = ON;");
  runMigrations(_db);
  return _db;
}

export function closeDb(): void {
  if (_db) {
    _db.close();
    _db = null;
  }
}

export function openTestDb(migrationsDir?: string): Database {
  const db = new Database(":memory:");
  db.exec("PRAGMA foreign_keys = ON;");
  runMigrations(db, migrationsDir);
  return db;
}
