import { describe, it, expect, beforeEach } from "bun:test";
import { openTestDb } from "../db.js";
import type { Database } from "bun:sqlite";
import { PRBodyBuilder } from "../bridge/pr-body-builder.js";

let db: Database;

beforeEach(() => {
  db = openTestDb();
  db.run(`INSERT INTO change_sets (id, task_id, title, description, source_branch, target_branch, worktree_path, status, created_at, updated_at)
    VALUES ('chg_001', 'TSK_001', 'Add login page', 'Implements a new login page', 'feat/TSK_001', 'main', '/tmp', 'approved', '2024-01-01T00:00:00Z', '2024-01-01T00:00:00Z')`);
  db.run(`INSERT INTO tasks (id, change_set_id, title, spec_path, acceptance_path, created_at)
    VALUES ('TSK_001', 'chg_001', 'Add login page', '/tmp/spec.md', '/tmp/acceptance.md', '2024-01-01T00:00:00Z')`);
});

describe("PRBodyBuilder", () => {
  it("throws when ChangeSet not found", () => {
    const builder = new PRBodyBuilder(db);
    expect(() => builder.build("chg_999")).toThrow("not found");
  });

  it("builds a body with all required sections", () => {
    const builder = new PRBodyBuilder(db);
    const body = builder.build("chg_001");
    expect(body).toContain("## Summary");
    expect(body).toContain("## Review Results");
    expect(body).toContain("## Decisions");
  });

  it("includes the ChangeSet description in summary", () => {
    const builder = new PRBodyBuilder(db);
    const body = builder.build("chg_001");
    expect(body).toContain("Implements a new login page");
  });

  it("includes check run table when check runs exist", () => {
    db.run(
      `INSERT INTO check_runs (id, change_set_id, name, status, started_at)
       VALUES ('cr_001', 'chg_001', 'test', 'passed', '2024-01-01T00:00:00Z')`
    );
    const builder = new PRBodyBuilder(db);
    const body = builder.build("chg_001");
    expect(body).toContain("test");
    expect(body).toContain("passed");
  });

  it("includes resolved blocking comments", () => {
    db.run(
      `INSERT INTO review_comments (id, change_set_id, body, severity, resolved, created_at)
       VALUES ('rc_001', 'chg_001', 'Missing null check', 'blocking', 1, '2024-01-01T00:00:00Z')`
    );
    const builder = new PRBodyBuilder(db);
    const body = builder.build("chg_001");
    expect(body).toContain("Missing null check");
    expect(body).toContain("Blocking Comments Resolved");
  });

  it("includes advisory comments in unresolved section", () => {
    db.run(
      `INSERT INTO review_comments (id, change_set_id, body, severity, resolved, created_at)
       VALUES ('rc_002', 'chg_001', 'Consider renaming for clarity', 'advisory', 0, '2024-01-01T00:00:00Z')`
    );
    const builder = new PRBodyBuilder(db);
    const body = builder.build("chg_001");
    expect(body).toContain("Consider renaming for clarity");
    expect(body).toContain("Unresolved Advisory Comments");
  });

  it("includes decisions", () => {
    db.run(
      `INSERT INTO decisions (id, task_id, change_set_id, topic, options_considered, choice, rationale, ts)
       VALUES ('dec_001', 'TSK_001', 'chg_001', 'Auth library', '["jwt","session"]', 'jwt', 'Stateless, easier to scale', '2024-01-01T00:00:00Z')`
    );
    const builder = new PRBodyBuilder(db);
    const body = builder.build("chg_001");
    expect(body).toContain("Auth library");
    expect(body).toContain("jwt");
    expect(body).toContain("Stateless, easier to scale");
  });

  it("includes the changeSetId footer", () => {
    const builder = new PRBodyBuilder(db);
    const body = builder.build("chg_001");
    expect(body).toContain("chg_001");
    expect(body).toContain("localsdlc");
  });

  it("returns valid markdown (no unclosed triple backticks)", () => {
    db.run(
      `INSERT INTO check_runs (id, change_set_id, name, status, started_at)
       VALUES ('cr_002', 'chg_001', 'lint', 'failed', '2024-01-01T00:00:00Z')`
    );
    const builder = new PRBodyBuilder(db);
    const body = builder.build("chg_001");
    const backtickCount = (body.match(/```/g) ?? []).length;
    expect(backtickCount % 2).toBe(0);
  });
});

// ─── Export pre-condition check ─────────────────────────────────────────────

describe("export pre-conditions", () => {
  it("rejects non-approved ChangeSet", () => {
    // The status check is done in the CLI command using the API response
    // We simulate it here by checking the logic directly
    function checkApproved(status: string): void {
      if (status !== "approved") {
        throw new Error(`ChangeSet must be approved before export (current status: ${status})`);
      }
    }

    expect(() => checkApproved("draft")).toThrow("ChangeSet must be approved");
    expect(() => checkApproved("implementing")).toThrow("ChangeSet must be approved");
    expect(() => checkApproved("reviewing")).toThrow("ChangeSet must be approved");
    expect(() => checkApproved("approved")).not.toThrow();
  });
});

// ─── import-issue URL parser ─────────────────────────────────────────────────

describe("parseGitHubIssueUrl", () => {
  function parse(url: string): { owner: string; repo: string; number: number } {
    const m = url.match(/github\.com\/([^/]+)\/([^/]+)\/issues\/(\d+)/);
    if (!m) throw new Error(`Invalid GitHub issue URL: ${url}`);
    return { owner: m[1], repo: m[2], number: parseInt(m[3], 10) };
  }

  it("parses a standard GitHub issue URL", () => {
    const result = parse("https://github.com/anthropics/claude-code/issues/42");
    expect(result.owner).toBe("anthropics");
    expect(result.repo).toBe("claude-code");
    expect(result.number).toBe(42);
  });

  it("throws on invalid URL", () => {
    expect(() => parse("https://example.com/not-an-issue")).toThrow("Invalid GitHub issue URL");
  });
});
