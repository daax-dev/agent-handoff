import { spawn, type ChildProcess } from "child_process";
import { getAdapter } from "./cli/registry.js";
import { spawnInTmux, isTmuxAvailable } from "./cli/tmux-spawner.js";
import { sendMessage, pollUntilDone, cancelTask as a2aCancelTask } from "./a2a/client.js";
import { getJob, updateJob } from "./job-store.js";
import { getHeadCommit, getFilesChanged, getDiffSummary } from "./utils/git.js";
import { logHandoffEvent } from "./utils/logger.js";
import { removeFromQueue } from "./pool/job-queue.js";
import type { Job, AgentName, A2AArtifactResult } from "./types.js";

// Track running CLI processes for cancellation
const runningProcesses = new Map<string, ChildProcess>();

export async function runCliJob(job: Job): Promise<void> {
  const adapter = getAdapter(job.agent!);
  const cwd = job.workingDirectory ?? process.cwd();

  // Git snapshot before
  const headBefore = await getHeadCommit(cwd);
  updateJob(job.id, { status: "running", startedAt: new Date().toISOString(), gitHeadBefore: headBefore ?? undefined });

  logHandoffEvent({
    timestamp: new Date().toISOString(),
    event: "task_started",
    jobId: job.id,
    transport: "cli",
    agent: job.agent,
    model: job.model,
    workingDirectory: cwd,
    spawnMode: job.spawnMode,
  });

  const startTime = Date.now();

  try {
    // If tmux mode requested, verify it's available
    if (job.spawnMode === "tmux") {
      const tmuxReady = await isTmuxAvailable();
      if (!tmuxReady) {
        throw new Error("tmux spawn mode requested but tmux is not available or no session exists");
      }
    }

    // Spawn with timeout
    const args = adapter.buildArgs(job.prompt, { workingDirectory: cwd, model: job.model });

    let result: { stdout: string; stderr: string; exitCode: number; pid: number };

    if (job.spawnMode === "tmux") {
      // Tmux spawn path
      const tmuxResult = await spawnInTmux(adapter, job.prompt, {
        workingDirectory: cwd,
        model: job.model,
        timeoutMs: job.timeoutMs,
      });
      result = { stdout: tmuxResult.stdout, stderr: tmuxResult.stderr, exitCode: tmuxResult.exitCode, pid: tmuxResult.pid };
    } else {
      // Headless spawn path
      result = await new Promise<{ stdout: string; stderr: string; exitCode: number; pid: number }>((resolve, reject) => {
        const proc = spawn(adapter.command, args, {
          cwd,
          stdio: ["pipe", "pipe", "pipe"],
          env: { ...process.env },
        });

        runningProcesses.set(job.id, proc);

        let stdout = "";
        let stderr = "";

        proc.stdout?.on("data", (data: Buffer) => { stdout += data.toString(); });
        proc.stderr?.on("data", (data: Buffer) => { stderr += data.toString(); });

        // For codex, send prompt via stdin
        if (job.agent === "codex") {
          proc.stdin?.write(job.prompt);
          proc.stdin?.end();
        }

        const timer = setTimeout(() => {
          proc.kill("SIGTERM");
          reject(new Error("timed_out"));
        }, job.timeoutMs);

        proc.on("error", (err) => {
          clearTimeout(timer);
          runningProcesses.delete(job.id);
          reject(err);
        });

        proc.on("close", (code) => {
          clearTimeout(timer);
          runningProcesses.delete(job.id);
          resolve({ stdout, stderr, exitCode: code ?? 1, pid: proc.pid ?? 0 });
        });
      });
    }

    // Post-completion: git diff
    let filesChanged: string[] = [];
    let diffSummary = "";
    if (headBefore) {
      filesChanged = await getFilesChanged(headBefore, cwd);
      diffSummary = await getDiffSummary(headBefore, cwd);
    }

    const durationMs = Date.now() - startTime;
    const status = result.exitCode === 0 ? "completed" : "failed";

    // Parse structured output from agent adapter
    const parsed = adapter.parseOutput(result.stdout);

    updateJob(job.id, {
      status,
      completedAt: new Date().toISOString(),
      pid: result.pid,
      exitCode: result.exitCode,
      stdout: parsed.text,
      stderr: result.stderr,
      filesChanged,
      diffSummary,
    });

    logHandoffEvent({
      timestamp: new Date().toISOString(),
      event: status === "completed" ? "task_completed" : "task_failed",
      jobId: job.id,
      transport: "cli",
      agent: job.agent,
      status,
      exitCode: result.exitCode,
      durationMs,
      filesChanged,
      workingDirectory: cwd,
    });
  } catch (err) {
    const durationMs = Date.now() - startTime;
    const isTimeout = err instanceof Error && err.message === "timed_out";
    const status = isTimeout ? "timed_out" : "failed";

    updateJob(job.id, {
      status,
      completedAt: new Date().toISOString(),
      error: err instanceof Error ? err.message : String(err),
    });

    logHandoffEvent({
      timestamp: new Date().toISOString(),
      event: isTimeout ? "task_timed_out" : "task_failed",
      jobId: job.id,
      transport: "cli",
      agent: job.agent,
      status,
      durationMs,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

export async function runA2AJob(job: Job): Promise<void> {
  updateJob(job.id, { status: "running", startedAt: new Date().toISOString() });

  logHandoffEvent({
    timestamp: new Date().toISOString(),
    event: "task_started",
    jobId: job.id,
    transport: "a2a",
    agentUrl: job.agentUrl,
    model: job.model,
    prompt: job.prompt,
  });

  const startTime = Date.now();
  const a2aOptions = job.authHeaders ? { authHeaders: job.authHeaders } : undefined;

  try {
    // Send initial message
    const task = await sendMessage(job.agentUrl!, job.prompt, a2aOptions);
    updateJob(job.id, { a2aTaskId: task.id });

    // Poll until done
    const finalTask = await pollUntilDone(job.agentUrl!, task.id, 2000, job.timeoutMs, a2aOptions);

    const durationMs = Date.now() - startTime;

    // Extract artifacts
    const artifacts: A2AArtifactResult[] = (finalTask.artifacts ?? []).map((a: { name?: string; description?: string; parts?: Array<{ type: string; text?: string }> }) => ({
      name: a.name,
      description: a.description,
      text: a.parts?.filter((p) => p.type === "text").map((p) => (p as { type: "text"; text: string }).text).join("\n"),
    }));

    // Extract agent response text from messages
    const agentMessages = (finalTask.messages ?? [])
      .filter((m: { role: string }) => m.role === "agent")
      .flatMap((m: { parts: Array<{ type: string; text?: string }> }) => m.parts)
      .filter((p: { type: string }) => p.type === "text")
      .map((p: { type: string; text?: string }) => (p as { type: "text"; text: string }).text)
      .join("\n");

    const status = finalTask.status === "completed" ? "completed" : "failed";

    updateJob(job.id, {
      status,
      completedAt: new Date().toISOString(),
      stdout: agentMessages,
      artifacts,
      error: finalTask.error?.message,
    });

    logHandoffEvent({
      timestamp: new Date().toISOString(),
      event: status === "completed" ? "task_completed" : "task_failed",
      jobId: job.id,
      transport: "a2a",
      agentUrl: job.agentUrl,
      status,
      durationMs,
      artifactCount: artifacts.length,
    });
  } catch (err) {
    const durationMs = Date.now() - startTime;
    const isTimeout = (err instanceof Error && err.message.includes("timed out")) ||
      (err instanceof DOMException && err.name === "AbortError");

    updateJob(job.id, {
      status: isTimeout ? "timed_out" : "failed",
      completedAt: new Date().toISOString(),
      error: err instanceof Error ? err.message : String(err),
    });

    logHandoffEvent({
      timestamp: new Date().toISOString(),
      event: isTimeout ? "task_timed_out" : "task_failed",
      jobId: job.id,
      transport: "a2a",
      agentUrl: job.agentUrl,
      status: isTimeout ? "timed_out" : "failed",
      durationMs,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

export async function cancelJob(jobId: string): Promise<boolean> {
  const job = getJob(jobId);
  if (!job) return false;
  if (job.status !== "running" && job.status !== "queued") return false;

  // Remove from pool queue if queued
  if (job.status === "queued") {
    removeFromQueue(jobId);
  }

  if (job.transport === "cli") {
    const proc = runningProcesses.get(jobId);
    if (proc) {
      proc.kill("SIGTERM");
      runningProcesses.delete(jobId);
    }
  } else if (job.transport === "a2a" && job.a2aTaskId) {
    try {
      const cancelOptions = job.authHeaders ? { authHeaders: job.authHeaders } : undefined;
      await a2aCancelTask(job.agentUrl!, job.a2aTaskId, cancelOptions);
    } catch {
      // Best effort
    }
  }

  updateJob(jobId, { status: "cancelled", completedAt: new Date().toISOString() });
  return true;
}
