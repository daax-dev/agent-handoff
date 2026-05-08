#!/usr/bin/env bun
/**
 * verify-provenance.ts
 *
 * Validates cryptographic integrity of the agent-handoff audit trail:
 *   Phase 1 — check run output_sha256 hashes (content-addressed check runs)
 *   Phase 3 — handoff log Merkle chain (prevEntryHash chaining in JSONL files)
 *
 * Usage:
 *   bun run scripts/verify-provenance.ts [taskId]
 *
 * Exit codes:
 *   0 — all checks pass (unsigned entries produce warnings, not failures)
 *   1 — tampered data detected (hash mismatch or chain break)
 */

import { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve, join, basename } from "node:path";
import { runMigrations } from "../src/migrations/runner.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sha256Hex(content: string): string {
  return createHash("sha256").update(content, "utf-8").digest("hex");
}

function shortHash(hash: string): string {
  return hash.slice(0, 12) + "...";
}

/** Open the SQLite DB (read-only friendly, but we need run/migrations). */
function openDb(): Database {
  const dbPath =
    process.env.DB_PATH ?? resolve(process.cwd(), ".work", "agent-handoff.db");

  if (!existsSync(dbPath)) {
    console.error(`DB not found at: ${dbPath}`);
    console.error("Run the server at least once to initialize the database.");
    process.exit(1);
  }

  const db = new Database(dbPath);
  db.exec("PRAGMA foreign_keys = ON;");
  runMigrations(db);
  return db;
}

// ---------------------------------------------------------------------------
// Phase 1 — Check run hash verification
// ---------------------------------------------------------------------------

interface CheckRunRow {
  id: string;
  name: string;
  status: string;
  output: string | null;
  output_sha256: string | null;
  subject_commit: string | null;
  change_set_id: string;
}

interface CheckRunResult {
  id: string;
  name: string;
  status: string;
  ok: boolean;
  message: string;
}

function verifyCheckRuns(db: Database, taskId?: string): CheckRunResult[] {
  // Check if output_sha256 column exists (migration 015)
  const cols = db.query("PRAGMA table_info(check_runs)").all() as { name: string }[];
  const hasHashCols = cols.some((c) => c.name === "output_sha256");

  if (!hasHashCols) {
    return [{
      id: "N/A",
      name: "N/A",
      status: "N/A",
      ok: true,
      message: "Migration 015 not applied — output_sha256 column absent; skipping check run verification",
    }];
  }

  let rows: CheckRunRow[];

  if (taskId) {
    // Find changesets for this task ID
    const csSql = db
      .query<{ id: string }, [string]>(
        "SELECT id FROM change_sets WHERE task_id = ?"
      )
      .all(taskId);

    if (csSql.length === 0) {
      return [{
        id: "N/A",
        name: "N/A",
        status: "N/A",
        ok: true,
        message: `No change sets found for task ${taskId}`,
      }];
    }

    const changeSetIds = csSql.map((r) => r.id);
    rows = [];
    for (const csId of changeSetIds) {
      const csRows = db
        .query<CheckRunRow, [string]>(
          "SELECT id, name, status, output, output_sha256, subject_commit, change_set_id FROM check_runs WHERE change_set_id = ? ORDER BY started_at ASC"
        )
        .all(csId);
      rows.push(...csRows);
    }
  } else {
    rows = db
      .query<CheckRunRow, []>(
        "SELECT id, name, status, output, output_sha256, subject_commit, change_set_id FROM check_runs ORDER BY started_at ASC"
      )
      .all();
  }

  if (rows.length === 0) {
    return [{
      id: "N/A",
      name: "N/A",
      status: "N/A",
      ok: true,
      message: "No check runs found",
    }];
  }

  return rows.map((row): CheckRunResult => {
    const isTerminal = row.status === "passed" || row.status === "failed";

    // Null hash on a non-terminal or null-output run is expected
    if (row.output_sha256 === null || row.output_sha256 === undefined) {
      if (!isTerminal || row.output === null) {
        return {
          id: row.id,
          name: row.name,
          status: row.status,
          ok: true,
          message: "unsigned/unhashed (no output or non-terminal status)",
        };
      }
      // Terminal with output but no hash — unsigned (warn, don't fail)
      return {
        id: row.id,
        name: row.name,
        status: row.status,
        ok: true,
        message: "unsigned (output_sha256 not stored — predates migration 015)",
      };
    }

    // Hash is present — verify it
    const output = row.output ?? "";
    const computed = sha256Hex(output);

    if (computed === row.output_sha256) {
      return {
        id: row.id,
        name: row.name,
        status: row.status,
        ok: true,
        message: `sha256:${shortHash(row.output_sha256)} matches`,
      };
    } else {
      return {
        id: row.id,
        name: row.name,
        status: row.status,
        ok: false,
        message: `sha256 MISMATCH — stored:${shortHash(row.output_sha256)} got:${shortHash(computed)} (TAMPERED or corrupted)`,
      };
    }
  });
}

// ---------------------------------------------------------------------------
// Phase 3 — Handoff log Merkle chain verification
// ---------------------------------------------------------------------------

interface HandoffEntry {
  entryId?: string;
  prevEntryHash?: string;
  [key: string]: unknown;
}

interface ChainResult {
  lineNumber: number;
  entryId: string;
  ok: boolean;
  message: string;
}

interface FileChainResult {
  filePath: string;
  results: ChainResult[];
}

/** Validate the filename is a safe date-based JSONL file. */
function isSafeHandoffFilename(name: string): boolean {
  return /^\d{4}-\d{2}-\d{2}\.jsonl$/.test(name);
}

function verifyHandoffFile(filePath: string): ChainResult[] {
  let content: string;
  try {
    content = readFileSync(filePath, "utf-8");
  } catch (err) {
    return [{
      lineNumber: 0,
      entryId: "N/A",
      ok: false,
      message: `Failed to read file: ${err}`,
    }];
  }

  const lines = content.split("\n").filter((l) => l.trim().length > 0);

  if (lines.length === 0) {
    return [{
      lineNumber: 0,
      entryId: "N/A",
      ok: true,
      message: "empty file",
    }];
  }

  const results: ChainResult[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;
    let entry: HandoffEntry;

    try {
      entry = JSON.parse(line) as HandoffEntry;
    } catch {
      results.push({
        lineNumber: lineNum,
        entryId: "N/A",
        ok: false,
        message: `invalid JSON on line ${lineNum}`,
      });
      continue;
    }

    const entryId = entry.entryId ?? `line-${lineNum}`;

    if (i === 0) {
      // First entry: no prevEntryHash expected
      if (entry.prevEntryHash != null) {
        // Has a prev hash but nothing before it — unusual but not a failure
        // (could happen if file was rotated mid-day or entries were manually removed)
        results.push({
          lineNumber: lineNum,
          entryId,
          ok: true,
          message: `chain start (has prevEntryHash — file may have been truncated)`,
        });
      } else {
        results.push({
          lineNumber: lineNum,
          entryId,
          ok: true,
          message: "chain start (no prev)",
        });
      }
      continue;
    }

    // Subsequent entries: verify prevEntryHash matches hash of previous line
    const prevLine = lines[i - 1];

    if (entry.prevEntryHash == null) {
      // No hash recorded — predates Phase 3 implementation
      results.push({
        lineNumber: lineNum,
        entryId,
        ok: true,
        message: "unsigned (no prevEntryHash — predates provenance chaining)",
      });
      continue;
    }

    const expectedHash = sha256Hex(prevLine);
    if (entry.prevEntryHash === expectedHash) {
      results.push({
        lineNumber: lineNum,
        entryId,
        ok: true,
        message: "chain valid",
      });
    } else {
      results.push({
        lineNumber: lineNum,
        entryId,
        ok: false,
        message: `chain BROKEN — prevEntryHash mismatch (TAMPERED or gap)`,
      });
    }
  }

  return results;
}

function verifyHandoffLogs(taskId?: string): FileChainResult[] {
  const handoffDir = join(process.cwd(), ".logs", "handoffs");

  if (!existsSync(handoffDir)) {
    return [];
  }

  let files: string[];
  try {
    files = readdirSync(handoffDir)
      .filter((f) => isSafeHandoffFilename(f))
      .sort();
  } catch (err) {
    console.error(`Failed to read handoff log directory: ${err}`);
    return [];
  }

  if (files.length === 0) {
    return [];
  }

  const results: FileChainResult[] = [];

  for (const file of files) {
    const filePath = join(handoffDir, file);

    if (taskId) {
      // Filter: only include files that mention the taskId
      let content: string;
      try {
        content = readFileSync(filePath, "utf-8");
      } catch {
        continue;
      }
      if (!content.includes(taskId)) continue;
    }

    results.push({
      filePath,
      results: verifyHandoffFile(filePath),
    });
  }

  return results;
}

// ---------------------------------------------------------------------------
// Formatting / output
// ---------------------------------------------------------------------------

function formatCheckRunResults(results: CheckRunResult[]): { output: string; failures: number } {
  let output = "=== Check Runs ===\n";
  let failures = 0;

  for (const r of results) {
    if (r.id === "N/A") {
      output += `  (${r.message})\n`;
      continue;
    }

    const symbol = r.ok ? "✓" : "✗";
    output += `${symbol} ${r.id}  ${r.name}  ${r.status}  ${r.message}\n`;
    if (!r.ok) failures++;
  }

  return { output, failures };
}

function formatChainResults(fileResults: FileChainResult[]): { output: string; failures: number } {
  let output = "";
  let failures = 0;

  if (fileResults.length === 0) {
    output += "=== Handoff Merkle Chain ===\n  (no handoff log files found)\n";
    return { output, failures };
  }

  for (const fr of fileResults) {
    const fileName = basename(fr.filePath);
    output += `\n=== Handoff Merkle Chain (${fileName}) ===\n`;

    for (const r of fr.results) {
      if (r.entryId === "N/A") {
        output += `  (${r.message})\n`;
        continue;
      }

      const symbol = r.ok ? "✓" : "✗";
      output += `${symbol} line-${r.lineNumber}  ${r.entryId}  ${r.message}\n`;
      if (!r.ok) failures++;
    }
  }

  return { output, failures };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const taskId = process.argv[2] ?? undefined;

  if (taskId) {
    console.log(`Verifying provenance for task: ${taskId}\n`);
  } else {
    console.log("Verifying provenance for all data\n");
  }

  const db = openDb();

  // Phase 1 — check run hashes
  const checkRunResults = verifyCheckRuns(db, taskId);
  const { output: crOutput, failures: crFailures } = formatCheckRunResults(checkRunResults);
  process.stdout.write(crOutput + "\n");

  db.close();

  // Phase 3 — Merkle chain
  const chainResults = verifyHandoffLogs(taskId);
  const { output: chainOutput, failures: chainFailures } = formatChainResults(chainResults);
  process.stdout.write(chainOutput + "\n");

  // Summary
  const totalFailures = crFailures + chainFailures;
  const parts: string[] = [];
  if (crFailures > 0) parts.push(`${crFailures} check run mismatch${crFailures !== 1 ? "es" : ""}`);
  if (chainFailures > 0) parts.push(`${chainFailures} chain break${chainFailures !== 1 ? "s" : ""}`);

  if (totalFailures === 0) {
    console.log("RESULT: PASS");
    process.exit(0);
  } else {
    console.log(`RESULT: FAIL (${parts.join(", ")})`);
    process.exit(1);
  }
}

await main();
