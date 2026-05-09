import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { spawnSync } from "node:child_process";
import { resolve, join } from "node:path";
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { openTestDb } from "../db.js";
import { SSEBroadcaster } from "../api/sse.js";
import { createApiServer } from "../api/server.js";

const MIGRATIONS_DIR = resolve(process.cwd(), "migrations");
const CLI = resolve(process.cwd(), "src/cli/localsdlc.ts");

// ---------------------------------------------------------------------------
// Integration test server (shared across integration describe blocks)
// ---------------------------------------------------------------------------

let db: ReturnType<typeof openTestDb>;
let sse: SSEBroadcaster;
let server: ReturnType<typeof Bun.serve>;
let BASE: string;
let tmpDir: string;
let integrationEnv: NodeJS.ProcessEnv;

beforeAll(() => {
  // Disable HITL in the test process so the API server also sees it disabled.
  // CLI subprocesses get it via integrationEnv, but the in-process server reads process.env.
  process.env.LOCALSDLC_HITL_ENABLED = "false";
  tmpDir = mkdtempSync(join(tmpdir(), "localsdlc-cli-integ-"));
  db = openTestDb(MIGRATIONS_DIR);
  sse = new SSEBroadcaster();
  const result = createApiServer({ db, sse, port: 0, repoRoot: tmpDir });
  server = result.server;
  BASE = `http://localhost:${server.port}`;
  integrationEnv = {
    ...process.env,
    LOCALSDLC_API_URL: BASE,
    EDITOR: "true",
    LOCALSDLC_HITL_ENABLED: "false",
  };
});

afterAll(() => {
  delete process.env.LOCALSDLC_HITL_ENABLED;
  sse.close();
  server.stop(true);
  db.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

function cli(...args: string[]): { stdout: string; stderr: string; exitCode: number } {
  const r = spawnSync("bun", [CLI, ...args], {
    encoding: "utf-8",
    env: integrationEnv,
    timeout: 15_000,
  });
  return { stdout: r.stdout ?? "", stderr: r.stderr ?? "", exitCode: r.status ?? 1 };
}

function cliWithStdin(stdin: string, ...args: string[]): { stdout: string; stderr: string; exitCode: number } {
  const r = spawnSync("bun", [CLI, ...args], {
    encoding: "utf-8",
    env: integrationEnv,
    input: stdin,
    timeout: 15_000,
  });
  return { stdout: r.stdout ?? "", stderr: r.stderr ?? "", exitCode: r.status ?? 1 };
}

// ---------------------------------------------------------------------------
// CLI smoke tests — no API server required
// ---------------------------------------------------------------------------

describe("localsdlc CLI smoke tests", () => {
  test("--help exits 0 and lists all subcommands", () => {
    const result = spawnSync("bun", [CLI, "--help"], { encoding: "utf-8" });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("agent-handoff");
    expect(result.stdout).toContain("init");
    expect(result.stdout).toContain("new");
    expect(result.stdout).toContain("status");
    expect(result.stdout).toContain("review");
    expect(result.stdout).toContain("approve");
    expect(result.stdout).toContain("merge");
    expect(result.stdout).toContain("export");
    expect(result.stdout).toContain("import-issue");
  });

  test("--version exits 0 and prints version", () => {
    const result = spawnSync("bun", [CLI, "--version"], { encoding: "utf-8" });
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toMatch(/^\d+\.\d+\.\d+$/);
  });

  test("init subcommand --help describes its purpose", () => {
    const result = spawnSync("bun", [CLI, "init", "--help"], { encoding: "utf-8" });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain(".work/");
  });

  test("unknown subcommand exits non-zero", () => {
    const result = spawnSync("bun", [CLI, "notacommand"], { encoding: "utf-8" });
    expect(result.status).not.toBe(0);
  });

  test("export --help shows --dry-run option", () => {
    const result = spawnSync("bun", [CLI, "export", "--help"], { encoding: "utf-8" });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("--dry-run");
  });

  test("import-issue --help shows <url> argument", () => {
    const result = spawnSync("bun", [CLI, "import-issue", "--help"], { encoding: "utf-8" });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("url");
  });
});

// ---------------------------------------------------------------------------
// API key hygiene: no direct Anthropic API key usage in non-test src/
// ---------------------------------------------------------------------------

describe("No API key usage in source", () => {
  test("src/ (excluding tests) has no direct Anthropic API key env access", () => {
    const pattern = "ANTHROP" + "IC_API_KEY";
    const result = spawnSync(
      "grep",
      ["-r", "--include=*.ts", "--exclude-dir=__tests__", "-l", pattern, "src/"],
      { encoding: "utf-8" }
    );
    const matchedFiles = result.stdout.trim();
    expect(matchedFiles).toBe("");
  });
});

// ---------------------------------------------------------------------------
// PRD-016 integration: localsdlc init
// ---------------------------------------------------------------------------

describe("localsdlc init — integration (PRD-016 acceptance: init creates .work/ structure)", () => {
  test("creates worktrees/, tasks/, logs/ in a fresh temp dir", () => {
    const initDir = mkdtempSync(join(tmpdir(), "localsdlc-init-"));
    try {
      const result = spawnSync("bun", [CLI, "init"], {
        encoding: "utf-8",
        env: integrationEnv,
        cwd: initDir,
        timeout: 15_000,
      });
      expect(result.status).toBe(0);
      expect(existsSync(join(initDir, ".work", "worktrees"))).toBe(true);
      expect(existsSync(join(initDir, ".work", "tasks"))).toBe(true);
      expect(existsSync(join(initDir, ".work", "logs"))).toBe(true);
    } finally {
      rmSync(initDir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// PRD-016 integration: localsdlc new
// ---------------------------------------------------------------------------

describe("localsdlc new — integration (PRD-016 acceptance: new creates Task + ChangeSet)", () => {
  test("exits 0 and prints 'Created TSK_... / chg_...'", () => {
    const { stdout, exitCode } = cli("new", "My integration feature");
    expect(exitCode).toBe(0);
    expect(stdout).toMatch(/Created TSK_\d{6} \/ chg_\d{6}/);
  });
});

// ---------------------------------------------------------------------------
// PRD-016 integration: localsdlc status
// ---------------------------------------------------------------------------

describe("localsdlc status — integration (PRD-016 acceptance: status lists active ChangeSets)", () => {
  test("exits 0 and prints ChangeSets in table form", async () => {
    await fetch(`${BASE}/api/change-sets/quick-create`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Status list test" }),
    });
    const { stdout, exitCode } = cli("status");
    expect(exitCode).toBe(0);
    expect(stdout.toLowerCase()).toMatch(/chg_|no changesets/i);
  });

  test("exits 0 and shows detail for a valid ChangeSet id (PRD-016 acceptance: status <id> prints detail)", async () => {
    const res = await fetch(`${BASE}/api/change-sets/quick-create`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Status detail test" }),
    });
    const cs = (await res.json()) as { id: string };
    const { stdout, exitCode } = cli("status", cs.id);
    expect(exitCode).toBe(0);
    expect(stdout).toContain(cs.id);
  });

  test("exits 1 with helpful message when API server not running", () => {
    const offlineEnv = { ...integrationEnv, LOCALSDLC_API_URL: "http://localhost:19999" };
    const result = spawnSync("bun", [CLI, "status"], {
      encoding: "utf-8",
      env: offlineEnv,
      timeout: 15_000,
    });
    expect(result.status).toBe(1);
    expect(result.stderr.toLowerCase()).toMatch(/api|not running|server/i);
  });
});

// ---------------------------------------------------------------------------
// PRD-016 integration: localsdlc approve — confirmation prompt
// ---------------------------------------------------------------------------

describe("localsdlc approve — confirmation (PRD-016 acceptance: approve prompts for confirmation)", () => {
  test("'n' cancels without calling the approve API — ChangeSet status is unchanged", async () => {
    const res = await fetch(`${BASE}/api/change-sets/quick-create`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Approve cancel test" }),
    });
    const cs = (await res.json()) as { id: string };

    const { stdout, exitCode } = cliWithStdin("n\n", "approve", cs.id);
    expect(exitCode).toBe(0);
    expect(stdout).toMatch(/cancelled/i);

    // Verify the status did NOT change (still "draft" from quick-create)
    const check = await fetch(`${BASE}/api/change-sets/${cs.id}`);
    const updated = (await check.json()) as { status: string };
    expect(updated.status).toBe("draft");
  });
});

// ---------------------------------------------------------------------------
// PRD-016: bin entry — package.json + shebang
// ---------------------------------------------------------------------------

describe("bin entry (PRD-016 acceptance: agent-handoff works when installed as bin)", () => {
  test("package.json bin.localsdlc points to dist/cli/localsdlc.js", () => {
    const pkg = JSON.parse(
      readFileSync(resolve(process.cwd(), "package.json"), "utf-8")
    ) as { bin: Record<string, string> };
    expect(pkg.bin.localsdlc).toBe("dist/cli/localsdlc.js");
  });

  test("src/cli/localsdlc.ts has #!/usr/bin/env node shebang", () => {
    const content = readFileSync(CLI, "utf-8");
    expect(content.startsWith("#!/usr/bin/env node")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// PRD-017 integration: localsdlc export --dry-run
// ---------------------------------------------------------------------------

describe("localsdlc export --dry-run (PRD-017 acceptance: dry-run prints plan without calling gh)", () => {
  test("prints 'Would push' and PR body for an approved ChangeSet", async () => {
    const createRes = await fetch(`${BASE}/api/change-sets/quick-create`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Export dry-run test" }),
    });
    const cs = (await createRes.json()) as { id: string };

    // Step to "approved" via valid direct overrides (HITL disabled)
    for (const status of ["planned", "implementing", "reviewing", "approved"] as const) {
      await fetch(`${BASE}/api/change-sets/${cs.id}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
    }

    const { stdout, exitCode } = cli("export", cs.id, "--dry-run");
    expect(exitCode).toBe(0);
    expect(stdout).toContain("Would push");
    expect(stdout).toContain("Would create PR");
  });

  test("exits 1 and prints 'approved' error for non-approved ChangeSet (PRD-017 acceptance: pre-condition check)", async () => {
    const createRes = await fetch(`${BASE}/api/change-sets/quick-create`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Non-approved export test" }),
    });
    const cs = (await createRes.json()) as { id: string };

    const { stderr, exitCode } = cli("export", cs.id, "--dry-run");
    expect(exitCode).toBe(1);
    expect(stderr.toLowerCase()).toContain("approved");
  });
});

// ---------------------------------------------------------------------------
// PRD-017 integration: localsdlc import-issue — mocked gh
// ---------------------------------------------------------------------------

describe("localsdlc import-issue — mocked gh (PRD-017 acceptance: import-issue creates Task with correct title)", () => {
  test("creates ChangeSet with issue title when gh returns valid JSON", async () => {
    const fakeBin = mkdtempSync(join(tmpdir(), "fake-gh-"));
    const issueJson = JSON.stringify({
      title: "Fix critical auth bypass",
      body: "## Description\nCritical auth bypass.",
      number: 42,
      labels: [],
    });
    writeFileSync(
      join(fakeBin, "gh"),
      `#!/usr/bin/env bash\ncat <<'EOFGH'\n${issueJson}\nEOFGH\n`,
      { mode: 0o755 }
    );
    try {
      const importEnv = { ...integrationEnv, PATH: `${fakeBin}:${process.env.PATH}` };
      const result = spawnSync(
        "bun",
        [CLI, "import-issue", "https://github.com/x/y/issues/42"],
        { encoding: "utf-8", env: importEnv, timeout: 15_000 }
      );
      expect(result.status).toBe(0);
      expect(result.stdout).toMatch(/Created TSK_/);
      const list = await fetch(`${BASE}/api/change-sets`);
      const changeSets = (await list.json()) as Array<{ title: string; github_issue_url: string }>;
      const imported = changeSets.find((cs) => cs.github_issue_url === "https://github.com/x/y/issues/42");
      expect(imported).toBeDefined();
      expect(imported!.title).toBe("Fix critical auth bypass");
    } finally {
      rmSync(fakeBin, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// PRD-016 failure condition: localsdlc merge rejects non-approved ChangeSet
// ---------------------------------------------------------------------------

describe("localsdlc merge — failure condition (PRD-016: merge rejects non-approved ChangeSet)", () => {
  test("exits 1 and surfaces API error when ChangeSet is not approved", async () => {
    const res = await fetch(`${BASE}/api/change-sets/quick-create`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Merge fail test" }),
    });
    const cs = (await res.json()) as { id: string };
    const { stderr, exitCode } = cli("merge", cs.id);
    expect(exitCode).toBe(1);
    expect(stderr.toLowerCase()).toMatch(/invalid|transition|draft|approved/i);
  });
});
