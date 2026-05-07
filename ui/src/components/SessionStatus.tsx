import { Square, Loader2, Wifi, WifiOff, CheckCircle2 } from "lucide-react";
import { useAgentSessions, useStopSession } from "@/hooks/useAgentSessions";
import type { SessionStatus } from "@/types";

function relativeTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const secs = Math.floor(ms / 1000);
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  return `${Math.floor(mins / 60)}h ago`;
}

function StatusBadge({ status }: { status: SessionStatus }) {
  const cfg: Record<SessionStatus, { label: string; cls: string; icon: React.ReactNode }> = {
    waiting:      { label: "waiting",      cls: "bg-status-approved/10 text-status-approved border-status-approved/20",       icon: <Wifi size={10} /> },
    busy:         { label: "busy",         cls: "bg-status-planned/10 text-status-planned border-status-planned/20",           icon: <Loader2 size={10} className="animate-spin" /> },
    done:         { label: "done",         cls: "bg-muted text-muted-foreground border-border",                                icon: <CheckCircle2 size={10} /> },
    disconnected: { label: "disconnected", cls: "bg-destructive/10 text-destructive border-destructive/20",                    icon: <WifiOff size={10} /> },
  };
  const { label, cls, icon } = cfg[status];
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium border ${cls}`}>
      {icon}
      {label}
    </span>
  );
}

export function SessionStatus() {
  const { data: sessions = [], isLoading } = useAgentSessions();
  const stop = useStopSession();

  if (isLoading) return <p className="text-sm text-muted-foreground p-4">Loading sessions…</p>;

  if (sessions.length === 0) {
    return (
      <div className="p-6 text-center text-muted-foreground">
        <p className="text-sm">No agent sessions connected.</p>
        <p className="text-xs mt-1">Pre-spawn an agent and connect it via the MCP server to see it here.</p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-left">
            <th className="py-2.5 px-4 text-xs font-semibold text-muted-foreground">Tool</th>
            <th className="py-2.5 px-4 text-xs font-semibold text-muted-foreground">Roles</th>
            <th className="py-2.5 px-4 text-xs font-semibold text-muted-foreground">Status</th>
            <th className="py-2.5 px-4 text-xs font-semibold text-muted-foreground">Last Heartbeat</th>
            <th className="py-2.5 px-4 text-xs font-semibold text-muted-foreground">Current Task</th>
            <th className="py-2.5 px-4 text-xs font-semibold text-muted-foreground"></th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {sessions.map((s) => {
            const heartbeatAge = Date.now() - new Date(s.last_heartbeat).getTime();
            const heartbeatStale = heartbeatAge > 60_000;
            const canStop = s.status === "busy" || s.status === "waiting";
            return (
              <tr key={s.id} className="hover:bg-accent/40 transition-colors">
                <td className="py-2.5 px-4 font-mono text-xs text-foreground">{s.tool}</td>
                <td className="py-2.5 px-4 text-xs text-muted-foreground">
                  {s.roles.length > 0 ? s.roles.join(", ") : <span className="opacity-50">any</span>}
                </td>
                <td className="py-2.5 px-4"><StatusBadge status={s.status} /></td>
                <td className={`py-2.5 px-4 text-xs ${heartbeatStale ? "text-destructive" : "text-muted-foreground"}`}>
                  {relativeTime(s.last_heartbeat)}
                </td>
                <td className="py-2.5 px-4 font-mono text-xs text-muted-foreground">
                  {s.current_change_set_id ?? <span className="opacity-40">—</span>}
                </td>
                <td className="py-2.5 px-4 text-right">
                  {canStop && (
                    <button
                      onClick={() => stop.mutate(s.id)}
                      disabled={stop.isPending}
                      title="Disconnect session"
                      className="flex items-center gap-1 ml-auto px-2 py-1 rounded text-[11px] text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors border border-transparent hover:border-destructive/20"
                    >
                      <Square size={10} />
                      Stop
                    </button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
