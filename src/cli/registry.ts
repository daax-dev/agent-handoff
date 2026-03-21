import type { AgentName, CliAgentInfo } from "../types.js";
import { BaseAdapter } from "./base-adapter.js";
import { ClaudeAdapter } from "./claude.js";
import { CodexAdapter } from "./codex.js";
import { GeminiAdapter } from "./gemini.js";
import { CopilotAdapter } from "./copilot.js";
import { OpenCodeAdapter } from "./opencode.js";
import { AiderAdapter } from "./aider.js";

const adapters: Record<AgentName, BaseAdapter> = {
  claude: new ClaudeAdapter(),
  codex: new CodexAdapter(),
  gemini: new GeminiAdapter(),
  copilot: new CopilotAdapter(),
  opencode: new OpenCodeAdapter(),
  aider: new AiderAdapter(),
};

export function getAdapter(name: AgentName): BaseAdapter {
  const adapter = adapters[name];
  if (!adapter) {
    throw new Error(`Unknown agent: ${name}`);
  }
  return adapter;
}

export function isAgentAvailable(name: AgentName): boolean {
  const adapter = adapters[name];
  return Bun.which(adapter.command) !== null;
}

export function listCliAgents(): CliAgentInfo[] {
  return Object.values(adapters).map((adapter) => ({
    name: adapter.name,
    available: Bun.which(adapter.command) !== null,
    command: adapter.command,
  }));
}
