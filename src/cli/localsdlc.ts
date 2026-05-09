#!/usr/bin/env bun
import path from "path";
import { Command } from "commander";
import { configure, ApiError } from "./api-client.js";
import { initCmd } from "./commands/init.js";
import { newCmd } from "./commands/new.js";
import { statusCmd } from "./commands/status.js";
import { reviewCmd } from "./commands/review.js";
import { approveCmd } from "./commands/approve.js";
import { mergeCmd } from "./commands/merge.js";
import { exportCmd } from "./commands/export.js";
import { importIssueCmd } from "./commands/import-issue.js";
import { setupCmd } from "./commands/setup.js";

const invokedAs = path.basename(process.argv[1] ?? "agent-handoff").replace(/\.(js|ts)$/, "") || "agent-handoff";

const program = new Command()
  .name(invokedAs)
  .description("AI SDLC inner loop — manage ChangeSets from your terminal")
  .version("0.1.0")
  .option("--url <url>", "agent-handoff server URL (overrides AGENT_HANDOFF_URL env var)")
  .option("--token <token>", "Bearer token for auth (overrides AGENT_HANDOFF_TOKEN env var)")
  .hook("preAction", (thisCommand) => {
    const { url, token } = thisCommand.opts<{ url?: string; token?: string }>();
    configure({ url, token });
  });

program
  .command("init")
  .description("Create .work/ directory structure")
  .action(() => initCmd());

program
  .command("new <title>")
  .description("Create a new Task + ChangeSet and open spec in $EDITOR")
  .option("--task-id <id>", "Attach to existing task ID")
  .action(async (title: string, opts: { taskId?: string }) => {
    await run(() => newCmd(title, opts));
  });

program
  .command("status [changeSetId]")
  .description("List all active ChangeSets, or show detail for one")
  .option("--json", "Output machine-readable JSON")
  .action(async (changeSetId: string | undefined, opts: { json?: boolean }) => {
    await run(() => statusCmd(changeSetId, opts));
  });

program
  .command("list")
  .description("List all active ChangeSets (alias for: status)")
  .option("--json", "Output machine-readable JSON")
  .action(async (opts: { json?: boolean }) => {
    await run(() => statusCmd(undefined, opts));
  });

program
  .command("review [changeSetId]")
  .description("Show review summary (blocking comments + check runs)")
  .option("--json", "Output machine-readable JSON")
  .action(async (changeSetId: string | undefined, opts: { json?: boolean }) => {
    await run(() => reviewCmd(changeSetId, opts));
  });

program
  .command("approve <changeSetId>")
  .description("Approve a ChangeSet (prompts for confirmation)")
  .action(async (changeSetId: string) => {
    await run(() => approveCmd(changeSetId));
  });

program
  .command("merge <changeSetId>")
  .description("Merge an approved ChangeSet into the target branch")
  .action(async (changeSetId: string) => {
    await run(() => mergeCmd(changeSetId));
  });

program
  .command("export <changeSetId>")
  .description("Push branch and create GitHub PR (requires gh CLI + auth)")
  .option("--remote <remote>", "Git remote to push to", "origin")
  .option("--draft", "Create PR as draft")
  .option("--dry-run", "Print what would happen without calling gh")
  .action(async (changeSetId: string, opts: { remote?: string; draft?: boolean; dryRun?: boolean }) => {
    await run(() => exportCmd(changeSetId, opts));
  });

program
  .command("import-issue <url>")
  .description("Import a GitHub issue as a local Task")
  .action(async (url: string) => {
    await run(() => importIssueCmd(url));
  });

program
  .command("setup")
  .description("Install agent skills into .claude/settings.json (run once after changing assignments)")
  .option("--dry-run", "Show what would change without writing files")
  .action(async (opts: { dryRun?: boolean }) => {
    await run(() => setupCmd(opts));
  });

async function run(fn: () => Promise<void> | void) {
  try {
    await fn();
  } catch (e) {
    if (e instanceof ApiError) {
      process.stderr.write(`Error: ${e.message}\n`);
    } else if (e instanceof Error) {
      process.stderr.write(`Error: ${e.message}\n`);
    } else {
      process.stderr.write(`Error: ${String(e)}\n`);
    }
    process.exit(1);
  }
}

program.parse();
