import { homedir } from "os";
import { join } from "path";
import { existsSync, readFileSync } from "fs";
import { json } from "../response.js";

export type McpSource = "claude-global" | "claude-local" | "mcp-global" | "cursor" | "codex";

interface McpServer {
  name: string;
  source: McpSource;
}

function readMcpServersJson(filePath: string): string[] {
  try {
    const raw = readFileSync(filePath, "utf8");
    const parsed = JSON.parse(raw) as { mcpServers?: Record<string, unknown> };
    if (parsed.mcpServers && typeof parsed.mcpServers === "object") {
      return Object.keys(parsed.mcpServers);
    }
  } catch {}
  return [];
}

function readCodexToml(): string[] {
  const filePath = join(homedir(), ".codex", "config.toml");
  try {
    if (!existsSync(filePath)) return [];
    const raw = readFileSync(filePath, "utf8");
    const parsed = Bun.TOML.parse(raw) as { mcp_servers?: Record<string, unknown> };
    if (parsed.mcp_servers && typeof parsed.mcp_servers === "object") {
      return Object.keys(parsed.mcp_servers);
    }
  } catch {}
  return [];
}

export function mcpServersRoute(path: string, req: Request): Response | null {
  if (req.method !== "GET" || path !== "/api/mcp-servers") return null;

  const servers: McpServer[] = [];
  const seen = new Set<string>();

  function add(names: string[], source: McpSource) {
    for (const name of names) {
      if (!seen.has(name)) {
        seen.add(name);
        servers.push({ name, source });
      }
    }
  }

  const home = homedir();
  // Precedence: claude-global > mcp-global > claude-local > cursor > codex
  add(readMcpServersJson(join(home, ".claude", "settings.json")), "claude-global");
  add(readMcpServersJson(join(home, ".mcp.json")), "mcp-global");
  add(readMcpServersJson(join(process.cwd(), ".claude", "settings.json")), "claude-local");
  add(readMcpServersJson(join(home, ".cursor", "mcp.json")), "cursor");
  add(readCodexToml(), "codex");

  return json({ servers });
}
