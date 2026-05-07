import { Square, Loader, Wifi, WifiOff } from "lucide-react";
import { useAgentSessions, useStopSession } from "@/hooks/useAgentSessions";
import type { AgentSession } from "@/types";

const TOOL_SHORT: Record<string, string> = {
  "claude-code": "Claude",
  "codex":       "Codex",
  "cursor":      "Cursor",
  "copilot-cli": "Copilot",
  "gemini":      "Gemini",
  "aider":       "Aider",
  "human":       "Human",
};

function relativeTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const secs = Math.floor(ms / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  return `${mins}m`;
}

function SessionPill({ session, onStop }: { session: AgentSession; onStop: (id: string) => void }) {
  const isBusy = session.status === "busy";
  const isWaiting = session.status === "waiting";
  const isDisconnected = session.status === "disconnected";
  const isStale = Date.now() - new Date(session.last_heartbeat).getTime() > 60_000;

  return (
    <div
      className={`flex items-center gap-2 px-2.5 py-1 rounded-md border text-[11px] transition-colors ${
        isBusy
          ? "bg-status-implementing/10 border-status-implementing/20 text-foreground"
          : isDisconnected || isStale
          ? "bg-destructive/10 border-destructive/20 text-muted-foreground"
          : "bg-muted/50 border-border text-muted-foreground"
      }`}
    >
      {/* Status dot */}
      {isBusy ? (
        <Loader size={11} className="animate-spin text-status-implementing shrink-0" />
      ) : isDisconnected ? (
        <WifiOff size={11} className="text-destructive shrink-0" />
      ) : (
        <Wifi size={11} className="text-muted-foreground/50 shrink-0" />
      )}

      {/* Tool */}
      <span className="font-medium">{TOOL_SHORT[session.tool] ?? session.tool}</span>

      {/* Role(s) */}
      {session.roles.length > 0 && (
        <span className="text-muted-foreground opacity-70">{session.roles[0]}</span>
      )}

      {/* Current task */}
      {session.current_change_set_id && (
        <span className="font-mono opacity-60">{session.current_change_set_id}</span>
      )}

      {/* Heartbeat age */}
      <span className={`opacity-50 ml-auto ${isStale ? "text-destructive opacity-100" : ""}`}>
        {relativeTime(session.last_heartbeat)}
      </span>

      {/* Stop button — only for active sessions */}
      {(isBusy || isWaiting) && (
        <button
          onClick={() => onStop(session.id)}
          title="Disconnect session"
          className="ml-0.5 p-0.5 rounded hover:bg-destructive/20 hover:text-destructive transition-colors text-muted-foreground"
        >
          <Square size={10} />
        </button>
      )}
    </div>
  );
}

export function AgentActivityBar() {
  const { data: sessions = [] } = useAgentSessions();
  const stop = useStopSession();

  const active = sessions.filter((s) => s.status !== "done");

  if (active.length === 0) return null;

  const busyCount = active.filter((s) => s.status === "busy").length;

  return (
    <div className="border-b bg-card px-4 py-1.5 flex items-center gap-2 overflow-x-auto">
      <span className="text-[11px] font-medium text-muted-foreground shrink-0 mr-1">
        Agents
        {busyCount > 0 && (
          <span className="ml-1.5 inline-flex items-center justify-center w-4 h-4 rounded-full bg-status-implementing/20 text-status-implementing text-[10px] font-bold">
            {busyCount}
          </span>
        )}
      </span>
      {active.map((s) => (
        <SessionPill key={s.id} session={s} onStop={(id) => stop.mutate(id)} />
      ))}
    </div>
  );
}
