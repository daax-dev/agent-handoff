import { BaseAdapter } from "./base-adapter.js";
import type { AgentName, SpawnOptions } from "../types.js";

export class CopilotAdapter extends BaseAdapter {
  readonly name: AgentName = "copilot";
  readonly command = "copilot";

  buildArgs(prompt: string, options?: SpawnOptions): string[] {
    const args = ["-p", prompt];
    if (options?.model) args.push("--model", options.model);
    return args;
  }

  parseOutput(stdout: string): { text: string; structured?: unknown } {
    // Copilot is text-only, no JSON output
    return { text: stdout };
  }
}
