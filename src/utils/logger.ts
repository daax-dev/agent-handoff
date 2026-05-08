import { appendFileSync, mkdirSync, existsSync, openSync, fstatSync, readSync, closeSync } from "fs";
import { appendFile, mkdir } from "fs/promises";
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

/**
 * Returns the handoff log directory.
 * Honors HANDOFF_LOG_DIR env var (used for test isolation).
 */
function getHandoffLogDir(): string {
  if (process.env.HANDOFF_LOG_DIR) {
    return process.env.HANDOFF_LOG_DIR;
  }
  return join(process.cwd(), ".logs", "handoffs");
}

// ---------------------------------------------------------------------------
// Merkle chain state — per log-path mutex and last-hash cache
// ---------------------------------------------------------------------------

/**
 * In-process cache: logPath → SHA-256 hex of the last line written in this
 * session (the raw JSON string without trailing newline).
 * null means the file existed but was empty at session start.
 */
const lastHashCache = new Map<string, string | null>();

/**
 * Per-path promise chain used as a mutex: each write chains onto the previous
 * so that concurrent logHandoffEvent() calls are serialized per log path,
 * preventing two calls from sharing the same prevEntryHash.
 */
const writeLockChain = new Map<string, Promise<void>>();

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
 * Scans backwards in 8KB chunks until a complete line boundary is found,
 * correctly handling JSONL lines of arbitrary length (e.g. large filesChanged
 * arrays that exceed any fixed buffer size).
 * Returns null if the file doesn't exist or is empty.
 */
async function readLastLine(filePath: string): Promise<string | null> {
  try {
    const fd = openSync(filePath, "r");
    try {
      const { size } = fstatSync(fd);
      if (size === 0) return null;
      const CHUNK = 8192;
      let offset = size;
      let tail = "";
      while (offset > 0) {
        const chunkSize = Math.min(CHUNK, offset);
        offset -= chunkSize;
        const buf = Buffer.alloc(chunkSize);
        readSync(fd, buf, 0, chunkSize, offset);
        tail = buf.toString("utf-8") + tail;
        // Strip any trailing newline, then look for the last complete line
        const stripped = tail.replace(/\n+$/, "");
        const nlIdx = stripped.lastIndexOf("\n");
        if (nlIdx !== -1 || offset === 0) {
          // Found a newline boundary — last line is everything after it
          const lastLine = stripped.slice(nlIdx + 1).replace(/\r$/, "");
          return lastLine.length > 0 ? lastLine : null;
        }
        // No newline yet — keep reading backwards
      }
      return null;
    } finally {
      closeSync(fd);
    }
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
 * Evict cache entries for log paths that do not belong to today's date.
 * Prevents indefinite accumulation when a long-running process spans multiple days.
 */
function evictStaleCacheEntries(): void {
  const today = new Date().toISOString().split("T")[0]; // e.g. "2026-05-08"
  for (const key of lastHashCache.keys()) {
    if (!key.includes(today)) {
      lastHashCache.delete(key);
      writeLockChain.delete(key);
    }
  }
}

/**
 * Append entry to a JSONL log file in a serialized, Merkle-chained manner.
 *
 * Uses a per-path promise-chain mutex so that concurrent calls for the same
 * logPath are serialized — preventing two calls from reading the same
 * "last line" and producing the same prevEntryHash.
 *
 * The in-memory `lastHashCache` avoids re-reading the file on every write
 * after the first one this session (O(1) per append after seed).
 *
 * Hash convention: SHA-256 of `JSON.stringify(entry)` (no trailing newline),
 * matching what verify-provenance.ts computes with `sha256Hex(lines[i-1])`.
 */
async function appendChained(logPath: string, entry: HandoffEvent): Promise<void> {
  // Evict stale cache entries from previous days to keep memory bounded.
  evictStaleCacheEntries();

  // Chain onto the previous write promise for this path (or resolve immediately
  // if this is the first write for this path).
  const prevLock = writeLockChain.get(logPath) ?? Promise.resolve();
  let unlock!: () => void;
  const thisLock = new Promise<void>((resolve) => {
    unlock = resolve;
  });
  // Register this write as the new tail of the chain BEFORE awaiting, so
  // any write that arrives while we wait will chain after us, not after prevLock.
  // Use .catch(()=>{}) so a rejected prevLock doesn't poison the chain — callers
  // that arrive after a failed write will still be able to proceed.
  writeLockChain.set(logPath, prevLock.catch(() => {}).then(() => thisLock));

  try {
    await prevLock.catch(() => {}); // don't throw if previous write failed

    // Seed the cache on first write this session (reads last line from disk once).
    if (!lastHashCache.has(logPath)) {
      const last = await readLastLine(logPath);
      lastHashCache.set(logPath, last !== null ? sha256Hex(last) : null);
    }

    const prevHash = lastHashCache.get(logPath);
    delete entry.prevEntryHash; // clear any caller-supplied value before we set the computed one
    if (prevHash !== null && prevHash !== undefined) {
      entry.prevEntryHash = prevHash;
    }

    // Serialize the entry; this is what verify-provenance hashes as lines[i-1].
    const lineContent = JSON.stringify(entry); // no trailing newline — the hash input
    await appendFile(logPath, lineContent + "\n");

    // Update cache with the hash of the line we just wrote (without \n).
    lastHashCache.set(logPath, sha256Hex(lineContent));
  } catch (err) {
    process.stderr.write(`[appendChained] Failed to write entry: ${err}\n`);
  } finally {
    unlock(); // always advance the chain so subsequent writers are not blocked
  }
}

/**
 * Log a handoff event to the JSONL log file.
 * Implements a per-file Merkle chain: each entry includes the SHA-256 hash
 * of the previous entry in the same daily log file.
 *
 * Writes are serialized per log path via a promise-chain mutex so concurrent
 * callers never produce duplicate prevEntryHash values.
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

    // Compute Merkle chain and append atomically (serialized per path)
    const dir = getHandoffLogDir();
    await ensureHandoffLogDir(dir);
    const date = new Date().toISOString().split("T")[0];
    const logPath = join(dir, `${date}.jsonl`);

    await appendChained(logPath, entry);
  } catch (err) {
    process.stderr.write(`Failed to write handoff event: ${err}\n`);
  }
}
