import { spawnSync } from "node:child_process";
import { api } from "../api-client.js";

interface GhIssue {
  title: string;
  body: string;
  number: number;
  labels: Array<{ name: string }>;
}

interface ChangeSet {
  id: string;
  task_id: string;
}

function parseGitHubIssueUrl(url: string): { owner: string; repo: string; number: number } {
  const m = url.match(/github\.com\/([^/]+)\/([^/]+)\/issues\/(\d+)/);
  if (!m) throw new Error(`Invalid GitHub issue URL: ${url}`);
  return { owner: m[1], repo: m[2], number: parseInt(m[3], 10) };
}

export async function importIssueCmd(url: string) {
  const { owner, repo, number } = parseGitHubIssueUrl(url);

  const res = spawnSync(
    "gh",
    ["issue", "view", String(number), "--repo", `${owner}/${repo}`, "--json", "title,body,labels,number"],
    { encoding: "utf-8" }
  );

  if (res.status !== 0) {
    process.stderr.write(`gh issue view failed:\n${res.stderr}\n`);
    process.exit(1);
  }

  const issue = JSON.parse(res.stdout) as GhIssue;

  const cs = await api.post<ChangeSet>("/api/change-sets", {
    title: issue.title,
    description: `Imported from GitHub issue ${url}`,
    githubIssueUrl: url,
    specContent: issue.body,
  });

  console.log(`Created ${cs.task_id} from ${url}`);
}
