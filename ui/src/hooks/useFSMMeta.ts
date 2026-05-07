import { useQuery } from "@tanstack/react-query";

const API = import.meta.env.VITE_API_URL ?? "";

export interface TransitionDef {
  from: string;
  to: string;
  trigger: string;
}

export interface RoleInfo {
  model: string;
  description: string;
}

export interface FSMMeta {
  transitions: TransitionDef[];
  roles: Record<string, RoleInfo>;
  hitlGatedTriggers: string[];
  circuitBreakerThreshold: number;
}

export function useFSMMeta() {
  return useQuery<FSMMeta>({
    queryKey: ["fsm-meta"],
    queryFn: async () => {
      const r = await fetch(`${API}/api/fsm/meta`);
      if (!r.ok) throw new Error(`GET /api/fsm/meta → ${r.status}`);
      const data = await r.json() as FSMMeta;
      if (!Array.isArray(data?.transitions) || typeof data?.roles !== "object") {
        throw new Error("Malformed FSM meta response");
      }
      return data;
    },
    staleTime: 0,
  });
}
