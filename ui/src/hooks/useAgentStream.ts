import { useEffect, useRef, useState } from "react";

const MAX_LINES = 2000;
const SSE_URL = "/events/stream";

export interface AgentStreamState {
  lines: string[];
  isLive: boolean;
  taskId: string;
}

export function useAgentStream(taskId: string): AgentStreamState {
  const [lines, setLines] = useState<string[]>([]);
  const [isLive, setIsLive] = useState(false);
  const taskIdRef = useRef(taskId);
  taskIdRef.current = taskId;

  // Fetch historical log on mount / taskId change
  useEffect(() => {
    if (!taskId) return;
    let cancelled = false;

    fetch(`/api/tasks/${taskId}/log`)
      .then((res) => (res.ok ? res.text() : ""))
      .then((text) => {
        if (cancelled) return;
        const historical = text ? text.split("\n").filter((l) => l !== "") : [];
        setLines(historical.slice(-MAX_LINES));
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [taskId]);

  // Subscribe to live SSE events
  useEffect(() => {
    if (!taskId) return;
    let es: EventSource | null = null;
    let retryTimeout: ReturnType<typeof setTimeout> | null = null;
    let retryDelay = 1000;
    let active = true;

    function connect() {
      if (!active) return;
      es = new EventSource(SSE_URL);

      es.onopen = () => {
        retryDelay = 1000;
        setIsLive(true);
      };

      es.onmessage = (e) => {
        try {
          const event = JSON.parse(e.data);
          if (
            event.type === "agent_output" &&
            event.payload?.taskId === taskIdRef.current
          ) {
            const line = String(event.payload?.line ?? event.payload?.text ?? "");
            setLines((prev) => {
              const next = [...prev, line];
              return next.length > MAX_LINES ? next.slice(next.length - MAX_LINES) : next;
            });
          }
        } catch {}
      };

      es.onerror = () => {
        es?.close();
        es = null;
        setIsLive(false);
        if (!active) return;
        retryTimeout = setTimeout(() => {
          retryDelay = Math.min(retryDelay * 2, 30_000);
          connect();
        }, retryDelay);
      };
    }

    connect();

    return () => {
      active = false;
      setIsLive(false);
      if (retryTimeout) clearTimeout(retryTimeout);
      es?.close();
    };
  }, [taskId]);

  return { lines, isLive, taskId };
}
