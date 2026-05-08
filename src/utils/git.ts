import { execFile } from "child_process";
import { promisify } from "util";

const SHA_PATTERN = /^[0-9a-f]{4,40}$/i;
const execFileAsync = promisify(execFile);

function validateSha(sha: string): void {
  if (!SHA_PATTERN.test(sha)) {
    throw new Error(`Invalid git SHA: ${sha}`);
  }
}

export async function getHeadCommit(cwd?: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync("git", ["rev-parse", "HEAD"], {
      cwd: cwd ?? process.cwd(),
    });
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

export async function getFilesChanged(fromSha: string, cwd?: string): Promise<string[]> {
  validateSha(fromSha);
  try {
    const { stdout } = await execFileAsync("git", ["diff", "--name-only", fromSha], {
      cwd: cwd ?? process.cwd(),
    });
    return stdout.trim().split("\n").filter(Boolean);
  } catch {
    return [];
  }
}

export async function getDiffSummary(fromSha: string, cwd?: string): Promise<string> {
  validateSha(fromSha);
  try {
    const { stdout } = await execFileAsync("git", ["diff", "--stat", fromSha], {
      cwd: cwd ?? process.cwd(),
    });
    return stdout.trim();
  } catch {
    return "";
  }
}
