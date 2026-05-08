import type { HandoffResponse } from "./handshake.js";

export interface RetryPolicy {
  /** Total number of attempts (1 initial + N-1 retries). */
  maxAttempts: number;
  /** Delay before the first retry, in milliseconds. */
  baseDelayMs: number;
  /** Maximum delay between retries, in milliseconds. */
  maxDelayMs: number;
}

export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxAttempts: 5,   // 1 initial + 4 retries
  baseDelayMs: 100,
  maxDelayMs: 800,
};

/** Rejection codes that should be retried. All others are non-retryable. */
export const RETRYABLE_REJECTION_CODES = new Set(["ACK_TIMEOUT"]);

/**
 * Compute exponential-backoff delay for a given retry attempt index (0-based).
 * Capped at policy.maxDelayMs.
 */
export function computeBackoffMs(attempt: number, policy: RetryPolicy): number {
  return Math.min(policy.baseDelayMs * Math.pow(2, attempt), policy.maxDelayMs);
}

export interface RetryResult {
  response: HandoffResponse;
  /** Number of retries performed (0 = succeeded or rejected on first attempt). */
  retryCount: number;
  /** True if all maxAttempts were exhausted on retryable rejections. */
  retryExhausted: boolean;
}

/**
 * Invoke `propose` up to `policy.maxAttempts` times, retrying only on
 * RETRYABLE_REJECTION_CODES.  Between retries the `onRetry` callback fires
 * (use it to roll back job state and log events) and then `sleep` is awaited
 * for the backoff interval.
 *
 * @param propose   The handshake call to retry.
 * @param policy    Retry configuration.
 * @param onRetry   Called before each retry sleep; receives (retryNumber, delayMs).
 *                  retryNumber is 1-indexed (first retry = 1).
 * @param sleep     Injectable sleep function — defaults to real setTimeout.
 *                  Override in tests to avoid real timers.
 */
export async function withHandshakeRetry(
  propose: () => Promise<HandoffResponse>,
  policy: RetryPolicy = DEFAULT_RETRY_POLICY,
  onRetry: (retryNumber: number, delayMs: number) => Promise<void> | void = () => {},
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
): Promise<RetryResult> {
  let lastResponse: HandoffResponse | undefined;

  for (let attempt = 0; attempt < policy.maxAttempts; attempt++) {
    const response = await propose();

    if (response.accepted) {
      return { response, retryCount: attempt, retryExhausted: false };
    }

    if (!RETRYABLE_REJECTION_CODES.has(response.reason)) {
      return { response, retryCount: attempt, retryExhausted: false };
    }

    lastResponse = response;

    if (attempt < policy.maxAttempts - 1) {
      const delayMs = computeBackoffMs(attempt, policy);
      await onRetry(attempt + 1, delayMs);
      await sleep(delayMs);
    }
  }

  return { response: lastResponse!, retryCount: policy.maxAttempts - 1, retryExhausted: true };
}
