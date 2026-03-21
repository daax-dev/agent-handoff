import { BaseAdapter } from "./base-adapter.js";
import type { AgentName, SpawnOptions } from "../types.js";

export class ClaudeAdapter extends BaseAdapter {
  readonly name: AgentName = "claude";
  readonly command = "claude";

  buildArgs(prompt: string, options?: SpawnOptions): string[] {
    const args = ["-p", prompt, "--output-format", "json"];
    if (options?.model) args.push("--model", options.model);
    return args;
  }

  parseOutput(stdout: string): { text: string; structured?: unknown } {
    try {
      const parsed = JSON.parse(stdout);
      return { text: parsed.result ?? stdout, structured: parsed };
    } catch {
      return { text: stdout };
    }
  }
}
