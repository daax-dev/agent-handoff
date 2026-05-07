import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import type { Database } from "bun:sqlite";
import { resolve } from "node:path";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { openTestDb } from "../db.js";
import { createChangeSet } from "../domain/change-set.js";
import { listCheckRuns, allRequiredPassed } from "../domain/check-run.js";
import { CheckRunner } from "../checks/runner.js";
import type { CheckConfig } from "../checks/check-config.js";
import { createApiServer } from "../api/server.js";

const MIGRATIONS_DIR = resolve(process.cwd(), "migrations");
const REPO_ROOT = resolve(process.cwd());

let db: Database;

function newCs(suffix = "001") {
  return createChangeSet(db, {
    task_id: `TSK_${suffix.padStart(6, "0")}`,
    title: `Test CS ${suffix}`,
    source_branch: `feat/TSK-${suffix}`,
    worktree_path: REPO_ROOT, // use repo root as "worktree" for tests
  });
}

// Minimal check configs using shell commands that don't spawn recursive tests
const PASS_CHECK: CheckConfig = { name: "typecheck", command: "true", required: true };
const FAIL_CHECK: CheckConfig = { name: "lint",      command: "false", required: true };
const SKIP_CHECK: CheckConfig = { name: "test",      command: "true", required: true };

beforeEach(() => {
  db = openTestDb(MIGRATIONS_DIR);
});

afterEach(() => {
  // Clean up log files created during tests
  const logsDir = resolve(REPO_ROOT, ".work", "logs");
  for (const suffix of ["000001", "000002", "000003", "000004", "000005"]) {
    const logPath = resolve(logsDir, `TSK_${suffix}.log`);
    if (existsSync(logPath)) rmSync(logPath);
  }
  db.close();
});

describe("CheckRunner lifecycle", () => {
  test("creates check_run rows for each configured check", async () => {
    const cs = newCs("001");
    const runner = new CheckRunner(db, REPO_ROOT, [PASS_CHECK, SKIP_CHECK]);
    await runner.run(cs.id, REPO_ROOT);

    const runs = listCheckRuns(db, cs.id);
    expect(runs).toHaveLength(2);
    expect(runs.every((r) => r.status === "passed")).toBe(true);
    expect(runs.every((r) => r.exit_code === 0)).toBe(true);
    expect(runs.every((r) => r.completed_at !== null)).toBe(true);
  });

  test("failing check records status=failed with non-zero exit_code", async () => {
    const cs = newCs("002");
    const runner = new CheckRunner(db, REPO_ROOT, [FAIL_CHECK]);
    await runner.run(cs.id, REPO_ROOT);

    const runs = listCheckRuns(db, cs.id);
    expect(runs).toHaveLength(1);
    expect(runs[0].status).toBe("failed");
    expect(runs[0].exit_code).not.toBe(0);
  });

  test("allRequiredPassed returns false when a required check failed", async () => {
    const cs = newCs("003");
    const runner = new CheckRunner(db, REPO_ROOT, [PASS_CHECK, FAIL_CHECK]);
    await runner.run(cs.id, REPO_ROOT);

    expect(runner.allRequiredPassed(cs.id)).toBe(false);
  });

  test("allRequiredPassed returns true when all required checks passed", async () => {
    const cs = newCs("004");
    const runner = new CheckRunner(db, REPO_ROOT, [PASS_CHECK, SKIP_CHECK]);
    await runner.run(cs.id, REPO_ROOT);

    expect(runner.allRequiredPassed(cs.id)).toBe(true);
  });

  test("check output appears in task log file", async () => {
    const cs = newCs("005");
    const echoCheck: CheckConfig = {
      name: "custom",
      command: "echo hello_from_check",
      required: false,
    };
    const runner = new CheckRunner(db, REPO_ROOT, [echoCheck]);
    await runner.run(cs.id, REPO_ROOT);

    const logPath = resolve(REPO_ROOT, ".work", "logs", "TSK_000005.log");
    expect(existsSync(logPath)).toBe(true);
    const content = readFileSync(logPath, "utf-8");
    expect(content).toContain("hello_from_check");
  });
});

describe("allRequiredPassed domain function", () => {
  test("returns false when no check runs exist", () => {
    const cs = newCs("010");
    expect(allRequiredPassed(db, cs.id, ["typecheck", "lint", "test"])).toBe(false);
  });
});

describe("GET /api/change-sets/:id/check-runs", () => {
  test("returns list of check runs", async () => {
    const cs = newCs("020");
    const runner = new CheckRunner(db, REPO_ROOT, [PASS_CHECK, SKIP_CHECK]);
    await runner.run(cs.id, REPO_ROOT);

    const { server } = createApiServer({ db, port: 0 });
    const url = `http://localhost:${server.port}/api/change-sets/${cs.id}/check-runs`;
    const res = await fetch(url);
    expect(res.status).toBe(200);
    const data = await res.json() as unknown[];
    expect(data).toHaveLength(2);
    server.stop();
  });
});
