import { describe, test, expect, beforeEach } from "./test-compat.js";
import {
  computeBackoffMs,
  withHandshakeRetry,
  DEFAULT_RETRY_POLICY,
  RETRYABLE_REJECTION_CODES,
  type RetryPolicy,
} from "../src/a2a/retry.js";
import { createHandoffContext, serializeContext } from "../src/handoff-context.js";
import { createJob, snapshotJob, rollbackJob, clearJobs } from "../src/job-store.js";
import type { HandoffResponse } from "../src/a2a/handshake.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeAccepted(): HandoffResponse {
  return {
    version: "1",
    accepted: true,
    acceptedCriteria: [],
    acknowledgedAt: new Date().toISOString(),
  };
}

function makeRejection(reason: string, detail?: string): HandoffResponse {
  return {
    version: "1",
    accepted: false,
    reason,
    detail,
    rejectedAt: new Date().toISOString(),
  };
}

const noSleep = (_ms: number): Promise<void> => Promise.resolve();

// ---------------------------------------------------------------------------
// computeBackoffMs
// ---------------------------------------------------------------------------

describe("computeBackoffMs", () => {
  const policy: RetryPolicy = { maxAttempts: 5, baseDelayMs: 100, maxDelayMs: 800 };

  test("returns baseDelayMs on attempt 0", () => {
    expect(computeBackoffMs(0, policy)).toBe(100);
  });

  test("doubles each attempt", () => {
    expect(computeBackoffMs(0, policy)).toBe(100);
    expect(computeBackoffMs(1, policy)).toBe(200);
    expect(computeBackoffMs(2, policy)).toBe(400);
    expect(computeBackoffMs(3, policy)).toBe(800);
  });

  test("caps at maxDelayMs", () => {
    expect(computeBackoffMs(4, policy)).toBe(800); // would be 1600 uncapped
    expect(computeBackoffMs(10, policy)).toBe(800);
  });
});

// ---------------------------------------------------------------------------
// withHandshakeRetry — success cases
// ---------------------------------------------------------------------------

describe("withHandshakeRetry — success on first attempt", () => {
  test("returns accepted response with retryCount=0 and retryExhausted=false", async () => {
    const { response, retryCount, retryExhausted } = await withHandshakeRetry(
      () => Promise.resolve(makeAccepted()),
      DEFAULT_RETRY_POLICY,
      undefined,
      noSleep,
    );
    expect(response.accepted).toBe(true);
    expect(retryCount).toBe(0);
    expect(retryExhausted).toBe(false);
  });
});

describe("withHandshakeRetry — non-retryable rejection", () => {
  test("does not retry on CAPABILITY_MISMATCH; returns retryCount=0 and retryExhausted=false", async () => {
    let calls = 0;
    const { response, retryCount, retryExhausted } = await withHandshakeRetry(
      () => { calls++; return Promise.resolve(makeRejection("CAPABILITY_MISMATCH", "no match")); },
      DEFAULT_RETRY_POLICY,
      undefined,
      noSleep,
    );
    expect(response.accepted).toBe(false);
    expect(retryCount).toBe(0);
    expect(retryExhausted).toBe(false);
    expect(calls).toBe(1); // exactly one attempt
    // CAPABILITY_MISMATCH is not in the retryable set
    expect(RETRYABLE_REJECTION_CODES.has("CAPABILITY_MISMATCH")).toBe(false);
  });
});

describe("withHandshakeRetry — success after one retry", () => {
  test("retryCount=1, retryExhausted=false when first ACK_TIMEOUT then accepted", async () => {
    let calls = 0;
    const onRetryArgs: Array<{ n: number; ms: number }> = [];

    const { response, retryCount, retryExhausted } = await withHandshakeRetry(
      () => {
        calls++;
        return Promise.resolve(calls === 1 ? makeRejection("ACK_TIMEOUT") : makeAccepted());
      },
      DEFAULT_RETRY_POLICY,
      (n, ms) => { onRetryArgs.push({ n, ms }); },
      noSleep,
    );

    expect(response.accepted).toBe(true);
    expect(retryCount).toBe(1);
    expect(retryExhausted).toBe(false);
    expect(calls).toBe(2);
    expect(onRetryArgs).toHaveLength(1);
    expect(onRetryArgs[0]).toEqual({ n: 1, ms: 100 });
  });
});

describe("withHandshakeRetry — retry exhaustion", () => {
  test("retryCount=4, retryExhausted=true when all 5 attempts return ACK_TIMEOUT", async () => {
    let calls = 0;
    const sleepArgs: number[] = [];

    const { response, retryCount, retryExhausted } = await withHandshakeRetry(
      () => { calls++; return Promise.resolve(makeRejection("ACK_TIMEOUT")); },
      DEFAULT_RETRY_POLICY,
      undefined,
      (ms) => { sleepArgs.push(ms); return Promise.resolve(); },
    );

    expect(response.accepted).toBe(false);
    expect((response as { reason: string }).reason).toBe("ACK_TIMEOUT");
    expect(retryCount).toBe(4);
    expect(retryExhausted).toBe(true);
    expect(calls).toBe(5); // 1 initial + 4 retries
    expect(sleepArgs).toEqual([100, 200, 400, 800]); // 4 sleep intervals
  });
});

// ---------------------------------------------------------------------------
// canonicalStringify via serializeContext
// ---------------------------------------------------------------------------

describe("canonicalStringify (via serializeContext)", () => {
  test("same HandoffContext with different property insertion order round-trips to identical bytes", () => {
    const base = createHandoffContext({
      sourceJobId: "hnd_canonical",
      completed_tasks: [{ id: "t1", title: "Alpha", completedAt: "2026-01-01T00:00:00Z" }],
      next_steps: [{ order: 1, description: "Do thing" }],
    });

    // Produce a second object with keys in a different insertion order.
    // All keys from base must be present so undefined filtering applies equally.
    const reordered: typeof base = {
      next_steps: base.next_steps,
      decisions: base.decisions,
      version: base.version,
      workingContext: base.workingContext,
      modified_files: base.modified_files,
      completed_tasks: base.completed_tasks,
      sourceJobId: base.sourceJobId,
    };

    const enc1 = serializeContext(base);
    const enc2 = serializeContext(reordered);
    expect(enc1).toBe(enc2);
  });
});

// ---------------------------------------------------------------------------
// snapshotJob / rollbackJob
// ---------------------------------------------------------------------------

describe("snapshotJob", () => {
  beforeEach(() => clearJobs());

  test("captures initial job state before any handshake mutation", () => {
    const job = createJob({ transport: "a2a", agentUrl: "http://a.test", prompt: "p" });
    const snap = snapshotJob(job.id);
    expect(snap).toBeDefined();
    expect(snap!.status).toBe("queued");
    expect(snap!.handshakeStatus).toBeUndefined();
    expect(snap!.error).toBeUndefined();
  });

  test("snapshot is stored on the job object", () => {
    const job = createJob({ transport: "a2a", agentUrl: "http://a.test", prompt: "p" });
    snapshotJob(job.id);
    // job.snapshot must be set — read it back via the job reference
    expect(job.snapshot).toBeDefined();
    expect(job.snapshot!.status).toBe("queued");
  });
});

describe("rollbackJob", () => {
  beforeEach(() => clearJobs());

  test("restores status, handshakeStatus, and error from snapshot", () => {
    const job = createJob({ transport: "a2a", agentUrl: "http://a.test", prompt: "p" });
    snapshotJob(job.id);

    // Simulate handshake mutation
    Object.assign(job, {
      handshakeStatus: "rejected",
      handshakeRejectionReason: "ACK_TIMEOUT",
      status: "failed",
      error: "timed out",
      retryExhausted: true,
    });

    const restored = rollbackJob(job.id);
    expect(restored).toBeDefined();
    expect(restored!.status).toBe("queued");
    expect(restored!.handshakeStatus).toBeUndefined();
    expect(restored!.handshakeRejectionReason).toBeUndefined();
    expect(restored!.error).toBeUndefined();
    expect(restored!.retryExhausted).toBeUndefined();
  });

  test("returns undefined when job has no snapshot", () => {
    const job = createJob({ transport: "a2a", agentUrl: "http://a.test", prompt: "p" });
    const result = rollbackJob(job.id);
    expect(result).toBeUndefined();
  });
});
