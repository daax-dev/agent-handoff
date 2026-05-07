import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { TRANSITIONS, type TransitionDef } from "./states.js";
import { getHITLConfig } from "./hitl-config.js";

export interface WorkflowConfig {
  transitions: TransitionDef[];
  hitlGatedTriggers: string[];
  layout: Record<string, { x: number; y: number }>;
  /** Custom states added via the diagram editor (not in the hardcoded FSM) */
  states?: Record<string, { category: string }>;
}

// Stored in the project root (next to package.json)
const CONFIG_PATH = join(import.meta.dirname, "../../workflow.json");

function defaultConfig(): WorkflowConfig {
  return {
    transitions: TRANSITIONS.filter((t) => t.trigger !== "abandon"),
    hitlGatedTriggers: getHITLConfig().gatedTriggers,
    layout: {},
  };
}

export function loadWorkflowConfig(): WorkflowConfig {
  try {
    if (!existsSync(CONFIG_PATH)) return defaultConfig();
    const raw = readFileSync(CONFIG_PATH, "utf-8");
    const parsed = JSON.parse(raw) as Partial<WorkflowConfig>;
    return {
      transitions: parsed.transitions ?? defaultConfig().transitions,
      hitlGatedTriggers: parsed.hitlGatedTriggers ?? defaultConfig().hitlGatedTriggers,
      layout: parsed.layout ?? {},
      states: parsed.states ?? {},
    };
  } catch {
    return defaultConfig();
  }
}

export function saveWorkflowConfig(config: WorkflowConfig): void {
  try {
    mkdirSync(dirname(CONFIG_PATH), { recursive: true });
    writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), "utf-8");
  } catch (e) {
    throw new Error(
      `Failed to save workflow config: ${e instanceof Error ? e.message : String(e)}`
    );
  }
}
