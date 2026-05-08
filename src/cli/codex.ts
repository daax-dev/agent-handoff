import { spawn } from "child_process";
import { BaseAdapter } from "./base-adapter.js";
import type { AgentName, SpawnOptions, SpawnResult } from "../types.js";

export class CodexAdapter extends BaseAdapter {
  readonly name: AgentName = "codex";
  readonly command = "codex";

  buildArgs(_prompt: string, options?: SpawnOptions): string[] {
    const args = ["exec", "--json"];
    if (options?.model) args.push("-c", `model="${options.model}"`);
    return args;
  }

  // Override run to send prompt via stdin
  async run(prompt: string, options?: SpawnOptions): Promise<SpawnResult> {
    const args = this.buildArgs(prompt, options);
    const cwd = options?.workingDirectory ?? process.cwd();

    return new Promise<SpawnResult>((resolve, reject) => {
      const proc = spawn(this.command, args, {
        cwd,
        stdio: ["pipe", "pipe", "pipe"],
        env: { ...process.env },
      });

      let stdout = "";
      let stderr = "";

      proc.stdout?.on("data", (data: Buffer) => {
        stdout += data.toString();
      });

      proc.stderr?.on("data", (data: Buffer) => {
        stderr += data.toString();
      });

      // Send prompt via stdin
      proc.stdin?.write(prompt);
      proc.stdin?.end();

      proc.on("error", (err) => {
        reject(new Error(`Failed to spawn ${this.command}: ${err.message}`));
      });

      proc.on("close", (code) => {
        resolve({
          stdout,
          stderr,
          exitCode: code ?? 1,
          pid: proc.pid ?? 0,
        });
      });
    });
  }

  parseOutput(stdout: string): { text: string; structured?: unknown } {
    try {
      // JSONL format - parse last complete line
      const lines = stdout.trim().split("\n").filter(Boolean);
      const lastLine = lines[lines.length - 1];
      const parsed = JSON.parse(lastLine);
      return { text: parsed.message ?? stdout, structured: parsed };
    } catch {
      return { text: stdout };
    }
  }
}
