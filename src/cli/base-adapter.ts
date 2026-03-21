import { spawn } from "child_process";
import type { AgentName, SpawnOptions, SpawnResult } from "../types.js";

export abstract class BaseAdapter {
  abstract readonly name: AgentName;
  abstract readonly command: string;

  abstract buildArgs(prompt: string, options?: SpawnOptions): string[];
  abstract parseOutput(stdout: string): { text: string; structured?: unknown };

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

  get processRef(): ReturnType<typeof spawn> | null {
    return null;
  }
}
