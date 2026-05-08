import { useQuery } from "@tanstack/react-query";

const API = import.meta.env.VITE_API_URL ?? "";

export interface McpServer {
  name: string;
  source: "claude-global" | "claude-local" | "mcp-global" | "cursor" | "codex";
}

export function useMcpServers() {
  return useQuery<McpServer[]>({
    queryKey: ["mcp-servers"],
    queryFn: () =>
      fetch(`${API}/api/mcp-servers`)
        .then((r) => r.json() as Promise<{ servers: McpServer[] }>)
        .then((d) => d.servers),
    staleTime: 30_000,
  });
}
