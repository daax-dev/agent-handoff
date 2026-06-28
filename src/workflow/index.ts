// Code-as-orchestrator workflow subsystem (issue #62).
// A JS-file orchestrator for deterministic agent handoff: agent results pass
// directly between phases in plain code, never re-entering a model context.

export { runWorkflow, type RunWorkflowOptions } from "./runner.js";
export { createCliExecutor, type CliExecutorOptions } from "./executor.js";
export { loadWorkflow, resolveWorkflowPath, listWorkflows, WORKFLOWS_DIR } from "./loader.js";
export { fieldMapToZod, resolveSchema, validateAgentOutput } from "./schema.js";
export {
  AgentFailedError,
  BudgetExceededError,
  SchemaValidationError,
  WorkflowLoadError,
} from "./errors.js";
export type {
  AgentCallRecord,
  AgentExecutor,
  AgentSpec,
  BudgetView,
  FieldMap,
  FieldType,
  ParallelTask,
  PhaseLogEntry,
  PipelineStage,
  RawAgentResult,
  ResolvedAgentSpec,
  WorkflowContext,
  WorkflowDefinition,
  WorkflowRunResult,
  WorkflowSchema,
  ZodLikeSchema,
} from "./types.js";
