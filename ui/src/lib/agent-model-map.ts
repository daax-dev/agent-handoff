// Agent tool → valid model mapping.
// Canonical source: src/roles/agent-model-map.yaml — keep in sync with that file.

import type { AgentTool } from "@/types";

export type ModelSelectionMode = "supported" | "not_applicable";

export interface ToolModelEntry {
  modelSelection: ModelSelectionMode;
  models: readonly string[];
}

export const AGENT_MODEL_MAP: Record<AgentTool, ToolModelEntry> = {
  "claude-code": {
    modelSelection: "supported",
    // Anthropic models only. Accepts short aliases (sonnet/opus/haiku) or full pinned IDs.
    models: [
      "anthropic:claude-opus-4-7",
      "anthropic:claude-sonnet-4-6",
      "anthropic:claude-haiku-4-5-20251001",
    ],
  },
  "codex": {
    modelSelection: "supported",
    // gpt-5.x series — confirmed from codex model selector (v0.129.0)
    models: [
      "openai:gpt-5.5",
      "openai:gpt-5.4",
      "openai:gpt-5.4-mini",
      "openai:gpt-5.3-codex",
      "openai:gpt-5.2",
    ],
  },
  "gemini": {
    modelSelection: "supported",
    // Default when omitted: auto → gemini-3-pro-preview
    models: [
      "google:gemini-3-pro-preview",
      "google:gemini-3-flash-preview",
      "google:gemini-2.5-pro",
      "google:gemini-2.5-flash",
      "google:gemini-2.5-flash-lite",
    ],
  },
  "cursor":      { modelSelection: "not_applicable", models: [] },
  "copilot-cli": { modelSelection: "not_applicable", models: [] },
  "human":       { modelSelection: "not_applicable", models: [] },
};

export function isModelValidForTool(tool: AgentTool, model: string | null): boolean {
  if (!model) return true;
  const entry = AGENT_MODEL_MAP[tool];
  if (entry.modelSelection === "not_applicable") return false;
  return entry.models.includes(model);
}
