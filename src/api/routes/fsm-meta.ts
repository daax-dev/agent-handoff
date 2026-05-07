import { readFileSync } from "node:fs";
import { join } from "node:path";
import yaml from "js-yaml";
import { TRANSITIONS } from "../../fsm/states.js";
import { json } from "../response.js";

interface RoleEntry {
  model: string;
  description: string;
}

interface RolesYaml {
  roles: Record<string, RoleEntry>;
}

function loadRoles(): Record<string, RoleEntry> {
  try {
    const rolesPath = join(import.meta.dirname, "../../roles/agent-roles.yaml");
    const raw = readFileSync(rolesPath, "utf-8");
    const parsed = yaml.load(raw) as RolesYaml;
    return parsed?.roles ?? {};
  } catch {
    return {};
  }
}

export interface FSMMeta {
  transitions: typeof TRANSITIONS;
  roles: Record<string, { model: string; description: string }>;
  hitlGatedTriggers: string[];
  circuitBreakerThreshold: number;
}

export function fsmMetaRoute(path: string, req: Request): Response | null {
  if (req.method === "GET" && path === "/api/fsm/meta") {
    const roles = loadRoles();
    const meta: FSMMeta = {
      transitions: TRANSITIONS,
      roles,
      hitlGatedTriggers: ["approve", "merge"],
      circuitBreakerThreshold: 3,
    };
    return json(meta);
  }
  return null;
}
