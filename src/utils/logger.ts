import { appendFileSync, mkdirSync, existsSync } from "fs";
import { appendFile, mkdir, readFile } from "fs/promises";
import { join } from "path";
import { createHash, randomUUID } from "node:crypto";
import type { LogEntry, HandoffEvent } from "../types.js";

function getLogPath(): string {
  const date = new Date().toISOString().split("T")[0];
  const dir = join(process.cwd(), ".logs", "tools");
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  return join(dir, `handoff-${date}.jsonl`);
}

// Cache created directories to avoid repeated fs checks
const createdDirs = new Set<string>();
const pendingDirs = new Map<string, Promise<void>>();

async function ensureHandoffLogDir(dir: string): Promise<void> {
  if (createdDirs.has(dir)) return;

  let pending = pendingDirs.get(dir);
  if (pending) return pending;

  pending = (async () => {
    try {
      await mkdir(dir, { recursive: true });
      createdDirs.add(dir);
    } catch (err) {
      process.stderr.write(`Failed to create handoff log directory "${dir}": ${err}\n`);
    } finally {
      pendingDirs.delete(dir);
    }
  })();

  pendingDirs.set(dir, pending);
  return pending;
}

function getHandoffLogDir(): string {
  return join(process.cwd(), ".logs", "handoffs");
}

/** @deprecated Use logHandoffEvent() instead */
export function logHandoff(entry: LogEntry): void {
  try {
    const line = JSON.stringify(entry) + "\n";
    appendFileSync(getLogPath(), line);
  } catch (err) {
    process.stderr.write(`Failed to write log: ${err}\n`);
  }
}

export function truncatePrompt(prompt: string, maxLen = 500): string {
  if (prompt.length <= maxLen) {
    return prompt;
  }
  const ellipsis = "...";
  if (maxLen <= ellipsis.length) {
    return prompt.slice(0, maxLen);
  }
  return prompt.slice(0, maxLen - ellipsis.length) + ellipsis;
}

/** Whether prompt content is included in handoff event logs. Set HANDOFF_LOG_PROMPTS=true to enable. */
function shouldLogPrompts(): boolean {
  return process.env.HANDOFF_LOG_PROMPTS === "true";
}

/**
 * Read the last non-empty line of a file.
 * Returns null if the file doesn't exist or is empty.
 */
async function readLastLine(filePath: string): Promise<string | null> {
  try {
    const content = await readFile(filePath, "utf-8");
    const lines = content.split("\n").filter((l) => l.trim().length > 0);
    return lines.length > 0 ? lines[lines.length - 1] : null;
  } catch {
    return null;
  }
}

/**
 * Compute SHA-256 hex digest of a UTF-8 string.
 */
function sha256Hex(content: string): string {
  return createHash("sha256").update(content, "utf-8").digest("hex");
}

/**
 * Log a handoff event to the JSONL log file.
 * Implements a per-file Merkle chain: each entry includes the SHA-256 hash
 * of the previous entry in the same daily log file.
 *
 * Safe for fire-and-forget usage — never rejects. Errors are written to stderr.
 */
export async function logHandoffEvent(event: HandoffEvent): Promise<void> {
  try {
    const entry: HandoffEvent = { ...event };
    // Strip prompt unless opt-in via env var (prompts may contain secrets)
    if (entry.prompt) {
      if (shouldLogPrompts()) {
        entry.prompt = truncatePrompt(entry.prompt);
      } else {
        entry.prompt = `[redacted, ${event.prompt!.length} chars]`;
      }
    }

    // Assign a unique entry ID
    entry.entryId = randomUUID();

    // Compute Merkle chain: hash the last line of the current log file
    const dir = getHandoffLogDir();
    await ensureHandoffLogDir(dir);
    const date = new Date().toISOString().split("T")[0];
    const logPath = join(dir, `${date}.jsonl`);

    try {
      const lastLine = await readLastLine(logPath);
      if (lastLine !== null) {
        entry.prevEntryHash = sha256Hex(lastLine);
      }
      // If no last line (first entry in file), prevEntryHash is absent
    } catch (chainErr) {
      process.stderr.write(`[logger] Warning: failed to compute prevEntryHash (chain may be broken): ${chainErr}\n`);
    }

    const line = JSON.stringify(entry) + "\n";
    await appendFile(logPath, line);
  } catch (err) {
    process.stderr.write(`Failed to write handoff event: ${err}\n`);
  }
}
