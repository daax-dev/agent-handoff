import { Link } from "react-router-dom";
import { Check, X, GitBranch, ExternalLink } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { useApproveChangeSet, useRejectChangeSet } from "@/hooks/useChangeSets";
import type { ChangeSet, ChangeSetStatus } from "@/types";

type BadgeVariant =
  | "draft" | "planned" | "implementing" | "reviewing"
  | "changes_requested" | "approved" | "conflict" | "merged"
  | "abandoned" | "hitl";

function statusVariant(status: ChangeSetStatus): BadgeVariant {
  const map: Record<string, BadgeVariant> = {
    draft: "draft",
    planned: "planned",
    implementing: "implementing",
    reviewing: "reviewing",
    changes_requested: "changes_requested",
    approved: "approved",
    conflict_detected: "conflict",
    merged: "merged",
    abandoned: "abandoned",
    awaiting_human_approval: "hitl",
  };
  return map[status] ?? "draft";
}

const LEFT_BORDER: Record<string, string> = {
  draft:                   "border-l-status-draft",
  planned:                 "border-l-status-planned",
  implementing:            "border-l-status-implementing",
  reviewing:               "border-l-status-reviewing",
  changes_requested:       "border-l-status-changes_requested",
  approved:                "border-l-status-approved",
  conflict_detected:       "border-l-status-conflict",
  merged:                  "border-l-status-merged",
  abandoned:               "border-l-status-abandoned",
  awaiting_human_approval: "border-l-status-hitl",
};

function relativeTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(ms / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export function ChangeSetCard({ changeSet }: { changeSet: ChangeSet }) {
  const approve = useApproveChangeSet();
  const reject = useRejectChangeSet();
  const isHITL = changeSet.status === "awaiting_human_approval";
  const leftBorder = LEFT_BORDER[changeSet.status] ?? "border-l-border";

  return (
    <div
      className={`rounded-md border bg-card hover:bg-card-hover transition-colors border-l-[3px] ${leftBorder} cursor-default`}
    >
      <div className="px-3 pt-3 pb-2">
        <Link
          to={`/change-sets/${changeSet.id}`}
          className="text-sm font-medium leading-snug text-foreground hover:text-primary transition-colors line-clamp-2 block"
        >
          {changeSet.title}
        </Link>

        {/* ID + branch */}
        <div className="flex items-center gap-1.5 mt-1.5">
          <span className="text-[11px] font-mono text-muted-foreground">{changeSet.id}</span>
          {changeSet.source_branch && (
            <span className="flex items-center gap-0.5 text-[11px] font-mono text-muted-foreground opacity-50 truncate max-w-[90px]">
              <GitBranch size={10} />
              {changeSet.source_branch.replace(/^feat\//, "")}
            </span>
          )}
          {changeSet.github_pr_url && (
            <a
              href={changeSet.github_pr_url}
              target="_blank"
              rel="noopener noreferrer"
              className="ml-auto text-muted-foreground hover:text-foreground"
              title="View GitHub PR"
            >
              <ExternalLink size={11} />
            </a>
          )}
        </div>
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between px-3 pb-2.5">
        <span className="text-[11px] text-muted-foreground">{relativeTime(changeSet.created_at)}</span>
        <Badge variant={statusVariant(changeSet.status)}>
          {changeSet.status.replace(/_/g, " ")}
        </Badge>
      </div>

      {/* HITL approve/reject */}
      {isHITL && (
        <div className="flex gap-2 px-3 pb-3">
          <button
            onClick={() => approve.mutate(changeSet.id)}
            disabled={approve.isPending}
            className="flex-1 flex items-center justify-center gap-1 text-xs py-1.5 rounded-md bg-status-approved/10 text-status-approved hover:bg-status-approved/20 border border-status-approved/20 transition-colors font-medium"
          >
            <Check size={12} />
            Approve
          </button>
          <button
            onClick={() => reject.mutate(changeSet.id)}
            disabled={reject.isPending}
            className="flex-1 flex items-center justify-center gap-1 text-xs py-1.5 rounded-md bg-destructive/10 text-destructive hover:bg-destructive/20 border border-destructive/20 transition-colors font-medium"
          >
            <X size={12} />
            Reject
          </button>
        </div>
      )}
    </div>
  );
}
