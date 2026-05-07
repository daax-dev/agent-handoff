// Mirrors Zod-inferred types from backend domain models

export type ChangeSetStatus =
  | "draft"
  | "planned"
  | "implementing"
  | "reviewing"
  | "changes_requested"
  | "approved"
  | "conflict_detected"
  | "merged"
  | "abandoned"
  | "awaiting_human_approval";

export interface ChangeSet {
  id: string;
  task_id: string;
  title: string;
  description: string;
  source_branch: string;
  target_branch: string;
  worktree_path: string;
  status: ChangeSetStatus;
  created_at: string;
  updated_at: string;
  merged_at: string | null;
  github_issue_url: string | null;
  github_pr_url: string | null;
  remote_branch: string | null;
}

export type TaskStatus = "backlog" | "in_progress" | "done" | "blocked";

export interface Task {
  id: string;
  change_set_id: string;
  title: string;
  spec_path: string;
  plan_path: string | null;
  acceptance_path: string;
  assigned_agent: string | null;
  agent_role: string | null;
  status: TaskStatus;
  created_at: string;
}

export interface SSEEvent {
  type: string;
  payload: Record<string, unknown>;
  ts: string;
}

export const KANBAN_COLUMNS: ChangeSetStatus[] = [
  "draft",
  "planned",
  "implementing",
  "reviewing",
  "changes_requested",
  "approved",
  "merged",
  "abandoned",
];

export type CommentSeverity = "blocking" | "major" | "minor" | "info";

export interface ReviewComment {
  id: string;
  change_set_id: string;
  author_agent: string;
  severity: CommentSeverity;
  body: string;
  file_path: string | null;
  line_number: number | null;
  resolved_by: string | null;
  resolved_at: string | null;
  created_at: string;
}

export type CheckRunStatus = "pending" | "running" | "passed" | "failed" | "skipped";
export type CheckRunName = "typecheck" | "lint" | "test" | "security" | "custom";

export interface CheckRun {
  id: string;
  change_set_id: string;
  name: CheckRunName;
  status: CheckRunStatus;
  output: string | null;
  exit_code: number | null;
  started_at: string;
  completed_at: string | null;
}

export interface FSMCheckpoint {
  id: string;
  change_set_id: string;
  from_status: string;
  to_status: string;
  trigger: string;
  ts: string;
  metadata: string | null;
}
