import { describe, test, expect } from "bun:test";
import { createJob, getJob, updateJob, listJobs, deleteJob } from "../src/job-store.js";

describe("job-store", () => {
  test("createJob returns job with hnd_ prefix and queued status", () => {
    const job = createJob({
      transport: "cli",
      agent: "claude",
      prompt: "test prompt",
    });
    expect(job.id).toMatch(/^hnd_[a-z0-9]{12}$/);
    expect(job.status).toBe("queued");
    expect(job.transport).toBe("cli");
    expect(job.agent).toBe("claude");
    expect(job.prompt).toBe("test prompt");
    expect(job.timeoutMs).toBe(300_000);
    expect(job.createdAt).toBeTruthy();
  });

  test("createJob with custom timeout", () => {
    const job = createJob({
      transport: "a2a",
      agentUrl: "https://example.com",
      prompt: "test",
      timeoutMs: 60_000,
    });
    expect(job.timeoutMs).toBe(60_000);
    expect(job.transport).toBe("a2a");
    expect(job.agentUrl).toBe("https://example.com");
  });

  test("getJob returns correct job", () => {
    const created = createJob({ transport: "cli", agent: "claude", prompt: "find me" });
    const found = getJob(created.id);
    expect(found).toBeDefined();
    expect(found!.id).toBe(created.id);
    expect(found!.prompt).toBe("find me");
  });

  test("getJob returns undefined for missing job", () => {
    expect(getJob("hnd_doesnotexist")).toBeUndefined();
  });

  test("updateJob merges updates", () => {
    const job = createJob({ transport: "cli", agent: "claude", prompt: "update me" });
    const updated = updateJob(job.id, { status: "running", startedAt: "2026-01-01T00:00:00Z" });
    expect(updated).toBeDefined();
    expect(updated!.status).toBe("running");
    expect(updated!.startedAt).toBe("2026-01-01T00:00:00Z");
    expect(updated!.prompt).toBe("update me"); // unchanged fields preserved
  });

  test("updateJob returns undefined for missing job", () => {
    expect(updateJob("hnd_missing", { status: "completed" })).toBeUndefined();
  });

  test("listJobs returns all jobs", () => {
    const before = listJobs().length;
    createJob({ transport: "cli", agent: "codex", prompt: "job1" });
    createJob({ transport: "cli", agent: "gemini", prompt: "job2" });
    expect(listJobs().length).toBe(before + 2);
  });

  test("deleteJob removes job", () => {
    const job = createJob({ transport: "cli", agent: "claude", prompt: "delete me" });
    expect(deleteJob(job.id)).toBe(true);
    expect(getJob(job.id)).toBeUndefined();
  });

  test("deleteJob returns false for missing job", () => {
    expect(deleteJob("hnd_nope")).toBe(false);
  });
});
