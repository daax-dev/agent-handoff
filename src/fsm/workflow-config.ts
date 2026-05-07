import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { TRANSITIONS, type TransitionDef } from "./states.js";
import { GSD_TRANSITIONS, GSD_HITL_TRIGGERS } from "./gsd-states.js";
import { getHITLConfig } from "./hitl-config.js";

export type WorkflowMode = "changeset" | "gsd";

export interface WorkflowConfig {
  mode: WorkflowMode;
  transitions: TransitionDef[];
  hitlGatedTriggers: string[];
  layout: Record<string, { x: number; y: number }>;
  /** Custom states added via the diagram editor */
  states?: Record<string, { category: string }>;
}

interface SubConfig {
  transitions: TransitionDef[];
  hitlGatedTriggers: string[];
  layout: Record<string, { x: number; y: number }>;
  states?: Record<string, { category: string }>;
}

interface StoredConfig {
  mode: WorkflowMode;
  changeset: SubConfig;
  gsd: SubConfig;
}

const CONFIG_PATH = join(import.meta.dirname, "../../workflow.json");

// ── Type guards ───────────────────────────────────────────────────────────────

function isWorkflowMode(v: unknown): v is WorkflowMode {
  return v === "changeset" || v === "gsd";
}

function isTransitionDef(v: unknown): v is TransitionDef {
  if (typeof v !== "object" || v === null) return false;
  const o = v as Record<string, unknown>;
  return typeof o.from === "string" && typeof o.to === "string" && typeof o.trigger === "string";
}

function isTransitionArray(v: unknown): v is TransitionDef[] {
  return Array.isArray(v) && v.every(isTransitionDef);
}

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === "string");
}

function isLayout(v: unknown): v is Record<string, { x: number; y: number }> {
  if (typeof v !== "object" || v === null) return false;
  return Object.values(v as Record<string, unknown>).every(
    (e) =>
      typeof e === "object" &&
      e !== null &&
      typeof (e as Record<string, unknown>).x === "number" &&
      typeof (e as Record<string, unknown>).y === "number"
  );
}

function isStateMap(v: unknown): v is Record<string, { category: string }> {
  if (typeof v !== "object" || v === null) return false;
  return Object.values(v as Record<string, unknown>).every(
    (e) =>
      typeof e === "object" &&
      e !== null &&
      typeof (e as Record<string, unknown>).category === "string"
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function defaultChangeset(): SubConfig {
  return {
    transitions: TRANSITIONS.filter((t) => t.trigger !== "abandon"),
    hitlGatedTriggers: getHITLConfig().gatedTriggers,
    layout: {},
    states: {},
  };
}

function defaultGsd(): SubConfig {
  return {
    transitions: GSD_TRANSITIONS.filter((t) => t.trigger !== "abandon"),
    hitlGatedTriggers: GSD_HITL_TRIGGERS,
    layout: {},
    states: {},
  };
}

function extractSubConfig(raw: unknown, defaults: SubConfig): SubConfig {
  if (typeof raw !== "object" || raw === null) return defaults;
  const o = raw as Record<string, unknown>;
  return {
    transitions:       isTransitionArray(o.transitions)       ? o.transitions       : defaults.transitions,
    hitlGatedTriggers: isStringArray(o.hitlGatedTriggers)     ? o.hitlGatedTriggers : defaults.hitlGatedTriggers,
    layout:            isLayout(o.layout)                     ? o.layout            : defaults.layout,
    states:            isStateMap(o.states)                   ? o.states            : defaults.states,
  };
}

// ── Read / write ──────────────────────────────────────────────────────────────

function readStored(): StoredConfig {
  if (!existsSync(CONFIG_PATH)) {
    return { mode: "changeset", changeset: defaultChangeset(), gsd: defaultGsd() };
  }
  try {
    const raw: unknown = JSON.parse(readFileSync(CONFIG_PATH, "utf-8"));
    if (typeof raw !== "object" || raw === null) {
      return { mode: "changeset", changeset: defaultChangeset(), gsd: defaultGsd() };
    }
    const o = raw as Record<string, unknown>;

    // Legacy flat format — no mode or sub-tree keys
    if (!isWorkflowMode(o.mode) && o.changeset === undefined && o.gsd === undefined) {
      return {
        mode: "changeset",
        changeset: extractSubConfig(raw, defaultChangeset()),
        gsd: defaultGsd(),
      };
    }

    return {
      mode:      isWorkflowMode(o.mode) ? o.mode : "changeset",
      changeset: extractSubConfig(o.changeset, defaultChangeset()),
      gsd:       extractSubConfig(o.gsd,       defaultGsd()),
    };
  } catch {
    return { mode: "changeset", changeset: defaultChangeset(), gsd: defaultGsd() };
  }
}

export function loadWorkflowConfig(): WorkflowConfig {
  const stored = readStored();
  const active = stored[stored.mode];
  return {
    mode:              stored.mode,
    transitions:       active.transitions,
    hitlGatedTriggers: active.hitlGatedTriggers,
    layout:            active.layout,
    states:            active.states ?? {},
  };
}

export function saveWorkflowConfig(config: WorkflowConfig): void {
  try {
    const stored = readStored();
    // Save the incoming flat fields into the sub-tree that was active when the
    // PUT was issued (stored.mode, not config.mode). This preserves edits made
    // under the old mode before a toggle, and lets the new mode load cleanly.
    const previousMode = stored.mode;
    stored[previousMode] = {
      transitions:       config.transitions,
      hitlGatedTriggers: config.hitlGatedTriggers,
      layout:            config.layout,
      states:            config.states ?? {},
    };
    stored.mode = config.mode;
    mkdirSync(dirname(CONFIG_PATH), { recursive: true });
    writeFileSync(CONFIG_PATH, JSON.stringify(stored, null, 2), "utf-8");
  } catch (e) {
    throw new Error(
      `Failed to save workflow config: ${e instanceof Error ? e.message : String(e)}`
    );
  }
}
