import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import type { Database } from "bun:sqlite";
import { resolve } from "node:path";
import { mkdtempSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { openTestDb } from "../db.js";
import { createChangeSet } from "../domain/change-set.js";
import { HandoffContextBuilder } from "../context/handoff-context.js";
import { AgentRoleRegistry, resetRegistry } from "../roles/registry.js";
import { SpecStore } from "../spec/store.js";
import { estimateTokens, truncateToTokens } from "../context/token-estimator.js";
import { TOTAL_TOKEN_BUDGET } from "../context/slots.js";

const MIGRATIONS_DIR = resolve(process.cwd(), "migrations");
const REPO_ROOT = resolve(process.cwd());

let db: Database;
let tmpDir: string;

beforeEach(() => {
  db = openTestDb(MIGRATIONS_DIR);
  tmpDir = mkdtempSync(resolve(tmpdir(), "hctx-test-"));
  resetRegistry();
});

afterEach(() => {
  db.close();
  rmSync(tmpDir, { recursive: true, force: true });
  resetRegistry();
});

function makeCs(db: Database) {
  return createChangeSet(db, {
    task_id: "TSK_000001",
    title: "Context test",
    source_branch: "feat/TSK-000001",
    worktree_path: "/nonexistent/path",
  });
}

// ---------------------------------------------------------------------------
// Token estimator
// ---------------------------------------------------------------------------

describe("tokenEstimator", () => {
  test("estimates tokens as ceil(chars / 4)", () => {
    expect(estimateTokens("")).toBe(0);
    expect(estimateTokens("abcd")).toBe(1);
    expect(estimateTokens("abcde")).toBe(2);
    expect(estimateTokens("a".repeat(100))).toBe(25);
  });

  test("truncateToTokens returns text unchanged if within budget", () => {
    const result = truncateToTokens("hello world", 100);
    expect(result.truncated).toBe(false);
    expect(result.text).toBe("hello world");
  });

  test("truncateToTokens truncates at word boundary", () => {
    const long = "word ".repeat(1000);
    const { text, truncated } = truncateToTokens(long, 50);
    expect(truncated).toBe(true);
    expect(estimateTokens(text)).toBeLessThanOrEqual(50 + 5); // small overage for suffix
    // Must end cleanly (no mid-word cut)
    const withoutSuffix = text.split("\n[truncated")[0];
    expect(withoutSuffix.endsWith("word")).toBe(true);
  });

  test("truncateToTokens includes ref path in suffix", () => {
    const long = "x".repeat(500);
    const { text } = truncateToTokens(long, 10, "some/path.md");
    expect(text).toContain("some/path.md");
  });
});

// ---------------------------------------------------------------------------
// Token budget
// ---------------------------------------------------------------------------

describe("TOTAL_TOKEN_BUDGET", () => {
  test("total budget is 9728", () => {
    expect(TOTAL_TOKEN_BUDGET).toBe(9728);
  });
});

// ---------------------------------------------------------------------------
// HandoffContextBuilder
// ---------------------------------------------------------------------------

describe("HandoffContextBuilder", () => {
  test("build() returns tokenEstimate <= 9728", async () => {
    const reg = new AgentRoleRegistry(REPO_ROOT);
    const cs = makeCs(db);
    const builder = new HandoffContextBuilder(db, tmpDir, reg);
    const payload = await builder.build(cs.id, "reviewer");
    expect(payload.tokenEstimate).toBeLessThanOrEqual(TOTAL_TOKEN_BUDGET);
  });

  test("build() with large spec lists taskSpec in truncatedSlots", async () => {
    const reg = new AgentRoleRegistry(REPO_ROOT);
    const cs = makeCs(db);

    // Write a spec larger than 2048 tokens (8192+ chars)
    const store = new SpecStore(tmpDir);
    store.write("TSK_000001", "spec", "word ".repeat(3000));

    const builder = new HandoffContextBuilder(db, tmpDir, reg);
    const payload = await builder.build(cs.id, "reviewer");

    expect(payload.truncatedSlots).toContain("taskSpec");
    expect(payload.tokenEstimate).toBeLessThanOrEqual(TOTAL_TOKEN_BUDGET);
  });

  test("build() with no spec still returns valid payload", async () => {
    const reg = new AgentRoleRegistry(REPO_ROOT);
    const cs = makeCs(db);
    const builder = new HandoffContextBuilder(db, tmpDir, reg);
    const payload = await builder.build(cs.id, "planner");
    expect(payload.taskSpec).toBeTruthy();
    expect(payload.tokenEstimate).toBeGreaterThan(0);
  });

  test("diff unavailable returns [diff unavailable] gracefully", async () => {
    // worktree_path is /nonexistent/path — git diff will fail
    const reg = new AgentRoleRegistry(REPO_ROOT);
    const cs = makeCs(db);
    const builder = new HandoffContextBuilder(db, tmpDir, reg);
    const payload = await builder.build(cs.id, "reviewer");
    expect(
      payload.diff === "[diff unavailable]" || payload.diff === "[no diff yet]"
    ).toBe(true);
  });

  test("blocking comments appear in payload when present", async () => {
    const reg = new AgentRoleRegistry(REPO_ROOT);
    const cs = makeCs(db);

    db.run(
      `INSERT INTO review_comments
         (id, change_set_id, author_agent, author_role, body, severity, resolved, created_at)
       VALUES ('cmt_001', ?, 'reviewer', 'reviewer', 'This is broken', 'blocking', 0, ?)`,
      [cs.id, new Date().toISOString()]
    );

    const builder = new HandoffContextBuilder(db, tmpDir, reg);
    const payload = await builder.build(cs.id, "fixer");
    expect(payload.blockingComments).toContain("This is broken");
  });

  test("no blocking comments returns [no blocking comments]", async () => {
    const reg = new AgentRoleRegistry(REPO_ROOT);
    const cs = makeCs(db);
    const builder = new HandoffContextBuilder(db, tmpDir, reg);
    const payload = await builder.build(cs.id, "reviewer");
    expect(payload.blockingComments).toBe("[no blocking comments]");
  });

  test("rolePrompt contains the role-specific instruction text", async () => {
    const reg = new AgentRoleRegistry(REPO_ROOT);
    const cs = makeCs(db);
    const builder = new HandoffContextBuilder(db, tmpDir, reg);
    const payload = await builder.build(cs.id, "planner");
    expect(payload.rolePrompt).toContain("Planner Agent");
    expect(payload.rolePrompt).not.toContain("{{handoff_context}}");
  });

  test("buildString renders all sections", () => {
    const reg = new AgentRoleRegistry(REPO_ROOT);
    const builder = new HandoffContextBuilder(db, REPO_ROOT, reg);
    const str = builder.buildString({
      taskSpec: "SPEC",
      diff: "DIFF",
      acceptanceCriteria: "ACC",
      blockingComments: "COMMENTS",
      architectureContext: "ARCH",
    });
    expect(str).toContain("## Task Spec");
    expect(str).toContain("SPEC");
    expect(str).toContain("## Diff");
    expect(str).toContain("DIFF");
    expect(str).toContain("## Acceptance Criteria");
    expect(str).toContain("## Blocking Comments");
    expect(str).toContain("## Architecture Context");
  });

  test("unknown role throws from registry", async () => {
    const reg = new AgentRoleRegistry(REPO_ROOT);
    const cs = makeCs(db);
    const builder = new HandoffContextBuilder(db, tmpDir, reg);
    await expect(builder.build(cs.id, "nonexistent_role")).rejects.toThrow();
  });
});
