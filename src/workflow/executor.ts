import { getAdapter as defaultGetAdapter } from "../cli/registry.js";
import { estimateTokens } from "../context/token-estimator.js";
import type { BaseAdapter } from "../cli/base-adapter.js";
import type { AgentName } from "../types.js";
import { AgentFailedError } from "./errors.js";
import type { AgentExecutor, RawAgentResult, ResolvedAgentSpec } from "./types.js";

export interface CliExecutorOptions {
  /** Working directory for spawned agents. Defaults to process.cwd(). */
  workingDirectory?: string;
  /** Default per-agent timeout (ms) when a spec omits one. */
  timeoutMs?: number;
  /** Override the adapter lookup — the seam used by tests to stub spawns. */
  getAdapter?: (name: AgentName) => BaseAdapter;
}

/**
 * The real executor: maps a resolved spec to a CLI adapter spawn, parses the
 * output, and accounts tokens. It delegates to the existing adapter layer
 * rather than shelling out directly (architecture anti-pattern).
 */
export function createCliExecutor(opts: CliExecutorOptions = {}): AgentExecutor {
  const resolveAdapter = opts.getAdapter ?? defaultGetAdapter;
  const cwd = opts.workingDirectory ?? process.cwd();

  return async (spec: ResolvedAgentSpec): Promise<RawAgentResult> => {
    const adapter = resolveAdapter(spec.agent);
    const result = await adapter.run(spec.prompt, {
      workingDirectory: cwd,
      model: spec.model,
      timeoutMs: spec.timeoutMs ?? opts.timeoutMs,
    });

    if (result.exitCode !== 0) {
      const stderr = result.stderr.trim();
      throw new AgentFailedError(
        `Agent "${spec.agent}" exited with code ${result.exitCode}${stderr ? `: ${stderr}` : ""}`,
        1,
      );
    }

    const parsed = adapter.parseOutput(result.stdout);
    return {
      text: parsed.text,
      structured: parsed.structured,
      tokensUsed: estimateTokens(spec.prompt) + estimateTokens(result.stdout),
    };
  };
}
