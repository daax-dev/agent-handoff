import type { AgentName } from "../types.js";

// ---------------------------------------------------------------------------
// Schema types — the typed contract between workflow phases (the handoff payload)
// ---------------------------------------------------------------------------

/** Primitive field types supported by the field-map schema shorthand. */
export type FieldType = "string" | "number" | "boolean";

/**
 * Field-map schema shorthand, e.g. `{ issueId: "string", userCount: "number" }`.
 * Append `[]` for arrays of a primitive, e.g. `{ tags: "string[]" }`.
 */
export type FieldMap = Record<string, FieldType | `${FieldType}[]`>;

/** Minimal structural type for a Zod-style schema (duck-typed via safeParse). */
export interface ZodLikeSchema {
  safeParse(data: unknown): { success: boolean; data?: unknown; error?: unknown };
}

/** A schema is either the field-map shorthand or a Zod-style schema. */
export type WorkflowSchema = FieldMap | ZodLikeSchema;

// ---------------------------------------------------------------------------
// Agent invocation
// ---------------------------------------------------------------------------

/** A single agent invocation requested from inside a workflow. */
export interface AgentSpec {
  /** Prompt handed to the sub-agent. */
  prompt: string;
  /** Optional typed-output contract. When present, the result is validated. */
  schema?: WorkflowSchema;
  /** Which CLI agent to spawn. Falls back to the workflow's default agent. */
  agent?: AgentName;
  /** Optional per-agent model override. */
  model?: string;
  /** When true with a schema, expect an array of schema-shaped items. */
  array?: boolean;
  /** Per-agent timeout override (ms). */
  timeoutMs?: number;
}

/** Resolved spec after defaults are applied — what the executor receives. */
export interface ResolvedAgentSpec extends AgentSpec {
  agent: AgentName;
}

/** Raw result returned by an {@link AgentExecutor}. */
export interface RawAgentResult {
  /** Plain-text output of the agent. */
  text: string;
  /** Structured JSON output, if the adapter parsed any. */
  structured?: unknown;
  /** Tokens consumed by this call (prompt + output), for budget accounting. */
  tokensUsed: number;
}

/**
 * The dependency-injected seam. The real implementation
 * ({@link createCliExecutor}) delegates to the CLI adapter layer; tests pass a
 * stub. The executor performs the spawn only — retry, budget, and schema
 * validation are handled by the runner so both paths share that logic.
 */
export type AgentExecutor = (spec: ResolvedAgentSpec) => Promise<RawAgentResult>;

// ---------------------------------------------------------------------------
// Workflow context & definition
// ---------------------------------------------------------------------------

/** A pipeline stage: transforms the previous result for one item. */
export type PipelineStage<T = unknown> = (
  previous: unknown,
  item: T,
  index: number,
) => Promise<unknown> | unknown;

/** A task usable in {@link WorkflowContext.parallel} — a thunk or a bare promise. */
export type ParallelTask<T> = (() => Promise<T> | T) | Promise<T>;

/** A single phase-log entry surfaced to observers. */
export interface PhaseLogEntry {
  timestamp: string;
  message: string;
  data?: Record<string, unknown>;
}

/**
 * Read-only view of the token budget, queryable mid-loop.
 *
 * Enforced at admission: `agent()` throws `BudgetExceededError` once
 * `used >= total`, so a sequential `while (budget.remaining > N)` loop is exact.
 * Under `parallel()`/`pipeline()` the in-flight set may overshoot `total` —
 * per-call cost is only known after a call completes — but the budget still
 * hard-stops the next admission. This mirrors the upstream Claude Code
 * Workflows budget model (a shared, admission-checked counter).
 */
export interface BudgetView {
  /** Total budget in tokens (`Infinity` when unbounded). */
  readonly total: number;
  /** Tokens consumed so far. */
  readonly used: number;
  /** Tokens remaining (`total - used`). */
  readonly remaining: number;
}

/** The object handed to every workflow function. */
export interface WorkflowContext {
  /** Spawn one sub-agent; returns the validated typed result (or text). */
  agent(spec: AgentSpec): Promise<unknown>;
  /** Run tasks concurrently and wait for all (a barrier). */
  parallel<T>(tasks: Array<ParallelTask<T>>): Promise<T[]>;
  /** Stream each item through the stages; items run concurrently. */
  pipeline<T>(items: T[], stages: Array<PipelineStage<T>>): Promise<unknown[]>;
  /** Emit a live progress message. */
  phaseLog(message: string, data?: Record<string, unknown>): void;
  /** Token budget guard, queryable mid-loop. */
  budget: BudgetView;
  /** Runtime arguments passed at invocation. */
  args: Record<string, unknown>;
}

/** A workflow file's default export. */
export type WorkflowDefinition = (ctx: WorkflowContext) => Promise<unknown> | unknown;

// ---------------------------------------------------------------------------
// Run records & result
// ---------------------------------------------------------------------------

/** Record of one agent() call, for observability. */
export interface AgentCallRecord {
  agent: AgentName;
  promptPreview: string;
  attempts: number;
  tokensUsed: number;
  ok: boolean;
  error?: string;
}

/** Result of running a workflow to completion. */
export interface WorkflowRunResult {
  /** The value returned by the workflow function. */
  result: unknown;
  /** All phase-log entries, in order. */
  phaseLog: PhaseLogEntry[];
  /** All agent invocations, in completion order. */
  agentCalls: AgentCallRecord[];
  /** Total tokens consumed across all agent calls. */
  tokensUsed: number;
}
