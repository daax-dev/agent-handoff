import { spawn, type ChildProcess } from "child_process";
import { getAdapter } from "./cli/registry.js";
import { spawnInTmux, isTmuxAvailable } from "./cli/tmux-spawner.js";
import { sendMessage, pollUntilDone, cancelTask as a2aCancelTask } from "./a2a/client.js";
import { getJob, updateJob } from "./job-store.js";
import { getHeadCommit, getFilesChanged, getDiffSummary } from "./utils/git.js";
import { logHandoffEvent } from "./utils/logger.js";
import { removeFromQueue } from "./pool/job-queue.js";
import { inspectOutput, redactSecretsFrom, toStoredFinding } from "./lib/inspect-output.js";
import { pushPromptTokens } from "./watchtower-client.js";
import type { Job, JobStatus, AgentName, A2AArtifactResult } from "./types.js";

// Track running CLI processes for cancellation
const runningProcesses = new Map<string, ChildProcess>();

export interface FinalizeCliJobInput {
  /** Process exit code (0 = success). */
  exitCode: number;
  /** Parsed adapter output: raw text plus optional structured payload. */
  parsed: { text: string; structured?: unknown };
  /** Raw stderr, also scanned for leaked secrets (a clean stdout must not hide a secret on stderr). */
  stderr?: string;
  /** Spawn mode; in "tmux" the captured pane echoes the prompt, which must not be inspected as output. */
  spawnMode?: "headless" | "tmux";
  /** Original prompt; stripped from tmux captures so echoed prompt text does not trip the gates. */
  prompt?: string;
  /** Additional fields to persist on the job alongside the computed status. */
  base?: Partial<Job>;
}

/** Remove all occurrences of `prompt` from `text` (tmux echoes the prompt into the pane). */
function stripPrompt(text: string, prompt: string): string {
  if (!prompt) return text;
  return text.split(prompt).join("");
}

/**
 * Finalize a CLI job after the agent exits, applying the inspectOutput gates
 * (Issue 1) before recording terminal status:
 *   - secrets found        → "secret-blocked" (redacted findings recorded)
 *   - exit 0 + self-claim  → "verification-required"
 *   - otherwise            → "completed" (exit 0) or "failed"
 *
 * Token usage / cost are persisted on every terminal status when present.
 * Separated from {@link runCliJob} so the gating logic is unit-testable without
 * spawning a real agent process.
 */
export function finalizeCliJob(jobId: string, input: FinalizeCliJobInput): Job | undefined {
  const { exitCode, parsed, stderr, spawnMode, prompt, base = {} } = input;
  const completedAt = new Date().toISOString();

  const isTmux = spawnMode === "tmux" && !!prompt;

  // Phrase gate input: in tmux the captured pane echoes the prompt, so strip the
  // known prompt — otherwise a prompt that happens to contain a completion phrase
  // ("Done!") would falsely mark the job verification-required.
  const agentText = isTmux ? stripPrompt(parsed.text, prompt) : parsed.text;

  // Secret gate input (aux): the secret scan must still see the FULL persisted
  // output — the complete tmux pane (incl. the echoed prompt) plus stderr — so a
  // credential anywhere that ends up stored is detected and redacted, even one
  // that only appears in the stripped prompt. stderr never feeds the phrase gate.
  const secretAux = isTmux
    ? [parsed.text, stderr].filter(Boolean).join("\n")
    : stderr;
  const inspection = inspectOutput(agentText, parsed.structured, secretAux);

  // Token usage is persisted regardless of which terminal status is recorded.
  const tokenFields = {
    inputTokens: inspection.tokens?.input ?? null,
    outputTokens: inspection.tokens?.output ?? null,
    estimatedCostUsd: inspection.tokens?.costUsd ?? null,
  };

  if (inspection.secretsFound) {
    // Scrub the detected secret from any output we persist, and store only
    // redacted findings — the raw credential is never written to the job record
    // or surfaced through get_result.
    return updateJob(jobId, {
      ...base,
      ...tokenFields,
      stdout: redactSecretsFrom(base.stdout, inspection.findings),
      stderr: redactSecretsFrom(base.stderr, inspection.findings),
      status: "secret-blocked",
      findings: inspection.findings.map(toStoredFinding),
      completedAt,
    });
  }

  if (exitCode === 0 && inspection.claimsCompletion) {
    return updateJob(jobId, {
      ...base,
      ...tokenFields,
      status: "verification-required",
      completedAt,
    });
  }

  return updateJob(jobId, {
    ...base,
    ...tokenFields,
    status: exitCode === 0 ? "completed" : "failed",
    completedAt,
  });
}

export interface FinalizeA2AJobInput {
  /** Agent response text (joined A2A messages). */
  text: string;
  /** Returned artifacts; their text is also scanned and redacted on a secret hit. */
  artifacts: A2AArtifactResult[];
  /** Whether the remote task reported success. */
  succeeded: boolean;
  /** Additional fields to persist on the job alongside the computed status. */
  base?: Partial<Job>;
}

/**
 * Finalize an A2A job, applying the same inspectOutput gates as
 * {@link finalizeCliJob} so a delegated agent that returns a secret in a message
 * or artifact is caught (secret-blocked) and the raw value is redacted from both
 * stdout and artifacts before persisting. A2A carries no token usage payload.
 */
export function finalizeA2AJob(jobId: string, input: FinalizeA2AJobInput): Job | undefined {
  const { text, artifacts, succeeded, base = {} } = input;
  const completedAt = new Date().toISOString();
  // Scan every persisted field that get_result returns — artifact name,
  // description, and text, plus any error message — so a secret in any of them
  // trips the gate.
  const scanFields = [
    ...artifacts.flatMap((a) => [a.name, a.description, a.text]),
    base.error,
  ].filter((s): s is string => typeof s === "string" && s.length > 0);
  const inspection = inspectOutput(text, null, scanFields.join("\n"));
  // error is persisted on every terminal status, so always pass it through
  // redaction (a no-op when no secret was found).
  const redactedError = redactSecretsFrom(base.error, inspection.findings);

  if (inspection.secretsFound) {
    return updateJob(jobId, {
      ...base,
      stdout: redactSecretsFrom(text, inspection.findings),
      artifacts: artifacts.map((a) => ({
        name: redactSecretsFrom(a.name, inspection.findings),
        description: redactSecretsFrom(a.description, inspection.findings),
        text: redactSecretsFrom(a.text, inspection.findings),
      })),
      error: redactedError,
      status: "secret-blocked",
      findings: inspection.findings.map(toStoredFinding),
      completedAt,
    });
  }

  if (succeeded && inspection.claimsCompletion) {
    return updateJob(jobId, {
      ...base,
      stdout: text,
      artifacts,
      error: redactedError,
      status: "verification-required",
      completedAt,
    });
  }

  return updateJob(jobId, {
    ...base,
    stdout: text,
    artifacts,
    error: redactedError,
    status: succeeded ? "completed" : "failed",
    completedAt,
  });
}

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

    // Parse structured output from agent adapter
    const parsed = adapter.parseOutput(result.stdout);

    // Inspect output before recording terminal status: secret gate, phrase
    // gate, and token extraction (Issue 1).
    const finalized = finalizeCliJob(job.id, {
      exitCode: result.exitCode,
      parsed,
      stderr: result.stderr,
      spawnMode: job.spawnMode,
      prompt: job.prompt,
      base: {
        pid: result.pid,
        exitCode: result.exitCode,
        stdout: parsed.text,
        stderr: result.stderr,
        filesChanged,
        diffSummary,
      },
    });
    const status: JobStatus =
      finalized?.status ?? (result.exitCode === 0 ? "completed" : "failed");

    // Push token usage to watchtower (best-effort, fire-and-forget).
    // Tokens come from finalized (set by finalizeCliJob via inspectOutput),
    // not from job (which predates the finalize call).
    if (finalized && finalized.inputTokens != null && finalized.outputTokens != null) {
      void pushPromptTokens({
        sessionId: job.id,
        sequence: 1,
        inputTokens: finalized.inputTokens,
        outputTokens: finalized.outputTokens,
      });
    }

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

    const succeeded = finalTask.status === "completed";

    // Inspect A2A output with the same gates as the CLI path (Issue 1).
    const finalized = finalizeA2AJob(job.id, {
      text: agentMessages,
      artifacts,
      succeeded,
      base: { error: finalTask.error?.message },
    });
    const status: JobStatus = finalized?.status ?? (succeeded ? "completed" : "failed");

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
