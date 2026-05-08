import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { AgentTool } from "../domain/agent-assignment.js";

export interface SpawnContext {
  changeSetId: string;
  role: string;
  handoffContent: string;
  workRoot: string;
}

export interface SpawnResult {
  pid: number;
  handoffPath: string;
}

function handoffPath(workRoot: string, changeSetId: string): string {
  return resolve(workRoot, "tasks", changeSetId, "handoff.md");
}

function writeHandoff(path: string, content: string): void {
  mkdirSync(resolve(path, ".."), { recursive: true });
  writeFileSync(path, content, "utf-8");
}

const TOOL_COMMANDS: Record<Exclude<AgentTool, "human">, (prompt: string, handoffPath: string) => string[]> = {
  "claude-code":  (p) => ["claude", "--dangerously-skip-permissions", "-p", p],
  "codex":        (p) => ["codex", p],
  "cursor":       (_p, h) => ["cursor", h],   // opens handoff.md directly in Cursor IDE
  "copilot-cli":  (p) => ["gh", "copilot", "suggest", p],
  "gemini":       (p) => ["gemini", "--prompt", p],
};

export function spawnAgent(tool: AgentTool, ctx: SpawnContext): SpawnResult {
  if (tool === "human") {
    throw new Error("Cannot spawn a human agent — use HITL gate instead");
  }

  const hPath = handoffPath(ctx.workRoot, ctx.changeSetId);
  writeHandoff(hPath, ctx.handoffContent);

  const prompt = [
    `You are working on ChangeSet ${ctx.changeSetId} as ${ctx.role}.`,
    `Read the full handoff context at: ${hPath}`,
    "Use the MCP tools available to complete your assigned role.",
  ].join(" ");

  const cmdFn = TOOL_COMMANDS[tool];
  if (!cmdFn) throw new Error(`No spawn command configured for tool: ${tool}`);

  const [bin, ...args] = cmdFn(prompt, hPath);
  const proc = Bun.spawn([bin, ...args], {
    cwd: ctx.workRoot,
    stdout: "pipe",
    stderr: "pipe",
    env: {
      ...process.env,
      LOCALSDLC_CHANGE_SET_ID: ctx.changeSetId,
      LOCALSDLC_ROLE: ctx.role,
      LOCALSDLC_HANDOFF_PATH: hPath,
    },
  });

  return { pid: proc.pid, handoffPath: hPath };
}

export function isToolSpawnable(tool: AgentTool): boolean {
  return tool !== "human" && tool in TOOL_COMMANDS;
}
