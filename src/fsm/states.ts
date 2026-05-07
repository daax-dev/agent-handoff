import type { ChangeSetStatus } from "../domain/change-set.js";

export type ChangeSetStatusExtended = ChangeSetStatus | "escalated";

export interface TransitionDef {
  from: string;
  to: string;
  trigger: string;
}

const TERMINAL: ChangeSetStatusExtended[] = ["merged", "abandoned", "escalated"];

const NON_TERMINAL: ChangeSetStatusExtended[] = [
  "draft",
  "planned",
  "implementing",
  "reviewing",
  "changes_requested",
  "approved",
  "conflict_detected",
];

export const TRANSITIONS: TransitionDef[] = [
  // Main lifecycle
  { from: "draft",             to: "planned",           trigger: "plan_accepted" },
  { from: "planned",           to: "implementing",      trigger: "assign_implementer" },
  { from: "implementing",      to: "reviewing",         trigger: "submit_for_review" },
  { from: "reviewing",         to: "changes_requested", trigger: "request_changes" },
  { from: "reviewing",         to: "approved",          trigger: "approve" },
  { from: "changes_requested", to: "implementing",      trigger: "pick_up_revision" },
  { from: "approved",          to: "conflict_detected", trigger: "merge_conflict_detected" },
  { from: "approved",          to: "merged",            trigger: "merge" },
  { from: "conflict_detected", to: "implementing",      trigger: "conflict_reopen" },
  { from: "conflict_detected", to: "reviewing",         trigger: "conflict_resolved" },
  // Abandon from any non-terminal state
  ...NON_TERMINAL.map((from) => ({
    from,
    to: "abandoned" as ChangeSetStatusExtended,
    trigger: "abandon",
  })),
];

export function findTransition(
  from: ChangeSetStatusExtended,
  trigger: string
): TransitionDef | undefined {
  return TRANSITIONS.find((t) => t.from === from && t.trigger === trigger);
}

export function isTerminal(status: ChangeSetStatusExtended): boolean {
  return TERMINAL.includes(status);
}
