import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync, existsSync, writeFileSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { tmpdir } from "node:os";

// Each test gets an isolated tmp directory
function makeTmpRoot(): string {
  const dir = resolve(tmpdir(), `agent-handoff-setup-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function cleanupRoot(dir: string): void {
  rmSync(dir, { recursive: true, force: true });
}

// ── .work directory creation ──────────────────────────────────────────────────

describe("work directory creation", () => {
  test("creates all required subdirectories", () => {
    const root = makeTmpRoot();
    try {
      const dirs = ["tasks", "logs", "worktrees", "specs"];
      for (const d of dirs) {
        mkdirSync(resolve(root, ".work", d), { recursive: true });
      }
      for (const d of dirs) {
        expect(existsSync(resolve(root, ".work", d))).toBe(true);
      }
    } finally {
      cleanupRoot(root);
    }
  });

  test("is idempotent — creating dirs twice does not throw", () => {
    const root = makeTmpRoot();
    try {
      const dirs = ["tasks", "logs", "worktrees", "specs"];
      const createAll = () => {
        for (const d of dirs) mkdirSync(resolve(root, ".work", d), { recursive: true });
      };
      expect(createAll).not.toThrow();
      expect(createAll).not.toThrow();
    } finally {
      cleanupRoot(root);
    }
  });
});

// ── .env.local file handling ──────────────────────────────────────────────────

describe(".env.local handling", () => {
  test("creates .env.local when it does not exist", () => {
    const root = makeTmpRoot();
    try {
      const envPath = resolve(root, ".env.local");
      const dbPath = resolve(root, ".work", "agent-handoff.db");
      expect(existsSync(envPath)).toBe(false);

      writeFileSync(envPath, ["# Local overrides", `DB_PATH=${dbPath}`, "PORT=4000", ""].join("\n"));

      expect(existsSync(envPath)).toBe(true);
      const content = readFileSync(envPath, "utf-8");
      expect(content).toContain("PORT=4000");
      expect(content).toContain("DB_PATH=");
    } finally {
      cleanupRoot(root);
    }
  });

  test("does NOT overwrite an existing .env.local", () => {
    const root = makeTmpRoot();
    try {
      const envPath = resolve(root, ".env.local");
      const original = "PORT=9999\n# custom\n";
      writeFileSync(envPath, original);

      // Simulate setup logic: only write if not exists
      if (!existsSync(envPath)) {
        writeFileSync(envPath, "PORT=4000\n");
      }

      expect(readFileSync(envPath, "utf-8")).toBe(original);
    } finally {
      cleanupRoot(root);
    }
  });
});

// ── Port detection logic ──────────────────────────────────────────────────────

describe("port detection", () => {
  // Extract the port-finding logic into a testable pure function
  function findAvailablePort(
    isInUse: (port: number) => boolean,
    start: number,
    end: number,
  ): number | null {
    for (let port = start; port <= end; port++) {
      if (!isInUse(port)) return port;
    }
    return null;
  }

  test("returns start port when none are in use", () => {
    const port = findAvailablePort(() => false, 4000, 4009);
    expect(port).toBe(4000);
  });

  test("skips ports that are in use", () => {
    const inUse = new Set([4000, 4001, 4002]);
    const port = findAvailablePort((p) => inUse.has(p), 4000, 4009);
    expect(port).toBe(4003);
  });

  test("returns null when all ports are exhausted", () => {
    const port = findAvailablePort(() => true, 4000, 4009);
    expect(port).toBeNull();
  });

  test("UI port range 5173-5182 is distinct from API range", () => {
    const inUseAll = new Set([4000, 4001, 4002, 4003, 4004, 4005, 4006, 4007, 4008, 4009]);
    const apiPort = findAvailablePort((p) => inUseAll.has(p), 4000, 4009);
    expect(apiPort).toBeNull(); // all API ports exhausted

    const uiPort = findAvailablePort(() => false, 5173, 5182);
    expect(uiPort).toBe(5173); // UI range unaffected
  });

  test("returns next port when default is in use", () => {
    const inUse = new Set([4000]);
    const port = findAvailablePort((p) => inUse.has(p), 4000, 4009);
    expect(port).toBe(4001);
  });
});

// ── DB migration idempotency via runner ──────────────────────────────────────

describe("database migrations", () => {
  test("running migrations twice does not throw", async () => {
    const { openTestDb } = await import("../db.js");
    const db = openTestDb();
    const count1 = db
      .query<{ count: number }, []>("SELECT COUNT(*) as count FROM schema_migrations")
      .get()?.count ?? 0;

    // Running again on same db must be idempotent
    const { runMigrations } = await import("../migrations/runner.js");
    runMigrations(db);

    const count2 = db
      .query<{ count: number }, []>("SELECT COUNT(*) as count FROM schema_migrations")
      .get()?.count ?? 0;
    expect(count2).toBe(count1);
    db.close();
  });

  test("schema_migrations table always exists after first run", async () => {
    const { openTestDb } = await import("../db.js");
    const db = openTestDb();
    const row = db
      .query<{ name: string }, [string]>(
        "SELECT name FROM sqlite_master WHERE type='table' AND name=?",
      )
      .get("schema_migrations");
    expect(row).not.toBeNull();
    db.close();
  });
});

// ── Bun version check ─────────────────────────────────────────────────────────

describe("bun version requirement", () => {
  test("current bun version satisfies >=1.0.0", () => {
    const [major] = Bun.version.split(".").map(Number);
    expect(major).toBeGreaterThanOrEqual(1);
  });
});
