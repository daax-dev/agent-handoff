import { spawnSync } from "node:child_process";
import { api } from "../api-client.js";

interface ChangeSet {
  id: string;
  task_id: string;
  title: string;
  status: string;
  source_branch: string;
  target_branch: string;
}

function ghRun(args: string[], cwd?: string): { stdout: string; stderr: string; ok: boolean } {
  const res = spawnSync("gh", args, { encoding: "utf-8", cwd });
  return {
    stdout: res.stdout ?? "",
    stderr: res.stderr ?? "",
    ok: res.status === 0,
  };
}

function requireGh() {
  const check = spawnSync("gh", ["--version"], { encoding: "utf-8" });
  if (check.status !== 0) throw new Error("gh CLI not found on PATH. Install GitHub CLI and run `gh auth login`.");
  const auth = spawnSync("gh", ["auth", "status"], { encoding: "utf-8" });
  if (auth.status !== 0) throw new Error("gh auth status failed. Run: gh auth login");
}

export async function exportCmd(changeSetId: string, opts: { remote?: string; draft?: boolean; dryRun?: boolean }) {
  const remote = opts.remote ?? "origin";

  const cs = await api.get<ChangeSet>(`/api/change-sets/${changeSetId}`);

  if (cs.status !== "approved") {
    throw new Error(`ChangeSet must be approved before export (current status: ${cs.status})`);
  }

  const body = await api.getRaw(`/api/change-sets/${changeSetId}/pr-body`);

  if (opts.dryRun) {
    console.log(`Would push: ${cs.source_branch} → ${remote}`);
    console.log(`\nWould create PR with body:\n${body}`);
    return;
  }

  requireGh();

  // Push branch
  const pushResult = ghRun(["push", remote, cs.source_branch], undefined);
  if (!pushResult.ok) {
    // gh push is actually git push — use git
    const gitPush = spawnSync("git", ["push", remote, cs.source_branch], { encoding: "utf-8" });
    if (gitPush.status !== 0) {
      process.stderr.write(`git push failed:\n${gitPush.stderr}\n`);
      process.exit(1);
    }
  }

  const prArgs = [
    "pr", "create",
    "--title", cs.title,
    "--body", body,
    "--head", cs.source_branch,
    "--base", cs.target_branch,
  ];
  if (opts.draft) prArgs.push("--draft");

  const prResult = ghRun(prArgs);
  if (!prResult.ok) {
    process.stderr.write(`gh pr create failed:\n${prResult.stderr}\n`);
    process.exit(1);
  }

  const prUrl = prResult.stdout.trim();
  await api.patch(`/api/change-sets/${changeSetId}/github-pr-url`, { url: prUrl });

  console.log(`Created PR: ${prUrl}`);
}
