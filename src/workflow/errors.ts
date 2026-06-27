// Workflow orchestrator error types.
// Distinct classes let the CLI and callers branch on failure mode.

/** Raised when a workflow file cannot be loaded or has an invalid shape. */
export class WorkflowLoadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkflowLoadError";
  }
}

/** Raised when an agent invocation exhausts its retries. */
export class AgentFailedError extends Error {
  readonly attempts: number;
  readonly cause?: unknown;
  /**
   * Tokens consumed, when known. When thrown by the CLI executor for a single
   * attempt, this is that attempt's prompt + output cost (computed even on a
   * non-zero exit) — the runner charges it against the budget so failed attempts
   * are accounted, not free. When thrown by the runner after exhausting retries,
   * it is the cumulative cost across all attempts of the call.
   */
  readonly tokensUsed?: number;
  constructor(message: string, attempts: number, cause?: unknown, tokensUsed?: number) {
    super(message);
    this.name = "AgentFailedError";
    this.attempts = attempts;
    this.cause = cause;
    this.tokensUsed = tokensUsed;
  }
}

/** Raised when an agent's output does not satisfy its declared schema. */
export class SchemaValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SchemaValidationError";
  }
}

/** Raised when the token budget is exhausted before an agent call. */
export class BudgetExceededError extends Error {
  readonly used: number;
  readonly total: number;
  constructor(used: number, total: number) {
    super(`Token budget exhausted: used ${used} of ${total}`);
    this.name = "BudgetExceededError";
    this.used = used;
    this.total = total;
  }
}
