import type { SSEBroadcaster } from "../sse.js";

export function eventsRoute(
  sse: SSEBroadcaster,
  path: string,
  req: Request
): Response | null {
  if (path !== "/events/stream") return null;

  const stream = sse.subscribe();

  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
