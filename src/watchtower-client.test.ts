/**
 * watchtower-client tests (bun:test)
 *
 * Closed-loop assertions:
 *   1. Happy path — mock WS server captures messages; asserts session_start
 *      is sent before prompt_submit, and token counts are correct.
 *   2. Default-off — no WATCHTOWER_URL → globalThis.WebSocket constructor is
 *      never called (mocked and counted).
 *   3. Connect failure — refused port → resolves without throwing.
 */

import { describe, test, expect, afterEach } from "bun:test";
import { pushPromptTokens } from "./watchtower-client.js";

// Sentinel: distinguishes "test did not touch WebSocket" from "test explicitly
// deleted it". Only restore when the test set wsMocked = true.
const WS_NOT_MOCKED = Symbol("WS_NOT_MOCKED");

// Save / restore WATCHTOWER_URL and any globalThis.WebSocket mock around every test.
let savedUrl: string | undefined;
let savedWebSocket: unknown = WS_NOT_MOCKED;

afterEach(() => {
  if (savedUrl === undefined) {
    delete process.env.WATCHTOWER_URL;
  } else {
    process.env.WATCHTOWER_URL = savedUrl;
  }
  savedUrl = undefined;

  if (savedWebSocket !== WS_NOT_MOCKED) {
    if (savedWebSocket === undefined) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      delete (globalThis as any).WebSocket;
    } else {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (globalThis as any).WebSocket = savedWebSocket;
    }
  }
  savedWebSocket = WS_NOT_MOCKED;
});

// ---------------------------------------------------------------------------
// Helper: start an in-process mock WebSocket server on an ephemeral port.
// Returns the assigned port, a promise that resolves with all messages
// received during the connection, and a stop function.
// ---------------------------------------------------------------------------
function startMockServer(): {
  port: number;
  messages: Promise<string[]>;
  stop: () => void;
} {
  const received: string[] = [];
  let resolveMessages!: (msgs: string[]) => void;
  const messages = new Promise<string[]>((res) => {
    resolveMessages = res;
  });

  const server = Bun.serve({
    port: 0, // ephemeral port
    fetch(req, srv) {
      if (srv.upgrade(req)) {
        return undefined as unknown as Response;
      }
      return new Response("not a ws", { status: 400 });
    },
    websocket: {
      message(_ws, msg) {
        received.push(typeof msg === "string" ? msg : msg.toString());
      },
      open(_ws) {},
      close(_ws) {
        resolveMessages([...received]);
      },
    },
  });

  return {
    port: server.port as number,
    messages,
    stop: () => server.stop(true),
  };
}

// ---------------------------------------------------------------------------
// 1. Happy path: message order + structure
// ---------------------------------------------------------------------------
describe("pushPromptTokens — happy path", () => {
  test("sends session_start before prompt_submit (P1 regression)", async () => {
    savedUrl = process.env.WATCHTOWER_URL;
    const { port, messages, stop } = startMockServer();
    process.env.WATCHTOWER_URL = `ws://localhost:${port}`;

    try {
      await pushPromptTokens({
        sessionId: "job-abc-123",
        sequence: 1,
        prompt: "do the thing",
        inputTokens: 42,
        outputTokens: 17,
      });

      const msgs = await messages;
      expect(msgs.length).toBe(2);

      const first = JSON.parse(msgs[0]!) as Record<string, unknown>;
      const second = JSON.parse(msgs[1]!) as Record<string, unknown>;

      // session_start must come first
      expect(first.type).toBe("session_start");
      expect(first.session_id).toBe("job-abc-123");

      // prompt_submit must come second
      expect(second.type).toBe("prompt_submit");
      expect(second.session_id).toBe("job-abc-123");
    } finally {
      stop();
    }
  });

  test("prompt_submit envelope has correct structure and token counts", async () => {
    savedUrl = process.env.WATCHTOWER_URL;
    const { port, messages, stop } = startMockServer();
    process.env.WATCHTOWER_URL = `ws://localhost:${port}`;

    try {
      await pushPromptTokens({
        sessionId: "job-abc-123",
        sequence: 1,
        prompt: "do the thing",
        inputTokens: 42,
        outputTokens: 17,
      });

      const msgs = await messages;
      const second = JSON.parse(msgs[1]!) as Record<string, unknown>;

      // Envelope
      expect(second.type).toBe("prompt_submit");
      expect(second.session_id).toBe("job-abc-123");
      expect(typeof second.timestamp).toBe("string");
      expect(typeof second.host).toBe("string");

      // Payload
      const payload = second.payload as Record<string, unknown>;
      expect(payload.sequence).toBe(1);
      expect(payload.prompt).toBe("do the thing");
      expect(payload.input_tokens).toBe(42);
      expect(payload.output_tokens).toBe(17);
      expect(typeof payload.timestamp).toBe("string");
    } finally {
      stop();
    }
  });

  test("omits input_tokens when 0", async () => {
    savedUrl = process.env.WATCHTOWER_URL;
    const { port, messages, stop } = startMockServer();
    process.env.WATCHTOWER_URL = `ws://localhost:${port}`;

    try {
      await pushPromptTokens({
        sessionId: "job-xyz",
        sequence: 1,
        prompt: "run tests",
        inputTokens: 0,
        outputTokens: 5,
      });

      const msgs = await messages;
      const second = JSON.parse(msgs[1]!) as Record<string, unknown>;
      const payload = second.payload as Record<string, unknown>;

      expect("input_tokens" in payload).toBe(false);
      expect(payload.output_tokens).toBe(5);
    } finally {
      stop();
    }
  });
});

// ---------------------------------------------------------------------------
// 2. Default-off: no WATCHTOWER_URL → WebSocket constructor never called
// ---------------------------------------------------------------------------
describe("pushPromptTokens — default off", () => {
  test("does not construct WebSocket when WATCHTOWER_URL is unset", async () => {
    savedUrl = process.env.WATCHTOWER_URL;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    savedWebSocket = (globalThis as any).WebSocket;

    delete process.env.WATCHTOWER_URL;

    let constructorCallCount = 0;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).WebSocket = function MockWS() {
      constructorCallCount++;
    };

    await pushPromptTokens({
      sessionId: "job-no-url",
      sequence: 1,
      prompt: "noop",
      inputTokens: 10,
      outputTokens: 3,
    });

    expect(constructorCallCount).toBe(0);
  });

  test("resolves immediately when WATCHTOWER_URL is unset", async () => {
    savedUrl = process.env.WATCHTOWER_URL;
    delete process.env.WATCHTOWER_URL;

    const before = Date.now();
    await expect(
      pushPromptTokens({
        sessionId: "job-no-url-2",
        sequence: 1,
        prompt: "noop",
        inputTokens: 10,
        outputTokens: 3,
      })
    ).resolves.toBeUndefined();
    const elapsed = Date.now() - before;
    expect(elapsed).toBeLessThan(500);
  });
});

// ---------------------------------------------------------------------------
// 3. Connect failure: refused port → resolves without throwing
// ---------------------------------------------------------------------------
describe("pushPromptTokens — connect failure", () => {
  test("resolves without throwing when the target port is refused", async () => {
    savedUrl = process.env.WATCHTOWER_URL;
    // Port 1 is privileged and always refused (or unreachable) in test env.
    process.env.WATCHTOWER_URL = "ws://localhost:1";

    await expect(
      pushPromptTokens({
        sessionId: "job-refused",
        sequence: 1,
        prompt: "will fail",
        inputTokens: 5,
        outputTokens: 2,
      })
    ).resolves.toBeUndefined();
  });
});
