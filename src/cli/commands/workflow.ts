import type { AgentName } from "../../types.js";
import {
  createCliExecutor,
  listWorkflows,
  loadWorkflow,
  resolveWorkflowPath,
  runWorkflow,
} from "../../workflow/index.js";

const VALID_AGENTS: AgentName[] = ["claude", "codex", "gemini", "copilot", "opencode"];

export interface WorkflowRunOptions {
  arg?: string[];
  budget?: string;
  agent?: string;
  maxRetries?: string;
  dryRun?: boolean;
  json?: boolean;
}

/** Parse repeated `--arg key=value` flags into an args object (values JSON-coerced). */
export function parseArgs(pairs: string[] | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const pair of pairs ?? []) {
    const eq = pair.indexOf("=");
    if (eq === -1) {
      throw new Error(`Invalid --arg "${pair}" (expected key=value)`);
    }
    const key = pair.slice(0, eq).trim();
    const rawValue = pair.slice(eq + 1);
    if (!key) {
      throw new Error(`Invalid --arg "${pair}" (empty key)`);
    }
    try {
      out[key] = JSON.parse(rawValue);
    } catch {
      out[key] = rawValue; // fall back to a bare string
    }
  }
  return out;
}

/**
 * Parse a CLI flag that must be a positive integer (e.g. --budget, --max-retries).
 * Strict decimal only — rejects `1e6`, `0x10`, `1.5`, etc. that `Number()` would
 * silently accept.
 */
export function parsePositiveInt(value: string | undefined, label: string): number | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) {
    throw new Error(`${label} must be a positive integer, got "${value}"`);
  }
  const n = Number(trimmed);
  if (!Number.isSafeInteger(n) || n <= 0) {
    throw new Error(`${label} must be a positive integer, got "${value}"`);
  }
  return n;
}

export function workflowListCmd(): void {
  const names = listWorkflows();
  if (names.length === 0) {
    console.log("No workflows found in .claude/workflows/");
    return;
  }
  console.log("Available workflows:");
  for (const name of names) {
    console.log(`  ${name}`);
  }
}

export async function workflowRunCmd(ref: string, opts: WorkflowRunOptions): Promise<void> {
  const filePath = resolveWorkflowPath(ref);
  const definition = await loadWorkflow(filePath);

  const args = parseArgs(opts.arg);
  const budget = parsePositiveInt(opts.budget, "--budget");
  const maxRetries = parsePositiveInt(opts.maxRetries, "--max-retries");

  let defaultAgent: AgentName | undefined;
  if (opts.agent) {
    if (!VALID_AGENTS.includes(opts.agent as AgentName)) {
      throw new Error(`Unknown agent "${opts.agent}" (expected one of: ${VALID_AGENTS.join(", ")})`);
    }
    defaultAgent = opts.agent as AgentName;
  }

  if (opts.dryRun) {
    console.log(`Workflow loaded OK: ${filePath}`);
    console.log(`  args: ${JSON.stringify(args)}`);
    console.log(`  defaultAgent: ${defaultAgent ?? "(none)"}`);
    console.log(`  budget: ${budget ?? "unbounded"}`);
    console.log(`  maxRetries: ${maxRetries ?? 3}`);
    return;
  }

  const executor = createCliExecutor();
  const run = await runWorkflow(definition, {
    executor,
    args,
    defaultAgent,
    budget,
    maxRetries,
    onPhaseLog: opts.json ? undefined : (e) => console.error(`[phase] ${e.message}`),
  });

  if (opts.json) {
    console.log(JSON.stringify(run, null, 2));
    return;
  }

  console.log(`\nWorkflow complete — ${run.agentCalls.length} agent call(s), ${run.tokensUsed} tokens`);
  console.log("Result:");
  console.log(typeof run.result === "string" ? run.result : JSON.stringify(run.result, null, 2));
}
