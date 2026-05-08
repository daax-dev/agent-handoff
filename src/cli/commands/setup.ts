import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { api, ApiError } from "../api-client.js";

interface AgentAssignment {
  fsm_state: string;
  role: string;
  tool: string;
  skills: string[] | null;
}

interface ClaudeSettings {
  skills?: string[];
  [key: string]: unknown;
}

export async function setupCmd(opts: { dryRun?: boolean }) {
  const dryRun = opts.dryRun ?? false;

  let assignments: AgentAssignment[];
  try {
    assignments = await api.get<AgentAssignment[]>("/api/agent-assignments");
  } catch (e) {
    if (e instanceof ApiError && e.status === 0) {
      throw new Error("Server not running. Start it with: bun run dev:api");
    }
    throw e;
  }

  // Collect claude-code skills across all assignments
  const claudeSkills = new Set<string>();
  for (const a of assignments) {
    if (a.tool === "claude-code" && Array.isArray(a.skills)) {
      for (const s of a.skills) claudeSkills.add(s);
    }
  }

  // Check if there are any explicit skills at all
  const anyExplicit = assignments.some((a) => a.skills !== null);
  if (!anyExplicit) {
    console.log("No skills configured — nothing to write.");
    return;
  }

  const settingsPath = join(process.cwd(), ".claude", "settings.json");

  // Claude Code line
  if (claudeSkills.size > 0) {
    const skillList = [...claudeSkills].sort();
    if (dryRun) {
      console.log(`[dry-run] claude-code  →  .claude/settings.json  [${skillList.join(", ")}]`);
    } else {
      let current: ClaudeSettings = {};
      if (existsSync(settingsPath)) {
        const raw = readFileSync(settingsPath, "utf8");
        try {
          current = JSON.parse(raw) as ClaudeSettings;
        } catch {
          throw new Error(
            `.claude/settings.json contains invalid JSON — fix it before running setup`
          );
        }
      }
      const merged = { ...current, skills: skillList };
      mkdirSync(dirname(settingsPath), { recursive: true });
      writeFileSync(settingsPath, JSON.stringify(merged, null, 2) + "\n");
      console.log(`✓  claude-code  →  .claude/settings.json  [${skillList.join(", ")}]`);
    }
  } else {
    console.log("-  claude-code  →  .claude/settings.json  (no skills assigned)");
  }

  // Other tools — skills not supported
  const otherTools = new Set(assignments.map((a) => a.tool).filter((t) => t !== "claude-code"));
  for (const tool of [...otherTools].sort()) {
    console.log(`-  ${tool}  →  (skills not supported)`);
  }
}
