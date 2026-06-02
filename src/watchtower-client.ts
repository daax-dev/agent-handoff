/**
 * watchtower-client — best-effort WebSocket push of per-job token usage to the
 * watchtower server.
 *
 * Feature is OFF by default: when WATCHTOWER_URL is unset no connection is
 * attempted and the function is a no-op. Errors are caught and logged to stderr;
 * they NEVER propagate to the caller. This must not delay or fail a job.
 *
 * Protocol (pkg/protocol/message.go, internal/db/schema.sql):
 *   The server DB has prompts.session_id FK → sessions.id with FK enforcement
 *   on. A prompt_submit without a prior session_start fails with a FK error.
 *   Therefore we send TWO messages per call:
 *     1. session_start  — creates the session row
 *     2. prompt_submit  — stores the token counts
 *
 * Envelope format:
 *   { type, session_id, timestamp, host, payload }
 * session_start payload (SessionStartPayload):
 *   { working_dir, git_repo, git_branch?, metadata? }
 * prompt_submit payload (PromptSubmitPayload):
 *   { prompt, sequence, input_tokens?, output_tokens?, timestamp }
 */

import { hostname } from "os";

const CONNECT_TIMEOUT_MS = 3000;
const SEND_TIMEOUT_MS = 3000;

export interface PushPromptTokensInput {
  /** Job ID — used as watchtower session_id. */
  sessionId: string;
  /** Sequence number within the session (1 for a single-shot job). */
  sequence: number;
  /** Original job prompt. */
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let ws: any | null = null;

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
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const WSConstructor = (globalThis as any).WebSocket as
        | (new (url: string) => {
            onopen: (() => void) | null;
            onerror: ((e: unknown) => void) | null;
            onclose: (() => void) | null;
            send(data: string): void;
            close(): void;
          })
        | undefined;

      if (!WSConstructor) {
        console.error("[watchtower] WebSocket not available in this runtime");
        finish();
        return;
      }

      ws = new WSConstructor(url);

      ws.onerror = (err: unknown) => {
        console.error("[watchtower] WebSocket error:", err instanceof Error ? err.message : String(err));
        finish();
      };

      ws.onclose = () => {
        finish();
      };

      ws.onopen = () => {
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
          ws.send(JSON.stringify(sessionStart));

          // 2. prompt_submit — stores the token counts for this job
          const promptSubmit = {
            type: "prompt_submit",
            session_id: input.sessionId,
            timestamp: now,
            host,
            payload: {
              prompt: input.prompt,
              sequence: input.sequence,
              ...(input.inputTokens > 0 ? { input_tokens: input.inputTokens } : {}),
              ...(input.outputTokens > 0 ? { output_tokens: input.outputTokens } : {}),
              timestamp: now,
            },
          };
          ws.send(JSON.stringify(promptSubmit));
        } catch (err) {
          console.error("[watchtower] send failed:", err instanceof Error ? err.message : String(err));
        }

        // Close cleanly after sends. Wrap in try so a runtime throw on close
        // does not escape the async handler and violate the no-throws contract.
        try { ws.close(); } catch { /* best effort */ }
      };
    } catch (err) {
      console.error("[watchtower] setup failed:", err instanceof Error ? err.message : String(err));
      finish();
    }
  });
}
