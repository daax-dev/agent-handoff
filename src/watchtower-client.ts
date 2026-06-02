/**
 * watchtower-client — best-effort WebSocket push of per-job token usage to the
 * watchtower server.
 *
 * Feature is OFF by default: when WATCHTOWER_URL is unset no connection is
 * attempted and the function is a no-op. Errors are caught and logged to stderr;
 * they NEVER propagate to the caller. This must not delay or fail a job.
 *
 * Protocol (defined in the external watchtower server repo; not present in
 * this repo — reference only):
 *   The watchtower DB has prompts.session_id FK → sessions.id with FK
 *   enforcement on. A prompt_submit without a prior session_start fails with a
 *   FK constraint error. Therefore we send TWO messages per call:
 *     1. session_start  — creates the session row
 *     2. prompt_submit  — stores the token counts
 *
 * Envelope format:
 *   { type, session_id, timestamp, host, payload }
 * session_start payload sent here (minimal subset of SessionStartPayload):
 *   { working_dir: "", git_repo: false }
 * prompt_submit payload (PromptSubmitPayload):
 *   { prompt, sequence, input_tokens?, output_tokens?, timestamp }
 */

import { hostname } from "os";

const CONNECT_TIMEOUT_MS = 3000;
const SEND_TIMEOUT_MS = 3000;

/** Minimal WS interface we use (subset of browser WebSocket). */
interface MinimalWS {
  onopen: (() => void) | null;
  onerror: ((e: unknown) => void) | null;
  onclose: (() => void) | null;
  send(data: string): void;
  close(): void;
}

export interface PushPromptTokensInput {
  /** Job ID — used as watchtower session_id. */
  sessionId: string;
  /** Sequence number within the session (1 for a single-shot job). */
  sequence: number;
  /** Original job prompt (redacted before sending — may contain secrets). */
  prompt: string;
  /** Input token count (omitted when 0). */
  inputTokens: number;
  /** Output token count (omitted when 0). */
  outputTokens: number;
}

/**
 * Push a session_start + prompt_submit envelope pair to the watchtower WS
 * endpoint.
 *
 * Returns a Promise that always resolves (never rejects). If WATCHTOWER_URL
 * is unset the function is a synchronous no-op that returns a resolved promise.
 */
export function pushPromptTokens(input: PushPromptTokensInput): Promise<void> {
  const url = process.env.WATCHTOWER_URL;
  if (!url) {
    // Feature default-off: no URL → silent no-op.
    return Promise.resolve();
  }

  return new Promise<void>((resolve) => {
    let settled = false;
    let connectTimer: ReturnType<typeof setTimeout> | null = null;
    let sendTimer: ReturnType<typeof setTimeout> | null = null;
    let ws: MinimalWS | null = null;

    function finish(): void {
      if (settled) return;
      settled = true;
      if (connectTimer !== null) clearTimeout(connectTimer);
      if (sendTimer !== null) clearTimeout(sendTimer);
      try { ws?.close(); } catch { /* best effort */ }
      resolve();
    }

    connectTimer = setTimeout(() => {
      console.error("[watchtower] connect timeout");
      finish();
    }, CONNECT_TIMEOUT_MS);

    try {
      // Use the global WebSocket (available in Bun and Node 22+).
      const WSConstructor = (globalThis as { WebSocket?: new (url: string) => MinimalWS }).WebSocket;

      if (!WSConstructor) {
        console.error("[watchtower] WebSocket not available in this runtime");
        finish();
        return;
      }

      const socket = new WSConstructor(url);
      ws = socket;

      socket.onerror = (err: unknown) => {
        console.error("[watchtower] WebSocket error:", err instanceof Error ? err.message : String(err));
        finish();
      };

      socket.onclose = () => {
        finish();
      };

      socket.onopen = () => {
        // Guard: if the connect timeout already fired and settled the promise,
        // do nothing. Without this guard, ws.onopen could run after finish()
        // and schedule sendTimer or attempt sends on an already-settled call,
        // keeping the process alive for up to SEND_TIMEOUT_MS.
        if (settled) return;

        if (connectTimer !== null) {
          clearTimeout(connectTimer);
          connectTimer = null;
        }

        sendTimer = setTimeout(() => {
          console.error("[watchtower] send timeout");
          finish();
        }, SEND_TIMEOUT_MS);

        try {
          const now = new Date().toISOString();
          const host = hostname();

          // Redact the prompt: it may contain credentials or PII. Send only a
          // fixed placeholder so the sequence/token counts are recorded without
          // persisting sensitive user content in the external service.
          const safePrompt = "[redacted]";

          // 1. session_start — required before prompt_submit due to FK constraint
          const sessionStart = {
            type: "session_start",
            session_id: input.sessionId,
            timestamp: now,
            host,
            payload: {
              working_dir: "",
              git_repo: false,
            },
          };
          socket.send(JSON.stringify(sessionStart));

          // 2. prompt_submit — stores the token counts for this job
          const promptSubmit = {
            type: "prompt_submit",
            session_id: input.sessionId,
            timestamp: now,
            host,
            payload: {
              prompt: safePrompt,
              sequence: input.sequence,
              ...(input.inputTokens > 0 ? { input_tokens: input.inputTokens } : {}),
              ...(input.outputTokens > 0 ? { output_tokens: input.outputTokens } : {}),
              timestamp: now,
            },
          };
          socket.send(JSON.stringify(promptSubmit));
        } catch (err) {
          console.error("[watchtower] send failed:", err instanceof Error ? err.message : String(err));
        }

        // Close cleanly after sends. Wrap in try so a runtime throw on close
        // does not escape the async handler and violate the no-throws contract.
        try { socket.close(); } catch { /* best effort */ }
      };
    } catch (err) {
      console.error("[watchtower] setup failed:", err instanceof Error ? err.message : String(err));
      finish();
    }
  });
}
