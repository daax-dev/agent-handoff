import type { A2ATask, JsonRpcResponse } from "./types.js";

let requestId = 0;

function nextId(): number {
  return ++requestId;
}

export interface A2ARequestOptions {
  authHeaders?: Record<string, string>;
}

const REQUEST_TIMEOUT_MS = 30_000;

async function rpcCall(endpoint: string, method: string, params: Record<string, unknown>, options?: A2ARequestOptions): Promise<unknown> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };

  // Merge auth headers if provided
  if (options?.authHeaders) {
    Object.assign(headers, options.authHeaders);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers,
      signal: controller.signal,
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: nextId(),
        method,
        params,
      }),
    });

    if (!response.ok) {
      throw new Error(`A2A request failed: ${response.status} ${response.statusText}`);
    }

    const data = (await response.json()) as JsonRpcResponse;

    if (data.error) {
      throw new Error(`A2A error [${data.error.code}]: ${data.error.message}`);
    }

    return data.result;
  } finally {
    clearTimeout(timeout);
  }
}

export async function sendMessage(endpoint: string, prompt: string, options?: A2ARequestOptions): Promise<A2ATask> {
  const result = await rpcCall(endpoint, "message/send", {
    message: {
      role: "user",
      parts: [{ type: "text", text: prompt }],
    },
  }, options);
  return result as A2ATask;
}

export async function getTask(endpoint: string, taskId: string, options?: A2ARequestOptions): Promise<A2ATask> {
  const result = await rpcCall(endpoint, "tasks/get", { id: taskId }, options);
  return result as A2ATask;
}

export async function cancelTask(endpoint: string, taskId: string, options?: A2ARequestOptions): Promise<A2ATask> {
  const result = await rpcCall(endpoint, "tasks/cancel", { id: taskId }, options);
  return result as A2ATask;
}

/**
 * Poll a task until it reaches a terminal state.
 * Returns the final task state.
 */
export async function pollUntilDone(
  endpoint: string,
  taskId: string,
  intervalMs = 2000,
  timeoutMs = 300_000,
  options?: A2ARequestOptions,
): Promise<A2ATask> {
  const start = Date.now();
  const maxRetries = Math.ceil(timeoutMs / intervalMs);
  let attempt = 0;

  while (attempt < maxRetries) {
    attempt++;
    const task = await getTask(endpoint, taskId, options);

    if (task.status === "completed" || task.status === "failed" || task.status === "canceled") {
      return task;
    }

    if (Date.now() - start > timeoutMs) {
      throw new Error(`A2A task ${taskId} timed out after ${timeoutMs}ms`);
    }

    // Exponential backoff: interval doubles each 5 attempts, capped at 30s
    const backoff = Math.min(intervalMs * Math.pow(1.5, Math.floor(attempt / 5)), 30_000);
    await new Promise((resolve) => setTimeout(resolve, backoff));
  }

  throw new Error(`A2A task ${taskId} exceeded maximum retry count`);
}
