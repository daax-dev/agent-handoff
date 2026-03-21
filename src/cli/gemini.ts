import { BaseAdapter } from "./base-adapter.js";
import type { AgentName, SpawnOptions } from "../types.js";

export class GeminiAdapter extends BaseAdapter {
  readonly name: AgentName = "gemini";
  readonly command = "gemini";

  buildArgs(prompt: string, options?: SpawnOptions): string[] {
    const args = ["-p", prompt, "--output-format", "json"];
    if (options?.model) args.push("--model", options.model);
    return args;
  }

  parseOutput(stdout: string): { text: string; structured?: unknown } {
    try {
      const parsed = JSON.parse(stdout);
      return { text: parsed.response ?? stdout, structured: parsed };
    } catch {
      return { text: stdout };
    }
  }
}
