import { describe, test, expect, beforeEach } from "bun:test";
import { finalizeCliJob, finalizeA2AJob } from "./job-runner.js";
import { createJob, getJob, clearJobs } from "./job-store.js";

function newCliJob() {
  return createJob({ transport: "cli", agent: "claude", prompt: "do work" });
}

function newA2AJob() {
  return createJob({ transport: "a2a", agentUrl: "https://agent.example/a2a", prompt: "do work" });
}

describe("finalizeCliJob — output inspection integration", () => {
  beforeEach(() => {
    clearJobs();
  });

  test("secret in output → status secret-blocked with findings", () => {
    const job = newCliJob();
    finalizeCliJob(job.id, {
      exitCode: 0,
      parsed: { text: "here is the key AKIAIOSFODNN7EXAMPLE leaked" },
    });
    const stored = getJob(job.id)!;
    expect(stored.status).toBe("secret-blocked");
    expect(stored.findings && stored.findings.length).toBeGreaterThan(0);
  });

  test("secret on stderr (clean stdout) → status secret-blocked", () => {
    const job = newCliJob();
    finalizeCliJob(job.id, {
      exitCode: 0,
      parsed: { text: "all good, build passed" },
      stderr: "debug: AKIAIOSFODNN7EXAMPLE",
    });
    const stored = getJob(job.id)!;
    expect(stored.status).toBe("secret-blocked");
    expect(stored.findings && stored.findings.length).toBeGreaterThan(0);
  });

  test("secret-blocked job redacts the secret from stored stdout/stderr", () => {
    const job = newCliJob();
    finalizeCliJob(job.id, {
      exitCode: 0,
      parsed: { text: "leak AKIAIOSFODNN7EXAMPLE here" },
      stderr: "also AKIAIOSFODNN7EXAMPLE",
      base: { stdout: "leak AKIAIOSFODNN7EXAMPLE here", stderr: "also AKIAIOSFODNN7EXAMPLE" },
    });
    const stored = getJob(job.id)!;
    expect(stored.status).toBe("secret-blocked");
    expect(stored.stdout ?? "").not.toContain("AKIAIOSFODNN7EXAMPLE");
    expect(stored.stderr ?? "").not.toContain("AKIAIOSFODNN7EXAMPLE");
  });

  test("stored findings are redacted and never contain the raw secret", () => {
    const job = newCliJob();
    finalizeCliJob(job.id, {
      exitCode: 0,
      parsed: { text: "leak AKIAIOSFODNN7EXAMPLE here" },
      base: { stdout: "leak AKIAIOSFODNN7EXAMPLE here" },
    });
    const stored = getJob(job.id)!;
    expect(JSON.stringify(stored.findings)).not.toContain("AKIAIOSFODNN7EXAMPLE");
    expect(stored.findings![0]!.matchRedacted).toContain("AKIA");
  });

  test("completion phrase on stderr does NOT trigger verification-required", () => {
    const job = newCliJob();
    finalizeCliJob(job.id, {
      exitCode: 0,
      parsed: { text: "build output, all green" },
      stderr: "tool log: Done!",
      base: { stdout: "build output, all green", stderr: "tool log: Done!" },
    });
    expect(getJob(job.id)!.status).toBe("completed");
  });

  test("self-reported completion on exit 0 → verification-required", () => {
    const job = newCliJob();
    finalizeCliJob(job.id, {
      exitCode: 0,
      parsed: { text: "I've completed the task" },
    });
    expect(getJob(job.id)!.status).toBe("verification-required");
  });

  test("clean output on exit 0 → completed (regression)", () => {
    const job = newCliJob();
    finalizeCliJob(job.id, {
      exitCode: 0,
      parsed: { text: "The build passed all checks" },
    });
    expect(getJob(job.id)!.status).toBe("completed");
  });

  test("tmux: echoed prompt containing a forbidden phrase does not trip the gate", () => {
    const job = newCliJob();
    finalizeCliJob(job.id, {
      exitCode: 0,
      // Captured tmux pane echoes the prompt; agent's own output is clean.
      parsed: { text: "$ echo 'I've completed the task' | agent\nresult: build is green" },
      spawnMode: "tmux",
      prompt: "I've completed the task",
    });
    expect(getJob(job.id)!.status).toBe("completed");
  });

  test("tmux: a secret in the echoed prompt is still detected and redacted from stdout", () => {
    const job = newCliJob();
    const secret = "AKIAIOSFODNN7EXAMPLE";
    const pane = `$ echo '${secret}' | agent\nagent: build is green`;
    finalizeCliJob(job.id, {
      exitCode: 0,
      parsed: { text: pane },
      spawnMode: "tmux",
      prompt: secret,
      base: { stdout: pane },
    });
    const stored = getJob(job.id)!;
    expect(stored.status).toBe("secret-blocked");
    expect(stored.stdout ?? "").not.toContain(secret);
  });

  test("token usage is persisted on verification-required (gated) status", () => {
    const job = newCliJob();
    finalizeCliJob(job.id, {
      exitCode: 0,
      parsed: { text: "I've completed the task", structured: { usage: { input_tokens: 10, output_tokens: 5 } } },
    });
    const stored = getJob(job.id)!;
    expect(stored.status).toBe("verification-required");
    expect(stored.inputTokens).toBe(10);
    expect(stored.outputTokens).toBe(5);
  });

  test("phrase gate does not fire on non-zero exit → failed", () => {
    const job = newCliJob();
    finalizeCliJob(job.id, {
      exitCode: 1,
      parsed: { text: "I've completed the task" },
    });
    expect(getJob(job.id)!.status).toBe("failed");
  });
});

describe("finalizeA2AJob — output inspection integration", () => {
  beforeEach(() => {
    clearJobs();
  });

  test("secret in an A2A message → secret-blocked, stdout redacted", () => {
    const job = newA2AJob();
    finalizeA2AJob(job.id, {
      text: "result: AKIAIOSFODNN7EXAMPLE",
      artifacts: [],
      succeeded: true,
    });
    const stored = getJob(job.id)!;
    expect(stored.status).toBe("secret-blocked");
    expect(stored.stdout ?? "").not.toContain("AKIAIOSFODNN7EXAMPLE");
    expect(stored.findings && stored.findings.length).toBeGreaterThan(0);
  });

  test("secret in an A2A artifact → secret-blocked, artifact text redacted", () => {
    const job = newA2AJob();
    finalizeA2AJob(job.id, {
      text: "clean message",
      artifacts: [{ name: "out.txt", text: "key AKIAIOSFODNN7EXAMPLE" }],
      succeeded: true,
    });
    const stored = getJob(job.id)!;
    expect(stored.status).toBe("secret-blocked");
    expect(stored.artifacts![0]!.text ?? "").not.toContain("AKIAIOSFODNN7EXAMPLE");
  });

  test("secret in A2A artifact name/description → secret-blocked, metadata redacted", () => {
    const job = newA2AJob();
    finalizeA2AJob(job.id, {
      text: "clean message",
      artifacts: [{ name: "AKIAIOSFODNN7EXAMPLE.txt", description: "leak AKIAIOSFODNN7EXAMPLE", text: "ok" }],
      succeeded: true,
    });
    const stored = getJob(job.id)!;
    expect(stored.status).toBe("secret-blocked");
    expect(stored.artifacts![0]!.name ?? "").not.toContain("AKIAIOSFODNN7EXAMPLE");
    expect(stored.artifacts![0]!.description ?? "").not.toContain("AKIAIOSFODNN7EXAMPLE");
  });

  test("secret in A2A error message → secret-blocked, error redacted", () => {
    const job = newA2AJob();
    finalizeA2AJob(job.id, {
      text: "clean message",
      artifacts: [],
      succeeded: false,
      base: { error: "remote failed: AKIAIOSFODNN7EXAMPLE" },
    });
    const stored = getJob(job.id)!;
    expect(stored.status).toBe("secret-blocked");
    expect(stored.error ?? "").not.toContain("AKIAIOSFODNN7EXAMPLE");
  });

  test("clean A2A success → completed", () => {
    const job = newA2AJob();
    finalizeA2AJob(job.id, { text: "all good", artifacts: [], succeeded: true });
    expect(getJob(job.id)!.status).toBe("completed");
  });

  test("self-reported completion in A2A message → verification-required", () => {
    const job = newA2AJob();
    finalizeA2AJob(job.id, { text: "I've completed the task", artifacts: [], succeeded: true });
    expect(getJob(job.id)!.status).toBe("verification-required");
  });
});
