import { useQuery } from "@tanstack/react-query";
import type { AgentTool } from "@/types";

const API = import.meta.env.VITE_API_URL ?? "";

export interface Skill {
  name: string;
  description: string;
}

export function useSkills(tool: AgentTool) {
  return useQuery<Skill[]>({
    queryKey: ["skills", tool],
    queryFn: () =>
      fetch(`${API}/api/skills?tool=${tool}`)
        .then((r) => r.json() as Promise<{ skills: Skill[] }>)
        .then((d) => d.skills),
    staleTime: Infinity,
  });
}
