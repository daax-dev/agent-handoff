import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

export function initCmd() {
  const workRoot = resolve(process.cwd(), ".work");
  const dirs = ["worktrees", "tasks", "logs"];
  for (const d of dirs) {
    mkdirSync(resolve(workRoot, d), { recursive: true });
  }
  console.log(`Initialized .work/ in ${process.cwd()}`);
  console.log("  .work/worktrees/  — git worktrees for each ChangeSet");
  console.log("  .work/tasks/      — handoff context + logs per ChangeSet");
  console.log("  .work/logs/       — agent stdout/stderr logs");
  console.log("\nNext: start the API server with `bun run dev:api`, then `localsdlc new \"My feature\"`");
}
