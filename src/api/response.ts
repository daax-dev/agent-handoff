export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export function notFound(message = "Not found"): Response {
  return json({ error: message, code: "NOT_FOUND" }, 404);
}

export function badRequest(message: string, status = 400): Response {
  return json({ error: message, code: "BAD_REQUEST" }, status);
}

export function err(message: string, status = 500): Response {
  return json({ error: message, code: "INTERNAL_ERROR" }, status);
}
