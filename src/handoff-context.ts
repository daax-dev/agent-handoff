/**
 * HandoffContext — structured task-continuation payload for multi-agent sessions.
 *
 * Satisfies issue #18:
 *  - Zod schema for completed_tasks, decisions, modified_files, next_steps
 *  - Serialize → deflate (zlib) → base64 with a 50 KB guard
 *  - Deserialize → inflate → parse with Zod
 *
 * The payload is embedded inside a HandoffEnvelope (see src/auth/spiffe.ts) so
 * that it can optionally be SVID-signed before transmission.
 *
 * Compression uses Node's built-in `zlib` (deflateSync / inflateSync) so there
 * are no additional runtime dependencies.
 */

import { z } from "zod";
import { deflateSync, inflateSync } from "zlib";

// ---------------------------------------------------------------------------
// Zod schema
// ---------------------------------------------------------------------------

export const CompletedTaskSchema = z.object({
  /** Task identifier (e.g. backlog task id, job id) */
  id: z.string(),
  /** Short human-readable title */
  title: z.string(),
  /** ISO 8601 completion timestamp */
  completedAt: z.string(),
  /** Optional outcome summary */
  summary: z.string().optional(),
});

export const DecisionSchema = z.object({
  /** Short description of what was decided */
  description: z.string(),
  /** Why this decision was made */
  rationale: z.string().optional(),
  /** ISO 8601 timestamp */
  decidedAt: z.string(),
});

export const ModifiedFileSchema = z.object({
  /** Relative or absolute path */
  path: z.string(),
  /** Nature of the change */
  changeType: z.enum(["added", "modified", "deleted", "renamed"]),
  /** Optional note (e.g. what changed and why) */
  note: z.string().optional(),
});

export const NextStepSchema = z.object({
  /** Ordered step index (1-based) */
  order: z.number().int().positive(),
  /** Short imperative description, e.g. "Run integration tests" */
  description: z.string(),
  /** Optional fuller context for the receiving agent */
  context: z.string().optional(),
  /** Suggested receiving agent, e.g. "claude" */
  suggestedAgent: z.string().optional(),
});

export const HandoffContextSchema = z.object({
  /** Schema version for forward compatibility */
  version: z.literal("1"),
  /** Source job / session identifier */
  sourceJobId: z.string().optional(),
  /** Tasks that the sender has already completed */
  completed_tasks: z.array(CompletedTaskSchema),
  /** Architectural / implementation decisions made during this session */
  decisions: z.array(DecisionSchema),
  /** Files that were created or changed */
  modified_files: z.array(ModifiedFileSchema),
  /** Ordered work items for the receiving agent */
  next_steps: z.array(NextStepSchema),
  /** Freeform working directory snapshot (cwd, branch, etc.) */
  workingContext: z
    .object({
      workingDirectory: z.string().optional(),
      gitBranch: z.string().optional(),
      gitHeadSha: z.string().optional(),
    })
    .optional(),
});

export type HandoffContext = z.infer<typeof HandoffContextSchema>;
export type CompletedTask = z.infer<typeof CompletedTaskSchema>;
export type Decision = z.infer<typeof DecisionSchema>;
export type ModifiedFile = z.infer<typeof ModifiedFileSchema>;
export type NextStep = z.infer<typeof NextStepSchema>;

// ---------------------------------------------------------------------------
// Size limit
// ---------------------------------------------------------------------------

const MAX_COMPRESSED_BYTES = 50 * 1024; // 50 KB
// base64 encodes 3 bytes as 4 chars; add small margin for padding
const MAX_ENCODED_CHARS = Math.ceil(MAX_COMPRESSED_BYTES * 4 / 3) + 4;
const MAX_UNCOMPRESSED_BYTES = 500 * 1024; // 500 KB — prevent decompression bombs

// ---------------------------------------------------------------------------
// Serialization
// ---------------------------------------------------------------------------

/**
 * Serialize and compress a `HandoffContext` into a base64 string.
 *
 * @throws Error if the compressed payload exceeds 50 KB.
 */
export function serializeContext(ctx: HandoffContext): string {
  // Validate first
  HandoffContextSchema.parse(ctx);

  const json = JSON.stringify(ctx);
  const compressed = deflateSync(Buffer.from(json, "utf8"), { level: 9 });

  if (compressed.byteLength > MAX_COMPRESSED_BYTES) {
    throw new Error(
      `HandoffContext compressed size ${compressed.byteLength} bytes exceeds limit of ${MAX_COMPRESSED_BYTES} bytes. ` +
        "Reduce the size of completed_tasks, decisions, modified_files, or next_steps.",
    );
  }

  return compressed.toString("base64");
}

/**
 * Decompress and deserialize a base64-encoded `HandoffContext`.
 *
 * @throws ZodError on schema violations, or Error on decompression failure.
 */
export function deserializeContext(encoded: string): HandoffContext {
  // Bound input string length before allocating a Buffer (Comment 5)
  if (encoded.length > MAX_ENCODED_CHARS) {
    throw new Error(
      `Encoded payload length ${encoded.length} chars exceeds limit of ${MAX_ENCODED_CHARS} chars`,
    );
  }
  const compressed = Buffer.from(encoded, "base64");
  if (compressed.byteLength > MAX_COMPRESSED_BYTES) {
    throw new Error(
      `Compressed payload ${compressed.byteLength} bytes exceeds limit of ${MAX_COMPRESSED_BYTES} bytes`,
    );
  }
  // Guard against decompression bombs: check uncompressed size before JSON.parse (Comment 6)
  const decompressed = inflateSync(compressed);
  if (decompressed.byteLength > MAX_UNCOMPRESSED_BYTES) {
    throw new Error(
      `Uncompressed payload ${decompressed.byteLength} bytes exceeds limit of ${MAX_UNCOMPRESSED_BYTES} bytes`,
    );
  }
  const raw = JSON.parse(decompressed.toString("utf8")) as unknown;
  return HandoffContextSchema.parse(raw);
}

// ---------------------------------------------------------------------------
// Builder helper
// ---------------------------------------------------------------------------

/**
 * Create a minimal, valid `HandoffContext` with sensible defaults.
 * Useful for callers that only need to populate a few fields.
 */
export function createHandoffContext(
  partial: Partial<Omit<HandoffContext, "version">>,
): HandoffContext {
  return {
    version: "1",
    completed_tasks: partial.completed_tasks ?? [],
    decisions: partial.decisions ?? [],
    modified_files: partial.modified_files ?? [],
    next_steps: partial.next_steps ?? [],
    sourceJobId: partial.sourceJobId,
    workingContext: partial.workingContext,
  };
}
