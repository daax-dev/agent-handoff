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

export function useAgentAssignmentsByMode(mode: "changeset" | "gsd") {
  return useQuery<AgentAssignment[]>({
    queryKey: ["agent-assignments", "by-mode", mode],
    queryFn: () =>
      fetch(`${API}/api/agent-assignments/by-mode/${mode}`).then((r) => {
        if (!r.ok) throw new Error(`GET /api/agent-assignments/by-mode/${mode} → ${r.status}`);
        return r.json() as Promise<AgentAssignment[]>;
      }),
    staleTime: 0,
  });
}

export interface UpdateAssignmentParams {
  fsmState: string;
  role: string;
  tool: AgentTool;
  enabled: boolean;
  model?: string | null;
  prompt_override?: string | null;
  mcps?: string[] | null;
  auto_launch?: boolean;
  skills?: string[] | null;
}

export function useUpdateAssignment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (params: UpdateAssignmentParams) => {
      const { fsmState, role, ...body } = params;
      return fetch(`${API}/api/agent-assignments/${fsmState}/${role}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }).then((r) => {
        if (!r.ok) throw new Error(`Failed to update assignment: ${r.status}`);
        return r.json() as Promise<AgentAssignment>;
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["agent-assignments"] });
    },
  });
}

export function useDeleteAssignment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ fsmState, role }: { fsmState: string; role: string }) =>
      fetch(`${API}/api/agent-assignments/${fsmState}/${role}`, { method: "DELETE" }).then((r) => {
        if (!r.ok) throw new Error(`Failed to delete assignment: ${r.status}`);
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["agent-assignments"] });
    },
  });
}

export interface CreateAssignmentParams {
  fsmState: string;
  role: string;
  tool: AgentTool;
}

export function useCreateAssignment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (params: CreateAssignmentParams) =>
      fetch(`${API}/api/agent-assignments/${params.fsmState}/${params.role}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tool: params.tool, enabled: true, auto_launch: false }),
      }).then((r) => {
        if (!r.ok) throw new Error(`Failed to create assignment: ${r.status}`);
        return r.json() as Promise<AgentAssignment>;
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["agent-assignments"] });
    },
  });
}
