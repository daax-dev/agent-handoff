import { randomUUID } from "crypto";
import { tmpdir } from "os";
import { join } from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import { existsSync, readFileSync, unlinkSync } from "fs";
import type { AgentName, SpawnResult, SpawnOptions } from "../types.js";
import type { BaseAdapter } from "./base-adapter.js";

const execFileAsync = promisify(execFile);

async function tmux(args: string[], cwd?: string): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  try {
    const { stdout, stderr } = await execFileAsync("tmux", args, {
      cwd: cwd ?? process.cwd(),
      encoding: "utf-8",
    });
    return { stdout, stderr, exitCode: 0 };
  } catch (error) {
    const err = error as NodeJS.ErrnoException & { stdout?: string; stderr?: string; code?: number | string };
    return {
      stdout: err.stdout ?? "",
      stderr: err.stderr ?? "",
      exitCode: typeof err.code === "number" ? err.code : 1,
    };
  }
}

export async function isTmuxAvailable(): Promise<boolean> {
  const result = await tmux(["list-sessions"]);
  return result.exitCode === 0;
}

export async function spawnInTmux(
  adapter: BaseAdapter,
  prompt: string,
  options?: SpawnOptions,
): Promise<SpawnResult & { paneId: string }> {
  const cwd = options?.workingDirectory ?? process.cwd();
  const windowName = `daax-${adapter.name}`;
  const args = adapter.buildArgs(prompt, options);
  const fullCommand = [adapter.command, ...args].map(shellEscape).join(" ");

  // Use cryptographically random filename in OS temp directory
  const exitCodeFile = join(tmpdir(), `daax-exit-${randomUUID()}.tmp`);

  // Create new tmux window and get pane ID
  const paneResult = await tmux(["new-window", "-n", windowName, "-P", "-F", "#{pane_id}", "-d"], cwd);
  const paneId = paneResult.stdout.trim();

  if (!paneId) {
    throw new Error("Failed to create tmux window");
  }

  // Send the command to the pane, capturing exit code when done
  // For codex which needs stdin, pipe the prompt
  if (adapter.name === "codex") {
    await tmux(["send-keys", "-t", paneId, `echo ${shellEscape(prompt)} | ${fullCommand}; echo $? > ${shellEscape(exitCodeFile)}`, "Enter"], cwd);
  } else {
    await tmux(["send-keys", "-t", paneId, `${fullCommand}; echo $? > ${shellEscape(exitCodeFile)}`, "Enter"], cwd);
  }

  // Poll until the exit code file appears (command finished)
  const startTime = Date.now();
  const timeoutMs = options?.timeoutMs ?? 300_000;

  while (true) {
    await new Promise((resolve) => setTimeout(resolve, 1000));

    if (existsSync(exitCodeFile)) {
      break;
    }

    if (Date.now() - startTime > timeoutMs) {
      // Kill the pane on timeout
      await tmux(["kill-pane", "-t", paneId], cwd);
      throw new Error("timed_out");
    }
  }

  const exitCodeStr = readFileSync(exitCodeFile, "utf-8").trim();
  const exitCode = parseInt(exitCodeStr, 10) || 1;

  // Capture pane output
  const captureResult = await tmux(["capture-pane", "-t", paneId, "-p", "-S", "-"], cwd);
  const stdout = captureResult.stdout;

  // Clean up exit code file
  try { unlinkSync(exitCodeFile); } catch {}

  return {
    stdout: stdout.trim(),
    stderr: "",
    exitCode,
    pid: 0, // tmux doesn't expose PID directly
    paneId,
  };
}

function shellEscape(s: string): string {
  return "'" + s.replace(/'/g, "'\\''") + "'";
}
