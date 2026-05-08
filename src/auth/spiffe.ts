/**
 * SPIFFE SVID-based handoff signing and verification.
 *
 * TODO: Replace the stub SVID implementation with a real SPIFFE/SPIRE library
 * (e.g. `spiffe` npm package) once one is available with first-class TypeScript
 * support and compatible licensing.  The interface and function signatures are
 * intentionally stable so the swap is mechanical.
 *
 * Current implementation uses HMAC-SHA256 over a deterministic payload string
 * as a stand-in for the X.509-SVID JWT assertion that a full SPIFFE workload API
 * would provide.  The mock SVID carries a `spiffeId` (e.g.
 * `spiffe://example.org/agent/claude`), an `expiry` ISO timestamp, and a
 * `privateKey` used for signing.
 */

import { createHmac, timingSafeEqual, randomBytes } from "crypto";
import { z } from "zod";

// ---------------------------------------------------------------------------
// SVID stub types (replace with real SPIFFE library types)
// ---------------------------------------------------------------------------

export interface SpiffeSvid {
  /** SPIFFE ID, e.g. spiffe://trust-domain/workload */
  spiffeId: string;
  /** ISO 8601 expiry timestamp */
  expiry: string;
  /**
   * Raw signing material.  In a real SVID this would be the private key of
   * the X.509 certificate issued by SPIRE.  Here it is a hex-encoded secret.
   */
  privateKey: string;
}

// ---------------------------------------------------------------------------
// Envelope schema (Zod) – describes what travels on the wire
// ---------------------------------------------------------------------------

export const HandoffEnvelopeSchema = z.object({
  /** The serialized HandoffPayload (JSON string, possibly compressed) */
  payload: z.string(),
  /** SPIFFE ID of the sender workload */
  senderSpiffeId: z.string().min(1),
  /** ISO 8601 timestamp when the envelope was created */
  issuedAt: z.string(),
  /** ISO 8601 timestamp when the SVID expires */
  svidExpiry: z.string(),
  /**
   * HMAC-SHA256 signature (hex) over
   *   `${senderSpiffeId}:${issuedAt}:${svidExpiry}:${payload}`
   */
  signature: z.string().regex(/^[0-9a-f]{64}$/, "signature must be a 64-char lowercase hex HMAC-SHA256 digest"),
  /** Schema version for forward compatibility */
  version: z.literal("1"),
});

export type HandoffEnvelope = z.infer<typeof HandoffEnvelopeSchema>;

// ---------------------------------------------------------------------------
// Structured error for SVID verification failures
// ---------------------------------------------------------------------------

export type SvidErrorCode =
  | "SVID_EXPIRED"
  | "SVID_INVALID_SIGNATURE"
  | "SVID_MALFORMED"
  | "SVID_UNTRUSTED_ID";

export class SvidVerificationError extends Error {
  readonly code: SvidErrorCode;
  readonly senderSpiffeId?: string;

  constructor(code: SvidErrorCode, message: string, senderSpiffeId?: string) {
    super(message);
    this.name = "SvidVerificationError";
    this.code = code;
    this.senderSpiffeId = senderSpiffeId;
  }

  toJSON() {
    return {
      error: this.name,
      code: this.code,
      message: this.message,
      senderSpiffeId: this.senderSpiffeId,
    };
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function canonicalString(
  senderSpiffeId: string,
  issuedAt: string,
  svidExpiry: string,
  payload: string,
): string {
  return `${senderSpiffeId}:${issuedAt}:${svidExpiry}:${payload}`;
}

function computeHmac(secret: string, data: string): string {
  return createHmac("sha256", secret).update(data).digest("hex");
}

function hexEqual(a: string, b: string): boolean {
  // Pad to equal length before timing-safe compare
  const maxLen = Math.max(a.length, b.length);
  const bufA = Buffer.alloc(maxLen, 0);
  const bufB = Buffer.alloc(maxLen, 0);
  bufA.write(a);
  bufB.write(b);
  return timingSafeEqual(bufA, bufB);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Wrap `payload` in a signed `HandoffEnvelope` using `svid`.
 *
 * @param payload   Serialized handoff payload string (JSON or compressed base64)
 * @param svid      Sender's SPIFFE SVID (stub implementation)
 * @returns         Signed envelope ready to transmit
 */
export function signHandoff(payload: string, svid: SpiffeSvid): HandoffEnvelope {
  const issuedAt = new Date().toISOString();
  const canonical = canonicalString(svid.spiffeId, issuedAt, svid.expiry, payload);
  const signature = computeHmac(svid.privateKey, canonical);

  return {
    version: "1",
    payload,
    senderSpiffeId: svid.spiffeId,
    issuedAt,
    svidExpiry: svid.expiry,
    signature,
  };
}

/**
 * Verify a `HandoffEnvelope` against the provided trust store.
 *
 * The function is async so it can be dropped-in replaced with a real async
 * SPIFFE workload API call without changing callers.
 *
 * @param envelope    The received envelope (parsed JSON object)
 * @param trustStore  Map of spiffeId → privateKey for known senders
 * @returns           The raw payload string on success
 * @throws            `SvidVerificationError` on any failure
 */
export async function verifyHandoff(
  envelope: HandoffEnvelope,
  trustStore: Map<string, string>,
): Promise<string> {
  // 1. Parse + structural validation
  const parsed = HandoffEnvelopeSchema.safeParse(envelope);
  if (!parsed.success) {
    throw new SvidVerificationError(
      "SVID_MALFORMED",
      `Envelope failed schema validation: ${parsed.error.message}`,
    );
  }

  const { payload, senderSpiffeId, issuedAt, svidExpiry, signature } = parsed.data;

  // 2. Expiry check — treat unparseable timestamps as malformed, not as "not expired"
  const expiryMs = new Date(svidExpiry).getTime();
  if (Number.isNaN(expiryMs)) {
    throw new SvidVerificationError(
      "SVID_MALFORMED",
      `svidExpiry is not a valid ISO 8601 timestamp: ${svidExpiry}`,
      senderSpiffeId,
    );
  }
  if (Date.now() > expiryMs) {
    throw new SvidVerificationError(
      "SVID_EXPIRED",
      `SVID for ${senderSpiffeId} expired at ${svidExpiry}`,
      senderSpiffeId,
    );
  }

  // 3. Trust store lookup
  const senderKey = trustStore.get(senderSpiffeId);
  if (!senderKey) {
    throw new SvidVerificationError(
      "SVID_UNTRUSTED_ID",
      `No trusted key for SPIFFE ID: ${senderSpiffeId}`,
      senderSpiffeId,
    );
  }

  // 4. Signature verification (timing-safe)
  const canonical = canonicalString(senderSpiffeId, issuedAt, svidExpiry, payload);
  const expected = computeHmac(senderKey, canonical);

  if (!hexEqual(signature, expected)) {
    throw new SvidVerificationError(
      "SVID_INVALID_SIGNATURE",
      `Signature verification failed for ${senderSpiffeId}`,
      senderSpiffeId,
    );
  }

  return payload;
}

// ---------------------------------------------------------------------------
// Mock SVID factory (for tests / local dev)
// ---------------------------------------------------------------------------

/**
 * Create a mock SVID for testing.
 * In production this would be obtained from the SPIFFE workload API.
 */
export function createMockSvid(
  spiffeId: string,
  ttlMs = 3_600_000,
): { svid: SpiffeSvid; privateKey: string } {
  const privateKey = randomBytes(32).toString("hex");
  const expiry = new Date(Date.now() + ttlMs).toISOString();
  return {
    svid: { spiffeId, expiry, privateKey },
    privateKey,
  };
}
