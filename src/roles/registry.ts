import { readFileSync, existsSync } from "node:fs";
import { resolve, join, dirname } from "node:path";
import yaml from "js-yaml";

export class UnknownRoleError extends Error {
  constructor(role: string) {
    super(`Unknown agent role: "${role}"`);
    this.name = "UnknownRoleError";
  }
}

export interface RoleConfig {
  model: string;
  description: string;
  promptPath: string;
  promptContent: string;
  maxContextTokens?: number;
}

interface RawRoleEntry {
  model: string;
  description: string;
  prompt_template: string;
  max_context_tokens?: number;
}

interface RawConfig {
  roles: Record<string, RawRoleEntry>;
}

export class AgentRoleRegistry {
  private readonly roles: Map<string, RoleConfig>;
  private readonly repoRoot: string;

  constructor(repoRoot?: string) {
    this.repoRoot = repoRoot ?? process.cwd();
    this.roles = new Map();
    this.load();
  }

  private load(): void {
    const yamlPath = resolve(this.repoRoot, "src", "roles", "agent-roles.yaml");
    const raw = readFileSync(yamlPath, "utf-8");
    const config = yaml.load(raw) as RawConfig;

    for (const [role, entry] of Object.entries(config.roles)) {
      const promptPath = resolve(this.repoRoot, "src", entry.prompt_template);

      if (!existsSync(promptPath)) {
        throw new Error(
          `Prompt template for role "${role}" not found at: ${promptPath}`
        );
      }

      const promptContent = readFileSync(promptPath, "utf-8");

      this.roles.set(role, {
        model: this.resolveModel(role, entry.model),
        description: entry.description,
        promptPath,
        promptContent,
        maxContextTokens: entry.max_context_tokens,
      });
    }
  }

  private resolveModel(role: string, defaultModel: string): string {
    const envKey = `LOCALSDLC_MODEL_${role.toUpperCase()}`;
    return process.env[envKey] ?? defaultModel;
  }

  getRoleConfig(role: string): RoleConfig {
    const config = this.roles.get(role);
    if (!config) throw new UnknownRoleError(role);
    return config;
  }

  listRoles(): string[] {
    return Array.from(this.roles.keys());
  }
}

// Singleton — loaded once at startup
let _registry: AgentRoleRegistry | null = null;

export function getRegistry(repoRoot?: string): AgentRoleRegistry {
  if (!_registry) {
    _registry = new AgentRoleRegistry(repoRoot);
  }
  return _registry;
}

export function resetRegistry(): void {
  _registry = null;
}
