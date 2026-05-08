import { describe, test, expect } from "./test-compat.js";
import { logHandoff, truncatePrompt, logHandoffEvent } from "../src/utils/logger.js";
import { existsSync, readFileSync } from "fs";
import { join } from "path";

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
    await logHandoffEvent({
      timestamp: new Date().toISOString(),
      event: "task_created",
      jobId,
      transport: "cli",
      agent: "claude",
    });

    const date = new Date().toISOString().split("T")[0];
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

      await logHandoffEvent({
        timestamp: new Date().toISOString(),
        event: "task_created",
        jobId,
        transport: "cli",
        prompt: "this is a secret prompt with API_KEY=abc123",
      });

      const date = new Date().toISOString().split("T")[0];
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
      await logHandoffEvent({
        timestamp: new Date().toISOString(),
        event: "task_created",
        jobId,
        transport: "cli",
        prompt: longPrompt,
      });

      const date = new Date().toISOString().split("T")[0];
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
