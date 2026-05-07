import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { AgentSession } from "@/types";

const API = import.meta.env.VITE_API_URL ?? "";

export function useAgentSessions() {
  return useQuery<AgentSession[]>({
    queryKey: ["agent-sessions"],
    queryFn: () => fetch(`${API}/api/agent-sessions`).then((r) => r.json()),
    refetchInterval: 3_000,
  });
}

export function useStopSession() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (sessionId: string) =>
      fetch(`${API}/api/agent-sessions/${sessionId}`, { method: "DELETE" }).then((r) => {
        if (!r.ok) throw new Error(`Failed to stop session: ${r.status}`);
        return r.json();
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["agent-sessions"] }),
  });
}
