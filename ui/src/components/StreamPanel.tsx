import { useEffect, useRef } from "react";
import { useAgentStream } from "@/hooks/useAgentStream";

interface StreamPanelProps {
  taskId: string;
  className?: string;
}

export function StreamPanel({ taskId, className = "" }: StreamPanelProps) {
  const { lines, isLive } = useAgentStream(taskId);
  const containerRef = useRef<HTMLDivElement>(null);
  const atBottomRef = useRef(true);

  // Track whether user is at the bottom
  function handleScroll() {
    const el = containerRef.current;
    if (!el) return;
    atBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 8;
  }

  // Auto-scroll to bottom when new lines arrive, if already at bottom
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    if (atBottomRef.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [lines]);

  return (
    <div className={`flex flex-col ${className}`}>
      <div className="flex items-center gap-2 px-3 py-1.5 bg-zinc-900 border-b border-zinc-700 text-xs text-zinc-400">
        <span className="font-mono">{taskId}</span>
        <span
          className={`ml-auto h-2 w-2 rounded-full ${
            isLive ? "bg-green-400 animate-pulse" : "bg-zinc-600"
          }`}
          title={isLive ? "Live" : "Disconnected"}
        />
        <span>{isLive ? "live" : "offline"}</span>
      </div>
      <div
        ref={containerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-auto bg-zinc-950 p-3 font-mono text-xs text-zinc-200 min-h-0"
        style={{ minHeight: "160px", maxHeight: "320px" }}
      >
        {lines.length === 0 ? (
          <span className="text-zinc-600">No output yet…</span>
        ) : (
          lines.map((line, i) => (
            // Plain text — never use dangerouslySetInnerHTML
            <div key={i} className="whitespace-pre-wrap break-all leading-5">
              {line}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
