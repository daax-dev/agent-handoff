/**
 * Two-phase handoff handshake (issue #19).
 *
 * Phase 1 – Propose:   Sender calls proposeHandoff() with a HandoffProposal.
 * Phase 2 – Validate:  Receiver evaluates DoD criteria.
 * Phase 3 – Respond:   Receiver returns HandoffAck (accept) or HandoffRejection.
 *
 * The 30-second timeout is applied by proposeHandoffWithTimeout().  On timeout
 * the function either escalates to "hawkeye" (if HAWKEYE_URL env var is set) or
 * logs a structured warning to stderr.
 *
 * All objects are Zod-validated.
 */

import { z } from "zod";
import { logHandoffEvent } from "../utils/logger.js";
import type { HandoffContext } from "../handoff-context.js";

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

export const DodCriterionSchema = z.object({
  /** Short machine-readable key, e.g. "tests_pass" */
  id: z.string(),
  /** Human-readable description */
  description: z.string(),
  /** Whether this criterion is required (true) or only advisory (false) */
  required: z.boolean().default(true),
});

export const HandoffProposalSchema = z.object({
  version: z.literal("1"),
  /** Sender's job ID */
  senderJobId: z.string(),
  /** Optional human-readable task title */
  taskTitle: z.string().optional(),
  /** Task description / prompt for the receiver */
  prompt: z.string(),
  /** Serialized HandoffContext (base64, from serializeContext()) */
  contextPayload: z.string().optional(),
  /** Definition of Done criteria the receiver must commit to */
  dodCriteria: z.array(DodCriterionSchema),
  /** ISO 8601 timestamp */
  proposedAt: z.string(),
});

export const HandoffAckSchema = z.object({
  version: z.literal("1"),
  accepted: z.literal(true),
  receiverJobId: z.string().optional(),
  /** Which DoD criteria the receiver explicitly accepts */
  acceptedCriteria: z.array(z.string()),
  /** ISO 8601 timestamp */
  acknowledgedAt: z.string(),
});

export const HandoffRejectionSchema = z.object({
  version: z.literal("1"),
  accepted: z.literal(false),
  /** Short machine-readable code, e.g. "CAPABILITY_MISMATCH" */
  reason: z.string(),
  /** Human-readable detail (surfaced back to the sender) */
  detail: z.string().optional(),
  /** ISO 8601 timestamp */
  rejectedAt: z.string(),
});

export const HandoffResponseSchema = z.discriminatedUnion("accepted", [
  HandoffAckSchema,
  HandoffRejectionSchema,
]);

export type DodCriterion = z.infer<typeof DodCriterionSchema>;
export type HandoffProposal = z.infer<typeof HandoffProposalSchema>;
export type HandoffAck = z.infer<typeof HandoffAckSchema>;
export type HandoffRejection = z.infer<typeof HandoffRejectionSchema>;
export type HandoffResponse = HandoffAck | HandoffRejection;

// ---------------------------------------------------------------------------
// Timeout / escalation
// ---------------------------------------------------------------------------

const ACK_TIMEOUT_MS = 30_000;

async function escalateTimeout(proposal: HandoffProposal): Promise<void> {
  const hawkeyeUrl = process.env.HAWKEYE_URL;

  const structuredWarning = {
    level: "WARN",
    event: "handoff_ack_timeout",
    senderJobId: proposal.senderJobId,
    taskTitle: proposal.taskTitle,
    timeoutMs: ACK_TIMEOUT_MS,
    timestamp: new Date().toISOString(),
  };

  if (hawkeyeUrl) {
    try {
      await fetch(hawkeyeUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(structuredWarning),
        signal: AbortSignal.timeout(5_000),
      });
    } catch {
      // Best-effort escalation — fall through to stderr
    }
  }

  process.stderr.write(JSON.stringify(structuredWarning) + "\n");
}

// ---------------------------------------------------------------------------
// Receiver-side: DoD validation
// ---------------------------------------------------------------------------

/**
 * Evaluate whether this receiver can meet all _required_ DoD criteria.
 *
 * Extend or replace the `canMeetCriterion` logic in production to perform real
 * capability introspection (tool availability, memory limits, etc.).
 *
 * @returns  Array of criterion IDs that the receiver cannot meet.
 */
export function evaluateDodCriteria(
  criteria: DodCriterion[],
  receiverCapabilities: string[],
): string[] {
  const unmet: string[] = [];
  for (const criterion of criteria) {
    if (!criterion.required) continue;
    // Convention: if the criterion id matches a capability string, it is met.
    // Callers can pre-register capabilities like "tests_pass", "type_check", etc.
    if (!receiverCapabilities.includes(criterion.id)) {
      unmet.push(criterion.id);
    }
  }
  return unmet;
}

/**
 * Build an acceptance response after DoD validation succeeds.
 */
export function buildAcceptance(
  proposal: HandoffProposal,
  receiverJobId?: string,
): HandoffAck {
  return {
    version: "1",
    accepted: true,
    receiverJobId,
    acceptedCriteria: proposal.dodCriteria.map((c) => c.id),
    acknowledgedAt: new Date().toISOString(),
  };
}

/**
 * Build a rejection response.
 */
export function buildRejection(reason: string, detail?: string): HandoffRejection {
  return {
    version: "1",
    accepted: false,
    reason,
    detail,
    rejectedAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Sender-side: propose with timeout
// ---------------------------------------------------------------------------

/**
 * Propose a handoff to `handler`, applying a 30-second timeout.
 *
 * @param proposal  The handoff proposal
 * @param handler   Async function that validates DoD and returns a response
 * @returns         The receiver's response
 * @throws          Error if the handler rejects with an unexpected exception
 */
export async function proposeHandoffWithTimeout(
  proposal: HandoffProposal,
  handler: (p: HandoffProposal) => Promise<HandoffResponse>,
): Promise<HandoffResponse> {
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;

  const timeoutPromise = new Promise<HandoffResponse>((_, reject) => {
    timeoutHandle = setTimeout(() => {
      reject(new Error("HANDOFF_ACK_TIMEOUT"));
    }, ACK_TIMEOUT_MS);
  });

  try {
    const response = await Promise.race([handler(proposal), timeoutPromise]);
    clearTimeout(timeoutHandle);
    return response;
  } catch (err) {
    clearTimeout(timeoutHandle);

    if (err instanceof Error && err.message === "HANDOFF_ACK_TIMEOUT") {
      await escalateTimeout(proposal);

      await logHandoffEvent({
        timestamp: new Date().toISOString(),
        event: "task_timed_out",
        jobId: proposal.senderJobId,
        transport: "a2a",
        error: `Receiver did not acknowledge within ${ACK_TIMEOUT_MS}ms`,
      });

      return buildRejection("ACK_TIMEOUT", `Receiver did not respond within ${ACK_TIMEOUT_MS}ms`);
    }

    throw err;
  }
}

// ---------------------------------------------------------------------------
// Full two-phase handshake (convenience wrapper)
// ---------------------------------------------------------------------------

/**
 * Execute the complete two-phase handshake:
 *
 *  1. Sender builds a proposal with DoD criteria and optional context payload.
 *  2. Receiver validates DoD against its capabilities.
 *  3. Receiver accepts or rejects.
 *  4. 30-second timeout with escalation on expiry.
 *
 * @param proposal           The handoff proposal
 * @param receiverCapabilities  Set of capability IDs the receiver supports
 * @param receiverJobId      Optional job ID for the receiver to attach to the ack
 * @returns                  HandoffAck on acceptance, HandoffRejection otherwise
 */
export async function executeHandshake(
  proposal: HandoffProposal,
  receiverCapabilities: string[],
  receiverJobId?: string,
): Promise<HandoffResponse> {
  // Parse and validate the proposal
  const parsed = HandoffProposalSchema.safeParse(proposal);
  if (!parsed.success) {
    return buildRejection(
      "MALFORMED_PROPOSAL",
      `Proposal failed schema validation: ${parsed.error.message}`,
    );
  }

  const validProposal = parsed.data;

  const handler = async (p: HandoffProposal): Promise<HandoffResponse> => {
    const unmet = evaluateDodCriteria(p.dodCriteria, receiverCapabilities);
    if (unmet.length > 0) {
      return buildRejection(
        "CAPABILITY_MISMATCH",
        `Receiver cannot meet required DoD criteria: ${unmet.join(", ")}`,
      );
    }
    return buildAcceptance(p, receiverJobId);
  };

  return proposeHandoffWithTimeout(validProposal, handler);
}

// ---------------------------------------------------------------------------
// Proposal factory helper
// ---------------------------------------------------------------------------

/**
 * Build a minimal valid `HandoffProposal`.
 */
export function createProposal(
  params: Omit<HandoffProposal, "version" | "proposedAt">,
): HandoffProposal {
  return {
    version: "1",
    proposedAt: new Date().toISOString(),
    ...params,
  };
}
