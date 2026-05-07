import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { AgentAssignment, AgentTool } from "@/types";

const API = import.meta.env.VITE_API_URL ?? "";

export function useAgentAssignments() {
  return useQuery<AgentAssignment[]>({
    queryKey: ["agent-assignments"],
    queryFn: () => fetch(`${API}/api/agent-assignments`).then((r) => r.json()),
    refetchInterval: 10_000,
  });
}

export function useUpdateAssignment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ fsmState, role, tool, enabled }: { fsmState: string; role: string; tool: AgentTool; enabled: boolean }) =>
      fetch(`${API}/api/agent-assignments/${fsmState}/${role}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tool, enabled }),
      }).then((r) => {
        if (!r.ok) throw new Error(`Failed to update assignment: ${r.status}`);
        return r.json() as Promise<AgentAssignment>;
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["agent-assignments"] }),
  });
}
