export type AgentName = "claude" | "codex" | "gemini" | "copilot" | "opencode";

export type JobStatus = "queued" | "running" | "completed" | "failed" | "cancelled" | "timed_out";

export type TransportMode = "cli" | "a2a" | "pool";

export interface Job {
  id: string;
  status: JobStatus;
  transport: TransportMode;
  agent?: AgentName;
  agentUrl?: string;
  prompt: string;
  workingDirectory?: string;
  model?: string;
  spawnMode?: "headless" | "tmux";
  requiredCapabilities?: string[];
  timeoutMs: number;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  /** Auth headers for A2A requests (resolved from registered agent) */
  authHeaders?: Record<string, string>;
  // CLI-specific
  pid?: number;
  exitCode?: number;
  stdout?: string;
  stderr?: string;
  gitHeadBefore?: string;
  filesChanged?: string[];
  diffSummary?: string;
  // A2A-specific
  a2aTaskId?: string;
  artifacts?: A2AArtifactResult[];
  // Error
  error?: string;
  // Context serialization (#18)
  contextPayload?: string;
  // Handshake (#19)
  handshakeStatus?: "pending" | "accepted" | "rejected";
  handshakeRejectionReason?: string;
  /** SPIFFE ID of the sending agent; stored for future SVID-based verification */
  senderSpiffeId?: string;
  // Retry / rollback (#6)
  retryCount?: number;
  maxRetries?: number;
  retryExhausted?: boolean;
  snapshot?: JobSnapshot;
}

/** Immutable snapshot of a Job's pre-handshake state, used to roll back on retry exhaustion. */
export interface JobSnapshot {
  status: JobStatus;
  handshakeStatus?: "pending" | "accepted" | "rejected";
  handshakeRejectionReason?: string;
  error?: string;
}

export interface A2AArtifactResult {
  name?: string;
  description?: string;
  text?: string;
}

export interface HandoffTaskInput {
  agent?: AgentName;
  agentUrl?: string;
  prompt: string;
  workingDirectory?: string;
  model?: string;
  spawnMode?: "headless" | "tmux";
  timeoutMs?: number;
  pool?: boolean;
  requiredCapabilities?: string[];
  /** Serialized HandoffContext (base64) for multi-session task continuation (#18) */
  contextPayload?: string;
  /** SPIFFE ID of the sender; stored on the job for future SVID-based verification (not yet enforced) */
  senderSpiffeId?: string;
  /** DoD criteria for two-phase handshake (#19) */
  dodCriteria?: Array<{ id: string; description: string; required?: boolean }>;
}

export interface CheckStatusInput {
  jobId: string;
}

export interface GetResultInput {
  jobId: string;
}

export interface RegisterAgentInput {
  url: string;
  authToken?: string;
  authHeaders?: Record<string, string>;
}

export interface CancelTaskInput {
  jobId: string;
}

export interface CliAgentInfo {
  name: AgentName;
  available: boolean;
  command: string;
}

export interface A2AAgentInfo {
  name: string;
  url: string;
  description?: string;
  skills?: string[];
}

export interface ListAgentsOutput {
  cli: CliAgentInfo[];
  a2a: A2AAgentInfo[];
  tmuxAvailable: boolean;
}

export interface SpawnOptions {
  workingDirectory?: string;
  model?: string;
  spawnMode?: "headless" | "tmux";
  timeoutMs?: number;
}

export interface SpawnResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  pid: number;
}

export interface LogEntry {
  timestamp: string;
  jobId: string;
  transport: TransportMode;
  agent?: string;
  agentUrl?: string;
  status: JobStatus;
  exitCode?: number;
  durationMs: number;
  filesChanged?: string[];
  artifacts?: number;
}

// Worker Pool types
export type WorkerStatus = "idle" | "busy" | "offline";

export interface Worker {
  id: string;
  name: string;
  capabilities: string[];
  status: WorkerStatus;
  registeredAt: string;
  lastHeartbeatAt: string;
  currentJobId?: string;
}

export interface RegisterWorkerInput {
  name: string;
  capabilities?: string[];
}

export interface PullTaskInput {
  workerId: string;
}

export interface SubmitResultInput {
  workerId: string;
  jobId: string;
  status: "completed" | "failed";
  output?: string;
  error?: string;
}

export interface WorkerHeartbeatInput {
  workerId: string;
}

// ---------------------------------------------------------------------------
// ChangeSet domain types (MVP-1, PRD-001)
// Re-exported from domain modules; kept here as the canonical shared surface.
// ---------------------------------------------------------------------------

export type {
  ChangeSetStatus,
  ChangeSet,
  CreateChangeSetInput,
} from "./domain/change-set.js";

export type {
  TaskStatus,
  Task,
  CreateTaskInput,
} from "./domain/task.js";

export { VALID_TRANSITIONS } from "./domain/change-set.js";

// ---------------------------------------------------------------------------
// Event types
// ---------------------------------------------------------------------------

export type HandoffEventType =
  | "task_created"
  | "task_started"
  | "task_completed"
  | "task_failed"
  | "task_cancelled"
  | "task_timed_out"
  | "pool_enqueued"
  | "pool_assigned"
  | "pool_submitted"
  | "worker_registered"
  | "worker_first_heartbeat"
  | "agent_registered"
  // Auth / SVID events (#17)
  | "svid_verified"
  | "svid_rejected"
  // Handshake events (#19)
  | "handshake_proposed"
  | "handshake_accepted"
  | "handshake_rejected"
  | "handshake_ack_timeout"
  // Retry events (#6)
  | "handshake_retry";

export interface HandoffEvent {
  timestamp: string;
  event: HandoffEventType;
  jobId?: string;
  transport?: "cli" | "a2a" | "pool";

  // Who
  agent?: string;
  agentUrl?: string;
  workerId?: string;
  workerName?: string;
  model?: string;

  // What
  prompt?: string;           // Redacted by default; truncated to 500 chars when HANDOFF_LOG_PROMPTS=true
  status?: JobStatus;

  // Results
  exitCode?: number;
  durationMs?: number;
  filesChanged?: string[];
  artifactCount?: number;
  error?: string;

  // Context
  workingDirectory?: string;
  spawnMode?: "headless" | "tmux";
}
