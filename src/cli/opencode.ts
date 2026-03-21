import { BaseAdapter } from "./base-adapter.js";
import type { AgentName, SpawnOptions } from "../types.js";

export class OpenCodeAdapter extends BaseAdapter {
  readonly name: AgentName = "opencode";
  readonly command = "opencode";

  buildArgs(prompt: string, options?: SpawnOptions): string[] {
    const args = ["-p", prompt, "-f", "json"];
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
