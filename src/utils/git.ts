import { $ } from "bun";

const SHA_PATTERN = /^[0-9a-f]{4,40}$/i;

function validateSha(sha: string): void {
  if (!SHA_PATTERN.test(sha)) {
    throw new Error(`Invalid git SHA: ${sha}`);
  }
}

export async function getHeadCommit(cwd?: string): Promise<string | null> {
  try {
    const result = await $`git rev-parse HEAD`.cwd(cwd ?? process.cwd()).text();
    return result.trim() || null;
  } catch {
    return null;
  }
}

export async function getFilesChanged(fromSha: string, cwd?: string): Promise<string[]> {
  validateSha(fromSha);
  try {
    const result = await $`git diff --name-only ${fromSha}`.cwd(cwd ?? process.cwd()).text();
    return result.trim().split("\n").filter(Boolean);
  } catch {
    return [];
  }
}

export async function getDiffSummary(fromSha: string, cwd?: string): Promise<string> {
  validateSha(fromSha);
  try {
    const result = await $`git diff --stat ${fromSha}`.cwd(cwd ?? process.cwd()).text();
    return result.trim();
  } catch {
    return "";
  }
}
