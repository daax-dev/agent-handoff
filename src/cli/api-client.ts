let BASE_URL = (process.env.AGENT_HANDOFF_URL ?? process.env.LOCALSDLC_API_URL ?? "http://localhost:4000").replace(/\/$/, "");
let AUTH_TOKEN: string | undefined = process.env.AGENT_HANDOFF_TOKEN;

export function configure(opts: { url?: string; token?: string }) {
  if (opts.url !== undefined) BASE_URL = opts.url.replace(/\/$/, "");
  if (opts.token !== undefined) AUTH_TOKEN = opts.token;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string
  ) {
    super(message);
  }
}

function authHeaders(extra?: Record<string, string>): Record<string, string> {
  const h: Record<string, string> = { ...extra };
  if (AUTH_TOKEN) h["Authorization"] = `Bearer ${AUTH_TOKEN}`;
  return h;
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${BASE_URL}${path}`, {
      method,
      headers: authHeaders(body ? { "Content-Type": "application/json" } : undefined),
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("ECONNREFUSED") || msg.includes("Connection refused") || msg.includes("fetch failed") || msg.toLowerCase().includes("unable to connect")) {
      throw new ApiError(0, "API server not running. Start it with: bun run dev:api");
    }
    throw e;
  }

  if (!res.ok) {
    let errMsg = `HTTP ${res.status}`;
    try {
      const j = await res.json() as { error?: string };
      if (j.error) errMsg = j.error;
    } catch {}
    throw new ApiError(res.status, errMsg);
  }

  return res.json() as Promise<T>;
}

async function getRaw(path: string): Promise<string> {
  let res: Response;
  try {
    res = await fetch(`${BASE_URL}${path}`, { headers: authHeaders() });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("ECONNREFUSED") || msg.includes("Connection refused") || msg.includes("fetch failed") || msg.toLowerCase().includes("unable to connect")) {
      throw new ApiError(0, "API server not running. Start it with: bun run dev:api");
    }
    throw e;
  }

  if (!res.ok) {
    let errMsg = `HTTP ${res.status}`;
    try {
      const j = await res.json() as { error?: string };
      if (j.error) errMsg = j.error;
    } catch {}
    throw new ApiError(res.status, errMsg);
  }

  return res.text();
}

export const api = {
  get: <T>(path: string) => request<T>("GET", path),
  getRaw: (path: string) => getRaw(path),
  post: <T>(path: string, body: unknown) => request<T>("POST", path, body),
  put: <T>(path: string, body: unknown) => request<T>("PUT", path, body),
  patch: <T>(path: string, body: unknown) => request<T>("PATCH", path, body),
};
