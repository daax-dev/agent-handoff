import { $ } from "bun";
import { randomUUID } from "crypto";
import { tmpdir } from "os";
import { join } from "path";
import type { AgentName, SpawnResult, SpawnOptions } from "../types.js";
import type { BaseAdapter } from "./base-adapter.js";

export async function isTmuxAvailable(): Promise<boolean> {
  try {
    const result = await $`tmux list-sessions`.quiet().nothrow();
    return result.exitCode === 0;
  } catch {
    return false;
  }
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
  const paneResult = await $`tmux new-window -n ${windowName} -P -F "#{pane_id}" -d`.cwd(cwd).text();
  const paneId = paneResult.trim();

  if (!paneId) {
    throw new Error("Failed to create tmux window");
  }

  // Send the command to the pane, capturing exit code when done
  // For codex which needs stdin, pipe the prompt
  if (adapter.name === "codex") {
    await $`tmux send-keys -t ${paneId} ${`echo ${shellEscape(prompt)} | ${fullCommand}; echo $? > ${shellEscape(exitCodeFile)}`} Enter`.quiet();
  } else {
    await $`tmux send-keys -t ${paneId} ${`${fullCommand}; echo $? > ${shellEscape(exitCodeFile)}`} Enter`.quiet();
  }

  // Poll until the exit code file appears (command finished)
  const startTime = Date.now();
  const timeoutMs = options?.timeoutMs ?? 300_000;

  while (true) {
    await new Promise((resolve) => setTimeout(resolve, 1000));

    const { existsSync } = await import("fs");
    if (existsSync(exitCodeFile)) {
      break;
    }

    if (Date.now() - startTime > timeoutMs) {
      // Kill the pane on timeout
      await $`tmux kill-pane -t ${paneId}`.quiet().nothrow();
      throw new Error("timed_out");
    }
  }

  // Read exit code using Bun.file for safe file access
  const exitCodeStr = (await Bun.file(exitCodeFile).text()).trim();
  const exitCode = parseInt(exitCodeStr, 10) || 1;

  // Capture pane output
  const stdout = await $`tmux capture-pane -t ${paneId} -p -S -`.text();

  // Clean up exit code file
  const { unlinkSync } = await import("fs");
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
