import { BaseAdapter } from "./base-adapter.js";
import type { AgentName, SpawnOptions } from "../types.js";

export class AiderAdapter extends BaseAdapter {
  readonly name: AgentName = "aider";
  readonly command = "aider";

  buildArgs(prompt: string, options?: SpawnOptions): string[] {
    const args = ["--message", prompt, "--yes-always", "--no-git"];
    if (options?.model) args.push("--model", options.model);
    return args;
  }

  parseOutput(stdout: string): { text: string; structured?: unknown } {
    return { text: stdout };
  }
}
