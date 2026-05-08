import { describe, test, expect, afterEach } from "./test-compat.js";
import { jest } from "bun:test";
import { logHandoff, truncatePrompt, logHandoffEvent } from "../src/utils/logger.js";
import { existsSync, readFileSync, readdirSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "node:os";
import { createHash, randomUUID } from "node:crypto";

/** SHA-256 hex of a UTF-8 string — mirrors verify-provenance.ts */
function sha256Hex(s: string): string {
  return createHash("sha256").update(s, "utf-8").digest("hex");
}

/** Parse all JSONL lines and find a record matching the given jobId */
function findLogEntry(logPath: string, jobId: string): Record<string, unknown> | undefined {
  if (!existsSync(logPath)) return undefined;
  const content = readFileSync(logPath, "utf-8");
  const lines = content.trim().split("\n").filter(Boolean);
  for (const line of lines) {
    const parsed = JSON.parse(line);
    if (parsed.jobId === jobId) return parsed;
  }
  return undefined;
}

describe("Logger", () => {
  test("logHandoff writes valid JSONL", () => {
    const entry = {
      timestamp: new Date().toISOString(),
      jobId: "hnd_testlog12345",
      transport: "cli" as const,
      agent: "claude",
      status: "completed" as const,
      exitCode: 0,
      durationMs: 5000,
      filesChanged: ["test.ts"],
    };

    logHandoff(entry);

    const date = new Date().toISOString().split("T")[0];
    const logPath = join(process.cwd(), ".logs", "tools", `handoff-${date}.jsonl`);
    expect(existsSync(logPath)).toBe(true);

    const content = readFileSync(logPath, "utf-8");
    const lines = content.trim().split("\n");
    const lastLine = lines[lines.length - 1];
    const parsed = JSON.parse(lastLine);
    expect(parsed.jobId).toBe("hnd_testlog12345");
    expect(parsed.transport).toBe("cli");
  });
});

describe("truncatePrompt", () => {
  test("returns short prompts unchanged", () => {
    expect(truncatePrompt("hello", 500)).toBe("hello");
  });

  test("returns prompts at exact maxLen unchanged", () => {
    const prompt = "a".repeat(500);
    expect(truncatePrompt(prompt, 500)).toBe(prompt);
  });

  test("truncates long prompts with ellipsis within maxLen", () => {
    const prompt = "a".repeat(600);
    const result = truncatePrompt(prompt, 500);
    expect(result.length).toBe(500);
    expect(result.endsWith("...")).toBe(true);
    expect(result).toBe("a".repeat(497) + "...");
  });

  test("handles very small maxLen", () => {
    const result = truncatePrompt("hello world", 3);
    expect(result.length).toBe(3);
    expect(result).toBe("hel");
  });

  test("handles maxLen just above ellipsis length", () => {
    const result = truncatePrompt("hello world", 4);
    expect(result).toBe("h...");
  });

  test("uses default maxLen of 500", () => {
    const prompt = "a".repeat(501);
    const result = truncatePrompt(prompt);
    expect(result.length).toBe(500);
  });
});

describe("logHandoffEvent", () => {
  const handoffLogDir = join(process.cwd(), ".logs", "handoffs");

  test("writes event to handoffs JSONL log", async () => {
    const jobId = `hnd_event_${Date.now()}`;
    const date = new Date().toISOString().split("T")[0]; // capture before write to avoid midnight flake
    await logHandoffEvent({
      timestamp: new Date().toISOString(),
      event: "task_created",
      jobId,
      transport: "cli",
      agent: "claude",
    });

    const logPath = join(handoffLogDir, `${date}.jsonl`);
    const entry = findLogEntry(logPath, jobId);
    expect(entry).toBeDefined();
    expect(entry!.event).toBe("task_created");
  });

  test("redacts prompts by default", async () => {
    const prev = process.env.HANDOFF_LOG_PROMPTS;
    const jobId = `hnd_redact_${Date.now()}`;
    try {
      delete process.env.HANDOFF_LOG_PROMPTS;

      const date = new Date().toISOString().split("T")[0]; // capture before write to avoid midnight flake
      await logHandoffEvent({
        timestamp: new Date().toISOString(),
        event: "task_created",
        jobId,
        transport: "cli",
        prompt: "this is a secret prompt with API_KEY=abc123",
      });

      const logPath = join(handoffLogDir, `${date}.jsonl`);
      const entry = findLogEntry(logPath, jobId);
      expect(entry).toBeDefined();
      expect(entry!.prompt as string).toContain("[redacted");
      expect(entry!.prompt as string).not.toContain("secret");
    } finally {
      if (prev !== undefined) {
        process.env.HANDOFF_LOG_PROMPTS = prev;
      } else {
        delete process.env.HANDOFF_LOG_PROMPTS;
      }
    }
  });

  test("includes truncated prompts when HANDOFF_LOG_PROMPTS=true", async () => {
    const prev = process.env.HANDOFF_LOG_PROMPTS;
    const jobId = `hnd_prompt_${Date.now()}`;
    try {
      process.env.HANDOFF_LOG_PROMPTS = "true";

      const longPrompt = "x".repeat(600);
      const date = new Date().toISOString().split("T")[0]; // capture before write to avoid midnight flake
      await logHandoffEvent({
        timestamp: new Date().toISOString(),
        event: "task_created",
        jobId,
        transport: "cli",
        prompt: longPrompt,
      });

      const logPath = join(handoffLogDir, `${date}.jsonl`);
      const entry = findLogEntry(logPath, jobId);
      expect(entry).toBeDefined();
      expect((entry!.prompt as string).length).toBe(500);
      expect((entry!.prompt as string).endsWith("...")).toBe(true);
    } finally {
      if (prev !== undefined) {
        process.env.HANDOFF_LOG_PROMPTS = prev;
      } else {
        delete process.env.HANDOFF_LOG_PROMPTS;
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Provenance chain tests
// These use an isolated temp directory via HANDOFF_LOG_DIR to avoid
// interference with the real daily log file.
// ---------------------------------------------------------------------------

describe("logHandoffEvent — Merkle chain (provenance)", () => {
  let tempDir: string;
  let prevHandoffLogDir: string | undefined;

  // Each test gets its own isolated directory so the per-path hash cache
  // and mutex start fresh (different logPath per test).
  function setupIsolatedDir(): string {
    // Use a unique sub-path so every test gets an untouched logPath.
    const dir = join(tmpdir(), `handoff-test-${randomUUID()}`);
    prevHandoffLogDir = process.env.HANDOFF_LOG_DIR;
    process.env.HANDOFF_LOG_DIR = dir;
    tempDir = dir;
    return dir;
  }

  afterEach(() => {
    // Restore env var
    if (prevHandoffLogDir !== undefined) {
      process.env.HANDOFF_LOG_DIR = prevHandoffLogDir;
    } else {
      delete process.env.HANDOFF_LOG_DIR;
    }
    // Clean up temp dir
    if (tempDir && existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test("single event has entryId (UUID) and no prevEntryHash", async () => {
    setupIsolatedDir();

    const fixedDate = new Date("2026-01-15T12:00:00.000Z");
    jest.setSystemTime(fixedDate);
    try {
      const jobId = `hnd_chain_single_${Date.now()}`;
      await logHandoffEvent({
        timestamp: new Date().toISOString(),
        event: "task_created",
        jobId,
        transport: "cli",
        agent: "claude",
      });

      const logPath = join(tempDir, "2026-01-15.jsonl");
      expect(existsSync(logPath)).toBe(true);

      const content = readFileSync(logPath, "utf-8");
      const lines = content.split("\n").filter((l) => l.trim().length > 0);
      expect(lines.length).toBe(1);

      const entry = JSON.parse(lines[0]) as Record<string, unknown>;
      // entryId should be a UUID (8-4-4-4-12 hex format)
      expect(typeof entry.entryId).toBe("string");
      expect((entry.entryId as string)).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
      );
      // First entry must not have prevEntryHash
      expect(entry.prevEntryHash).toBeUndefined();
    } finally {
      jest.useRealTimers();
    }
  });

  test("two sequential events form a valid Merkle chain", async () => {
    setupIsolatedDir();

    const fixedDate = new Date("2026-01-15T12:00:00.000Z");
    jest.setSystemTime(fixedDate);
    try {
      const jobId1 = `hnd_chain_first_${Date.now()}`;
      const jobId2 = `hnd_chain_second_${Date.now()}`;

      await logHandoffEvent({
        timestamp: new Date().toISOString(),
        event: "task_created",
        jobId: jobId1,
        transport: "cli",
        agent: "claude",
      });

      await logHandoffEvent({
        timestamp: new Date().toISOString(),
        event: "task_started",
        jobId: jobId2,
        transport: "cli",
        agent: "claude",
      });

      const logPath = join(tempDir, "2026-01-15.jsonl");
      expect(existsSync(logPath)).toBe(true);

      const content = readFileSync(logPath, "utf-8");
      const lines = content.split("\n").filter((l) => l.trim().length > 0);
      expect(lines.length).toBe(2);

      const first = JSON.parse(lines[0]) as Record<string, unknown>;
      const second = JSON.parse(lines[1]) as Record<string, unknown>;

      // First entry: no prevEntryHash
      expect(first.prevEntryHash).toBeUndefined();

      // Second entry: prevEntryHash must equal sha256 of first line (no trailing \n)
      const expectedHash = sha256Hex(lines[0]);
      expect(second.prevEntryHash).toBe(expectedHash);
    } finally {
      jest.useRealTimers();
    }
  });

  test("concurrent events all form a valid chain (mutex prevents shared prevEntryHash)", async () => {
    setupIsolatedDir();

    const fixedDate = new Date("2026-01-15T12:00:00.000Z");
    jest.setSystemTime(fixedDate);
    try {
      const count = 8;
      const events = Array.from({ length: count }, (_, i) => ({
        timestamp: new Date().toISOString(),
        event: "task_created" as const,
        jobId: `hnd_concurrent_${i}_${Date.now()}`,
        transport: "cli" as const,
        agent: "claude",
      }));

      // Fire all writes concurrently — the mutex must serialize them correctly.
      await Promise.all(events.map((e) => logHandoffEvent(e)));

      const logPath = join(tempDir, "2026-01-15.jsonl");
      expect(existsSync(logPath)).toBe(true);

      const content = readFileSync(logPath, "utf-8");
      const lines = content.split("\n").filter((l) => l.trim().length > 0);
      expect(lines.length).toBe(count);

      // Verify the full chain: each entry's prevEntryHash equals sha256 of the preceding line.
      for (let i = 1; i < lines.length; i++) {
        const entry = JSON.parse(lines[i]) as Record<string, unknown>;
        const expectedHash = sha256Hex(lines[i - 1]);
        expect(entry.prevEntryHash).toBe(expectedHash);
      }

      // Additionally: no two consecutive entries may share the same prevEntryHash
      // (that would indicate the mutex failed and two writes read the same predecessor).
      const prevHashes = lines.slice(1).map((l) => {
        const e = JSON.parse(l) as Record<string, unknown>;
        return e.prevEntryHash as string;
      });
      const uniquePrevHashes = new Set(prevHashes);
      expect(uniquePrevHashes.size).toBe(prevHashes.length);
    } finally {
      jest.useRealTimers();
    }
  });
});
