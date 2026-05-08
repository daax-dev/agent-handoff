import type { Job, JobStatus, TransportMode, AgentName } from "./types.js";

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
 * Test-only helper to reset in-memory state between test cases.
 */
export function clearJobs(): void {
  jobs.clear();
}
