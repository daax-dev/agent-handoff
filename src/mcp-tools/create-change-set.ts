import type { Database } from "bun:sqlite";
import { createChangeSet } from "../domain/change-set.js";
import { WorktreeManager } from "../worktree/manager.js";
import { FSMEngine } from "../fsm/engine.js";

interface Input {
  taskId: string;
  title: string;
  description?: string;
  targetBranch?: string;
}

function mcpText(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
}

function mcpError(data: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
    isError: true,
  };
}

export async function handleCreateChangeSet(
  args: Input,
  db: Database,
  repoRoot?: string
) {
  const wm = new WorktreeManager(repoRoot);
  const fsm = new FSMEngine(db);
  const targetBranch = args.targetBranch ?? "main";

  try {
    // Create worktree first to derive path
    const worktreeResult = await wm.create(args.taskId, targetBranch);

    const cs = createChangeSet(db, {
      task_id: args.taskId,
      title: args.title,
      description: args.description ?? "",
      source_branch: wm.branchName(args.taskId),
      target_branch: targetBranch,
      worktree_path: worktreeResult.path,
    });

    // Transition draft → planned
    fsm.transition(cs.id, "plan_accepted");

    return mcpText({
      changeSetId: cs.id,
      worktreePath: worktreeResult.path,
      branch: worktreeResult.branch,
      status: "planned",
    });
  } catch (e) {
    return mcpError({ error: e instanceof Error ? e.message : String(e) });
  }
}
