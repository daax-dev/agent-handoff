import { useEffect, useRef } from "react";
import type { SSEEvent } from "@/types";

const SSE_URL = "/events/stream";

export function useSSE(onEvent: (event: SSEEvent) => void) {
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;

  useEffect(() => {
    let es: EventSource | null = null;
    let retryTimeout: ReturnType<typeof setTimeout> | null = null;
    let retryDelay = 1000;
    let active = true;

    function connect() {
      if (!active) return;

      es = new EventSource(SSE_URL);

      es.onmessage = (e) => {
        try {
          const event = JSON.parse(e.data) as SSEEvent;
          onEventRef.current(event);
        } catch {}
      };

      es.onerror = () => {
        es?.close();
        es = null;
        if (!active) return;
        retryTimeout = setTimeout(() => {
          retryDelay = Math.min(retryDelay * 2, 30_000);
          connect();
        }, retryDelay);
      };

      es.onopen = () => {
        retryDelay = 1000; // reset on successful connect
      };
    }

    connect();

    return () => {
      active = false;
      if (retryTimeout) clearTimeout(retryTimeout);
      es?.close();
    };
  }, []);
}
