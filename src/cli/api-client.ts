const BASE_URL = (process.env.LOCALSDLC_API_URL ?? "http://localhost:4000").replace(/\/$/, "");

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string
  ) {
    super(message);
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${BASE_URL}${path}`, {
      method,
      headers: body ? { "Content-Type": "application/json" } : {},
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("ECONNREFUSED") || msg.includes("Connection refused") || msg.includes("fetch failed")) {
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

export const api = {
  get: <T>(path: string) => request<T>("GET", path),
  post: <T>(path: string, body: unknown) => request<T>("POST", path, body),
  put: <T>(path: string, body: unknown) => request<T>("PUT", path, body),
  patch: <T>(path: string, body: unknown) => request<T>("PATCH", path, body),
};
