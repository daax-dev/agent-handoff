import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { AgentAssignment } from "@/types";
import { useUpdateAssignment } from "./useAgentAssignments";

const API = import.meta.env.VITE_API_URL ?? "";

export function useStateAssignments(fsmState: string | null) {
  return useQuery<AgentAssignment[]>({
    queryKey: ["agent-assignments", "by-state", fsmState],
    enabled: fsmState !== null,
    queryFn: async () => {
      const all = await fetch(`${API}/api/agent-assignments`).then((r) => {
        if (!r.ok) throw new Error(`GET /api/agent-assignments → ${r.status}`);
        return r.json() as Promise<AgentAssignment[]>;
      });
      return all.filter((a) => a.fsm_state === fsmState);
    },
    staleTime: 0,
  });
}

export function useUpdateStateAssignments(fsmState: string) {
  const qc = useQueryClient();
  const update = useUpdateAssignment();

  return {
    updateOne: (assignment: AgentAssignment) =>
      update.mutateAsync({
        fsmState: assignment.fsm_state,
        role: assignment.role,
        tool: assignment.tool,
        enabled: assignment.enabled,
        model: assignment.model,
        prompt_override: assignment.prompt_override,
        mcps: assignment.mcps,
        auto_launch: assignment.auto_launch,
        skills: assignment.skills,
      }),
    saveAll: async (assignments: AgentAssignment[]) => {
      await Promise.all(
        assignments.map((a) =>
          update.mutateAsync({
            fsmState: a.fsm_state,
            role: a.role,
            tool: a.tool,
            enabled: a.enabled,
            model: a.model,
            prompt_override: a.prompt_override,
            mcps: a.mcps,
            auto_launch: a.auto_launch,
            skills: a.skills,
          })
        )
      );
      qc.invalidateQueries({ queryKey: ["agent-assignments", "by-state", fsmState] });
    },
    isPending: update.isPending,
  };
}
