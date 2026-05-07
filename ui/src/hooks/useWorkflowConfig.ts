import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

const API = import.meta.env.VITE_API_URL ?? "";

export interface TransitionDef {
  from: string;
  to: string;
  trigger: string;
}

export interface WorkflowConfig {
  transitions: TransitionDef[];
  hitlGatedTriggers: string[];
  layout: Record<string, { x: number; y: number }>;
  /** Custom states added via the diagram editor */
  states?: Record<string, { category: StateCategory }>;
}

export type StateCategory = "active" | "success" | "fail" | "escalated";

export function useWorkflowConfig() {
  return useQuery<WorkflowConfig>({
    queryKey: ["workflow-config"],
    queryFn: async () => {
      const r = await fetch(`${API}/api/fsm/workflow`);
      if (!r.ok) throw new Error(`GET /api/fsm/workflow → ${r.status}`);
      return r.json() as Promise<WorkflowConfig>;
    },
    staleTime: 0,
  });
}

export function useSaveWorkflowConfig() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (config: WorkflowConfig) => {
      const r = await fetch(`${API}/api/fsm/workflow`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(config),
      });
      if (!r.ok) throw new Error(`PUT /api/fsm/workflow → ${r.status}`);
      return r.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["workflow-config"] });
      qc.invalidateQueries({ queryKey: ["fsm-meta"] });
    },
  });
}
