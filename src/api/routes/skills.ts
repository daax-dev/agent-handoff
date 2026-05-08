import { json } from "../response.js";

interface Skill {
  name: string;
  description: string;
}

const CLAUDE_CODE_SKILLS: Skill[] = [
  { name: "init",                     description: "Initialize CLAUDE.md for a codebase" },
  { name: "review",                   description: "Review a pull request" },
  { name: "security-review",          description: "Security review of branch changes" },
  { name: "simplify",                 description: "Review changed code for quality and reuse" },
  { name: "schedule",                 description: "Create/manage scheduled remote agents" },
  { name: "claude-api",               description: "Build/debug Claude API / Anthropic SDK apps" },
  { name: "update-config",            description: "Configure Claude Code harness via settings.json" },
  { name: "keybindings-help",         description: "Customize keyboard shortcuts" },
  { name: "loop",                     description: "Run a prompt/command on a recurring interval" },
  { name: "fewer-permission-prompts", description: "Add allowlist to reduce permission prompts" },
];

export function skillsRoute(path: string, req: Request): Response | null {
  if (req.method !== "GET" || path !== "/api/skills") return null;
  const url = new URL(req.url);
  const tool = url.searchParams.get("tool") ?? "";
  const skills = tool === "claude-code" ? CLAUDE_CODE_SKILLS : [];
  return json({ skills });
}
