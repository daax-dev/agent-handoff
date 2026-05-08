#!/usr/bin/env bun
import { mkdirSync, existsSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");

function ok(msg: string) { console.log(`  ✓ ${msg}`); }
function fail(msg: string): never { console.error(`  ✗ ${msg}`); process.exit(1); }

// 1. Check bun version
const [major] = Bun.version.split(".").map(Number);
if (major < 1) fail(`Bun >=1.0.0 required (found ${Bun.version}). Install: brew install oven-sh/bun/bun`);

console.log("\n  Agent Handoff — Setup\n");

// 2. Install dependencies
console.log("  → Installing root dependencies...");
const rootInstall = Bun.spawnSync(["bun", "install"], { cwd: ROOT, stdout: "inherit", stderr: "inherit" });
if (rootInstall.exitCode !== 0) fail("bun install failed in root");

console.log("  → Installing UI dependencies...");
const uiInstall = Bun.spawnSync(["bun", "install"], { cwd: resolve(ROOT, "ui"), stdout: "inherit", stderr: "inherit" });
if (uiInstall.exitCode !== 0) fail("bun install failed in ui/");
ok("Dependencies installed");

// Sign esbuild binaries — on macOS, newly downloaded esbuild binaries may be
// blocked by Gatekeeper (exit 137/SIGKILL) unless re-signed with a local identity.
// codesign --force --sign - is safe: it replaces the ad-hoc signature with a
// local ad-hoc signature that macOS accepts for developer-owned binaries.
if (process.platform === "darwin") {
  const esbuildPaths = [
    resolve(ROOT, "ui/node_modules/esbuild/bin/esbuild"),
    resolve(ROOT, "ui/node_modules/@esbuild/darwin-arm64/bin/esbuild"),
    resolve(ROOT, "ui/node_modules/@esbuild/darwin-x64/bin/esbuild"),
  ];
  for (const bin of esbuildPaths) {
    if (existsSync(bin)) {
      Bun.spawnSync(["codesign", "--force", "--sign", "-", bin], { stdout: "pipe", stderr: "pipe" });
    }
  }
  ok("esbuild binaries signed (macOS Gatekeeper)");
}

// 3. Create .work directories
const workDirs = ["tasks", "logs", "worktrees", "specs"];
for (const dir of workDirs) {
  mkdirSync(resolve(ROOT, ".work", dir), { recursive: true });
}
ok(".work/{tasks,logs,worktrees,specs} created");

// 4. Run DB migrations via getDb
const dbPath = process.env.DB_PATH ?? resolve(ROOT, ".work", "agent-handoff.db");
mkdirSync(dirname(dbPath), { recursive: true });

const { getDb } = await import(resolve(ROOT, "src/db.ts"));
const db = getDb(dbPath);

const migrationRow = db
  .query<{ count: number }, []>("SELECT COUNT(*) as count FROM schema_migrations")
  .get();
const migrationCount = migrationRow?.count ?? 0;
ok(`Database initialized (${migrationCount} migration${migrationCount !== 1 ? "s" : ""} applied)`);
console.log(`     DB: ${dbPath}`);

// 5. Seed agent_assignments defaults if table exists (added by PRD-020)
//    Also set auto_launch = 1 for all default GSD claude-code assignments
//    so that the warm-pool pre-warm logic (Issue #21) is active after setup.
let seededMsg = "";
try {
  const row = db.query<{ count: number }, []>("SELECT COUNT(*) as count FROM agent_assignments").get();
  seededMsg = `Agent assignments: ${row?.count ?? 0} defaults`;

  // Enable auto_launch for all GSD FSM states used by the UI/FSM.
  // Scope the update to the intended claude-code defaults and only change rows
  // that are still disabled so setup remains idempotent without skipping when
  // unrelated tools/states already have auto_launch enabled.
  const result = db.run(
    "UPDATE agent_assignments SET auto_launch = 1 " +
    "WHERE tool = 'claude-code' AND auto_launch = 0 AND fsm_state IN " +
    "('project_init','roadmap_ready','discussing','planning','plan_ready'," +
    " 'executing','verifying','gap_fixing','shipping','phase_done','milestone_complete','escalated')"
  );

  if (result.changes > 0) {
    seededMsg += `, auto_launch=1 on ${result.changes} GSD assignment(s)`;
  } else {
    seededMsg += `, claude-code GSD auto_launch already configured`;
  }
} catch {
  // PRD-020 not yet applied — skip silently
}
if (seededMsg) ok(seededMsg);

// 6. Write .env.local if it does not exist (never overwrite)
const envLocalPath = resolve(ROOT, ".env.local");
if (!existsSync(envLocalPath)) {
  writeFileSync(
    envLocalPath,
    [
      "# Local overrides — not committed to git",
      `DB_PATH=${dbPath}`,
      "PORT=4000",
      "",
    ].join("\n")
  );
  ok(".env.local created with defaults");
} else {
  ok(".env.local already exists — not overwritten");
}

// 7. Print summary
console.log(`
  ✓ Ready. Run: bun run dev:web
`);
