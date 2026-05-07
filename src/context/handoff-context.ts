import type { Database } from "bun:sqlite";
import { resolve } from "node:path";
import { SpecStore } from "../spec/store.js";
import { getRegistry, type AgentRoleRegistry } from "../roles/registry.js";
import { estimateTokens, truncateToTokens } from "./token-estimator.js";
import { SLOTS, TOTAL_TOKEN_BUDGET } from "./slots.js";

export interface HandoffContextPayload {
  taskSpec: string;
  diff: string;
  acceptanceCriteria: string;
  blockingComments: string;
  architectureContext: string;
  rolePrompt: string;
  tokenEstimate: number;
  truncatedSlots: string[];
}

interface ChangeSetRow {
  task_id: string;
  worktree_path: string;
  target_branch: string;
}

interface CommentRow {
  body: string;
  file_path: string | null;
  line_number: number | null;
  severity: string;
}

async function getGitDiff(worktreePath: string, targetBranch: string): Promise<string> {
  try {
    const result = await Bun.spawn(
      ["git", "diff", `${targetBranch}...HEAD`],
      { cwd: worktreePath, stdout: "pipe", stderr: "pipe" }
    );
    const text = await new Response(result.stdout).text();
    return text.trim() || "[no diff yet]";
  } catch {
    return "[diff unavailable]";
  }
}

function getBlockingComments(db: Database, changeSetId: string): string {
  const rows = db
    .query<CommentRow, [string]>(
      `SELECT body, file_path, line_number, severity
       FROM review_comments
       WHERE change_set_id = ? AND severity = 'blocking' AND resolved = 0
       ORDER BY created_at ASC`
    )
    .all(changeSetId);

  if (rows.length === 0) return "[no blocking comments]";

  return rows
    .map((r) => {
      const loc = r.file_path
        ? ` (${r.file_path}${r.line_number ? `:${r.line_number}` : ""})`
        : "";
      return `- [blocking${loc}] ${r.body}`;
    })
    .join("\n");
}

export class HandoffContextBuilder {
  private readonly db: Database;
  private readonly specStore: SpecStore;
  private readonly registry: AgentRoleRegistry;
  private readonly repoRoot: string;

  constructor(db: Database, repoRoot?: string, registry?: AgentRoleRegistry) {
    this.db = db;
    this.repoRoot = repoRoot ?? process.cwd();
    this.specStore = new SpecStore(this.repoRoot);
    this.registry = registry ?? getRegistry(this.repoRoot);
  }

  async build(changeSetId: string, role: string): Promise<HandoffContextPayload> {
    const roleConfig = this.registry.getRoleConfig(role);

    const csRow = this.db
      .query<ChangeSetRow, [string]>(
        "SELECT task_id, worktree_path, target_branch FROM change_sets WHERE id = ?"
      )
      .get(changeSetId);

    if (!csRow) throw new Error(`ChangeSet ${changeSetId} not found`);

    const taskId = csRow.task_id;
    const truncatedSlots: string[] = [];

    // --- slot: taskSpec ---
    const rawSpec = this.specStore.read(taskId, "spec") ?? "[no spec found]";
    const specSlot = SLOTS.find((s) => s.name === "taskSpec")!;
    const { text: taskSpec, truncated: specTruncated } = truncateToTokens(
      rawSpec,
      specSlot.maxTokens,
      `.work/tasks/${taskId}/spec.md`
    );
    if (specTruncated) truncatedSlots.push("taskSpec");

    // --- slot: diff ---
    const rawDiff = await getGitDiff(csRow.worktree_path, csRow.target_branch);
    const diffSlot = SLOTS.find((s) => s.name === "diff")!;
    const { text: diff, truncated: diffTruncated } = truncateToTokens(
      rawDiff,
      diffSlot.maxTokens,
      `diff://change-sets/${changeSetId}`
    );
    if (diffTruncated) truncatedSlots.push("diff");

    // --- slot: acceptanceCriteria ---
    const rawAcc = this.specStore.read(taskId, "acceptance") ?? "[no acceptance criteria]";
    const accSlot = SLOTS.find((s) => s.name === "acceptanceCriteria")!;
    const { text: acceptanceCriteria, truncated: accTruncated } = truncateToTokens(
      rawAcc,
      accSlot.maxTokens,
      `.work/tasks/${taskId}/acceptance.md`
    );
    if (accTruncated) truncatedSlots.push("acceptanceCriteria");

    // --- slot: blockingComments ---
    const rawComments = getBlockingComments(this.db, changeSetId);
    const commentsSlot = SLOTS.find((s) => s.name === "blockingComments")!;
    const { text: blockingComments, truncated: commentsTruncated } = truncateToTokens(
      rawComments,
      commentsSlot.maxTokens
    );
    if (commentsTruncated) truncatedSlots.push("blockingComments");

    // --- slot: architectureContext (plan.md excerpt) ---
    const rawPlan = this.specStore.read(taskId, "plan") ?? "[no plan yet]";
    const archSlot = SLOTS.find((s) => s.name === "architectureContext")!;
    const { text: architectureContext, truncated: archTruncated } = truncateToTokens(
      rawPlan,
      archSlot.maxTokens,
      `.work/tasks/${taskId}/plan.md`
    );
    if (archTruncated) truncatedSlots.push("architectureContext");

    // --- role prompt with context injected ---
    const contextString = this.buildString({
      taskSpec, diff, acceptanceCriteria, blockingComments, architectureContext,
      rolePrompt: "", tokenEstimate: 0, truncatedSlots,
    });
    const rolePrompt = roleConfig.promptContent.replace(
      "{{handoff_context}}",
      contextString
    );

    // --- token estimate ---
    const tokenEstimate =
      estimateTokens(taskSpec) +
      estimateTokens(diff) +
      estimateTokens(acceptanceCriteria) +
      estimateTokens(blockingComments) +
      estimateTokens(architectureContext);

    return {
      taskSpec,
      diff,
      acceptanceCriteria,
      blockingComments,
      architectureContext,
      rolePrompt,
      tokenEstimate,
      truncatedSlots,
    };
  }

  buildString(payload: Omit<HandoffContextPayload, "rolePrompt" | "tokenEstimate" | "truncatedSlots">): string {
    return [
      "## Task Spec",
      payload.taskSpec,
      "",
      "## Diff",
      payload.diff,
      "",
      "## Acceptance Criteria",
      payload.acceptanceCriteria,
      "",
      "## Blocking Comments",
      payload.blockingComments,
      "",
      "## Architecture Context",
      payload.architectureContext,
    ].join("\n");
  }
}
