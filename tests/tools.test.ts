import { describe, test, expect, beforeEach } from "./test-compat.js";
import { handleCheckStatus } from "../src/tools/check-status.js";
import { handleGetResult } from "../src/tools/get-result.js";
import { handleListAgents } from "../src/tools/list-agents.js";
import { handleCancelTask } from "../src/tools/cancel-task.js";
import { createJob, updateJob, clearJobs } from "../src/job-store.js";
import { clearQueue } from "../src/pool/job-queue.js";
import { clearWorkers } from "../src/pool/worker-registry.js";
import { clearRegisteredAgents } from "../src/a2a/agent-card.js";

describe("Tool Handlers", () => {
  beforeEach(() => {
    clearJobs();
    clearQueue();
    clearWorkers();
    clearRegisteredAgents();
  });

  describe("check_status", () => {
    test("returns status for existing job", async () => {
      const job = createJob({ transport: "cli", agent: "claude", prompt: "test" });
      const result = await handleCheckStatus({ jobId: job.id });
      const data = JSON.parse(result.content[0].text);
      expect(data.jobId).toBe(job.id);
      expect(data.status).toBe("queued");
      expect(data.transport).toBe("cli");
    });

    test("throws for missing job", async () => {
      await expect(handleCheckStatus({ jobId: "hnd_missing12345" })).rejects.toThrow("Job not found");
    });
  });

  describe("get_result", () => {
    test("returns in-progress message for queued job", async () => {
      const job = createJob({ transport: "cli", agent: "claude", prompt: "test" });
      const result = await handleGetResult({ jobId: job.id });
      const data = JSON.parse(result.content[0].text);
      expect(data.status).toBe("queued");
      expect(data.message).toContain("still in progress");
    });

    test("returns full result for completed CLI job", async () => {
      const job = createJob({ transport: "cli", agent: "claude", prompt: "test" });
      updateJob(job.id, {
        status: "completed",
        exitCode: 0,
        stdout: "done",
        stderr: "",
        filesChanged: ["src/auth.ts"],
        diffSummary: "1 file changed",
      });
      const result = await handleGetResult({ jobId: job.id });
      const data = JSON.parse(result.content[0].text);
      expect(data.status).toBe("completed");
      expect(data.exitCode).toBe(0);
      expect(data.stdout).toBe("done");
      expect(data.filesChanged).toEqual(["src/auth.ts"]);
    });

    test("returns artifacts for completed A2A job", async () => {
      const job = createJob({ transport: "a2a", agentUrl: "https://example.com", prompt: "research" });
      updateJob(job.id, {
        status: "completed",
        stdout: "research results",
        artifacts: [{ name: "report", text: "findings..." }],
      });
      const result = await handleGetResult({ jobId: job.id });
      const data = JSON.parse(result.content[0].text);
      expect(data.artifacts).toHaveLength(1);
      expect(data.artifacts[0].name).toBe("report");
    });

    test("throws for missing job", async () => {
      await expect(handleGetResult({ jobId: "hnd_nope12345ab" })).rejects.toThrow("Job not found");
    });
  });

  describe("list_agents", () => {
    test("returns cli and a2a arrays", async () => {
      const result = await handleListAgents();
      const data = JSON.parse(result.content[0].text);
      expect(Array.isArray(data.cli)).toBe(true);
      expect(Array.isArray(data.a2a)).toBe(true);
      expect(data.cli.length).toBe(6);
      // Each CLI agent has name, available, command
      for (const agent of data.cli) {
        expect(agent).toHaveProperty("name");
        expect(agent).toHaveProperty("available");
        expect(agent).toHaveProperty("command");
      }
    });
  });

  describe("cancel_task", () => {
    test("throws for missing job", async () => {
      await expect(handleCancelTask({ jobId: "hnd_gone12345ab" })).rejects.toThrow("Job not found");
    });

    test("cannot cancel completed job", async () => {
      const job = createJob({ transport: "cli", agent: "claude", prompt: "done" });
      updateJob(job.id, { status: "completed" });
      const result = await handleCancelTask({ jobId: job.id });
      const data = JSON.parse(result.content[0].text);
      expect(data.success).toBe(false);
      expect(data.message).toContain("Cannot cancel");
    });

    test("cancels queued job", async () => {
      const job = createJob({ transport: "cli", agent: "claude", prompt: "cancel me" });
      const result = await handleCancelTask({ jobId: job.id });
      const data = JSON.parse(result.content[0].text);
      expect(data.success).toBe(true);
      expect(data.status).toBe("cancelled");
    });
  });
});
