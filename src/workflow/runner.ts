import type { AgentName } from "../types.js";
import { estimateTokens } from "../context/token-estimator.js";
import { AgentFailedError, BudgetExceededError } from "./errors.js";
import { validateAgentOutput } from "./schema.js";
import type {
  AgentCallRecord,
  AgentExecutor,
  AgentSpec,
  BudgetView,
  ParallelTask,
  PhaseLogEntry,
  PipelineStage,
  ResolvedAgentSpec,
  WorkflowContext,
  WorkflowDefinition,
  WorkflowRunResult,
} from "./types.js";

const DEFAULT_MAX_RETRIES = 3;

export interface RunWorkflowOptions {
  /** The agent-spawning seam. Required. */
  executor: AgentExecutor;
  /** Runtime arguments exposed to the workflow as `ctx.args`. */
  args?: Record<string, unknown>;
  /** Default agent used when a spec omits `agent`. */
  defaultAgent?: AgentName;
  /** Total token budget. Defaults to unbounded (Infinity). */
  budget?: number;
  /** Retry attempts per agent call before surfacing failure. Defaults to 3. */
  maxRetries?: number;
  /** Observer invoked for each phaseLog() call. */
  onPhaseLog?: (entry: PhaseLogEntry) => void;
}

/** Live, mutable budget tracker with a read-only {@link BudgetView} facade. */
class Budget implements BudgetView {
  readonly total: number;
  private _used = 0;
  constructor(total: number) {
    this.total = total;
  }
  get used(): number {
    return this._used;
  }
  get remaining(): number {
    return this.total - this._used;
  }
  charge(tokens: number): void {
    if (!Number.isFinite(tokens) || tokens < 0) {
      throw new RangeError(`tokensUsed must be a finite non-negative number, got ${String(tokens)}`);
    }
    this._used += tokens;
  }
  assertAvailable(): void {
    if (this._used >= this.total) {
      throw new BudgetExceededError(this._used, this.total);
    }
  }
}

function normalizeTask<T>(task: ParallelTask<T>): Promise<T> {
  if (typeof task === "function") {
    return Promise.resolve((task as () => Promise<T> | T)());
  }
  return Promise.resolve(task);
}

/**
 * Run a workflow definition to completion. Orchestration is plain code: agent
 * results pass directly between phases and never re-enter a model context.
 */
export async function runWorkflow(
  definition: WorkflowDefinition,
  options: RunWorkflowOptions,
): Promise<WorkflowRunResult> {
  const { executor } = options;
  if (typeof executor !== "function") {
    throw new TypeError("runWorkflow requires an executor function");
  }
  const maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
  if (!Number.isInteger(maxRetries) || maxRetries < 1) {
    throw new RangeError(`maxRetries must be a positive integer, got ${String(options.maxRetries)}`);
  }
  if (options.budget !== undefined) {
    const b = options.budget;
    // Reject NaN / non-finite-but-negative / zero: a non-positive or NaN total
    // silently disables enforcement (used >= total stays falsey, remaining is
    // NaN), so fail fast. Infinity is allowed (the unbounded default).
    if (typeof b !== "number" || Number.isNaN(b) || b <= 0) {
      throw new RangeError(`budget must be a positive number, got ${String(options.budget)}`);
    }
  }
  const budget = new Budget(options.budget ?? Infinity);
  const phaseLogEntries: PhaseLogEntry[] = [];
  const agentCalls: AgentCallRecord[] = [];

  async function agent(spec: AgentSpec): Promise<unknown> {
    if (!spec || typeof spec.prompt !== "string" || spec.prompt.trim().length === 0) {
      throw new TypeError("agent() requires a spec with a non-empty prompt string");
    }
    const agentName = spec.agent ?? options.defaultAgent;
    if (!agentName) {
      throw new TypeError("agent() requires an agent (set spec.agent or RunWorkflowOptions.defaultAgent)");
    }
    const resolved: ResolvedAgentSpec = { ...spec, agent: agentName };

    let attempts = 0;
    let tokensUsed = 0;
    let lastError: unknown;

    while (attempts < maxRetries) {
      budget.assertAvailable(); // admission check; throws BudgetExceededError
      attempts += 1;

      let raw;
      try {
        raw = await executor(resolved);
      } catch (err) {
        lastError = err;
        // A failed attempt still consumed tokens (the agent may have run and
        // produced output before exiting non-zero). Charge the executor-reported
        // cost when known, else a prompt estimate floor — so retries respect the
        // budget and accounting reflects every attempt.
        const reported = (err as { tokensUsed?: number } | undefined)?.tokensUsed;
        const failTokens =
          typeof reported === "number" && Number.isFinite(reported) && reported >= 0
            ? reported
            : estimateTokens(resolved.prompt);
        budget.charge(failTokens);
        tokensUsed += failTokens;
      }

      // Executor succeeded: tokens are spent whether or not validation passes.
      budget.charge(raw.tokensUsed);
      tokensUsed += raw.tokensUsed;

      try {
        const value = spec.schema
          ? validateAgentOutput(raw, spec.schema, spec.array ?? false)
          : raw.text;
        agentCalls.push({
          agent: agentName,
          promptPreview: spec.prompt.slice(0, 80),
          attempts,
          tokensUsed,
          ok: true,
        });
        return value;
      } catch (err) {
        lastError = err; // validation failed — tokens already spent, retry
      }
    }

    const message = lastError instanceof Error ? lastError.message : String(lastError);
    agentCalls.push({
      agent: agentName,
      promptPreview: spec.prompt.slice(0, 80),
      attempts,
      tokensUsed,
      ok: false,
      error: message,
    });
    throw new AgentFailedError(
      `Agent "${agentName}" failed after ${attempts} attempt(s): ${message}`,
      attempts,
      lastError,
      tokensUsed, // cumulative across all attempts
    );
  }

  async function parallel<T>(tasks: Array<ParallelTask<T>>): Promise<T[]> {
    if (!Array.isArray(tasks)) {
      throw new TypeError("parallel() requires an array of tasks");
    }
    return Promise.all(tasks.map((t) => normalizeTask(t)));
  }

  async function pipeline<T>(items: T[], stages: Array<PipelineStage<T>>): Promise<unknown[]> {
    if (!Array.isArray(items)) {
      throw new TypeError("pipeline() requires an array of items");
    }
    if (!Array.isArray(stages) || stages.length === 0) {
      throw new TypeError("pipeline() requires a non-empty array of stages");
    }
    // Each item flows through all stages independently and concurrently: item B
    // can be in stage 1 while item A is in stage 2 (streaming, not barriered).
    return Promise.all(
      items.map(async (item, index) => {
        let acc: unknown = item;
        for (const stage of stages) {
          acc = await stage(acc, item, index);
        }
        return acc;
      }),
    );
  }

  function phaseLog(message: string, data?: Record<string, unknown>): void {
    const entry: PhaseLogEntry = { timestamp: new Date().toISOString(), message, data };
    phaseLogEntries.push(entry);
    options.onPhaseLog?.(entry);
  }

  const ctx: WorkflowContext = {
    agent,
    parallel,
    pipeline,
    phaseLog,
    budget,
    args: options.args ?? {},
  };

  const result = await definition(ctx);
  return { result, phaseLog: phaseLogEntries, agentCalls, tokensUsed: budget.used };
}
