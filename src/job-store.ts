import type { Job, JobSnapshot, JobStatus, TransportMode, AgentName } from "./types.js";

const jobs = new Map<string, Job>();

function generateId(): string {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let id = "hnd_";
  for (let i = 0; i < 12; i++) {
    id += chars[Math.floor(Math.random() * chars.length)];
  }
  return id;
}

export function createJob(params: {
  transport: TransportMode;
  agent?: AgentName;
  agentUrl?: string;
  prompt: string;
  workingDirectory?: string;
  model?: string;
  spawnMode?: "headless" | "tmux";
  requiredCapabilities?: string[];
  timeoutMs?: number;
  authHeaders?: Record<string, string>;
  /** Serialized HandoffContext (base64) for multi-session task continuation (#18) */
  contextPayload?: string;
  /** SPIFFE ID of the sending agent; stored for future SVID-based verification */
  senderSpiffeId?: string;
}): Job {
  const job: Job = {
    id: generateId(),
    status: "queued",
    transport: params.transport,
    agent: params.agent,
    agentUrl: params.agentUrl,
    prompt: params.prompt,
    workingDirectory: params.workingDirectory,
    model: params.model,
    spawnMode: params.spawnMode,
    requiredCapabilities: params.requiredCapabilities,
    timeoutMs: params.timeoutMs ?? 300_000,
    createdAt: new Date().toISOString(),
    authHeaders: params.authHeaders,
    contextPayload: params.contextPayload,
    senderSpiffeId: params.senderSpiffeId,
  };
  jobs.set(job.id, job);
  return job;
}

export function getJob(jobId: string): Job | undefined {
  return jobs.get(jobId);
}

export function updateJob(jobId: string, updates: Partial<Job>): Job | undefined {
  const job = jobs.get(jobId);
  if (!job) return undefined;
  Object.assign(job, updates);
  return job;
}

export function listJobs(): Job[] {
  return Array.from(jobs.values());
}

export function deleteJob(jobId: string): boolean {
  return jobs.delete(jobId);
}

/**
 * Capture the job's current state as a snapshot stored on the job itself.
 * Call immediately after createJob (before any updateJob mutations) so that
 * rollbackJob can restore the pre-handshake state.
 */
export function snapshotJob(jobId: string): JobSnapshot | undefined {
  const job = jobs.get(jobId);
  if (!job) return undefined;
  const snap: JobSnapshot = {
    status: job.status,
    handshakeStatus: job.handshakeStatus,
    handshakeRejectionReason: job.handshakeRejectionReason,
    error: job.error,
  };
  job.snapshot = snap;
  return snap;
}

/**
 * Restore a job to its previously snapshotted state.
 * Clears retryExhausted so the caller can re-attempt the handshake.
 */
export function rollbackJob(jobId: string): Job | undefined {
  const job = jobs.get(jobId);
  if (!job?.snapshot) return undefined;
  const { status, handshakeStatus, handshakeRejectionReason, error } = job.snapshot;
  Object.assign(job, {
    status,
    handshakeStatus,
    handshakeRejectionReason,
    error,
    retryExhausted: undefined,
  });
  return job;
}

/**
 * Test-only helper to reset in-memory state between test cases.
 */
export function clearJobs(): void {
  jobs.clear();
}
