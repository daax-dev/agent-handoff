import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useChangeSets } from "@/hooks/useChangeSets";
import { useSSE } from "@/hooks/useSSE";
import { ChangeSetCard } from "@/components/ChangeSetCard";
import type { ChangeSetStatus, SSEEvent } from "@/types";

const ALL_COLUMNS: ChangeSetStatus[] = [
  "draft",
  "planned",
  "implementing",
  "reviewing",
  "changes_requested",
  "approved",
  "merged",
  "abandoned",
];

const COLUMN_LABELS: Record<ChangeSetStatus, string> = {
  draft: "Draft",
  planned: "Planned",
  implementing: "Implementing",
  reviewing: "Reviewing",
  changes_requested: "Changes Requested",
  approved: "Approved",
  conflict_detected: "Conflict",
  merged: "Merged",
  abandoned: "Abandoned",
  awaiting_human_approval: "Awaiting Approval",
};

export function KanbanBoard() {
  const qc = useQueryClient();
  const { data: changeSets = [], isLoading, isError } = useChangeSets();
  const [showAll, setShowAll] = useState(false);

  useSSE((event: SSEEvent) => {
    if (
      event.type === "change_set_created" ||
      event.type === "change_set_updated"
    ) {
      qc.invalidateQueries({ queryKey: ["change-sets"] });
    }
  });

  const byStatus = ALL_COLUMNS.reduce<Record<ChangeSetStatus, typeof changeSets>>(
    (acc, status) => {
      acc[status] = changeSets.filter((cs) => cs.status === status);
      return acc;
    },
    {} as Record<ChangeSetStatus, typeof changeSets>
  );

  const visibleColumns = showAll
    ? ALL_COLUMNS
    : ALL_COLUMNS.filter((s) => byStatus[s].length > 0);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64 text-muted-foreground">
        Loading…
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex items-center justify-center h-64 text-destructive">
        Failed to load change sets. Is the API server running on port 4000?
      </div>
    );
  }

  return (
    <div className="p-4">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-lg font-semibold">ChangeSets</h1>
        <button
          className="text-xs text-muted-foreground underline"
          onClick={() => setShowAll((v) => !v)}
        >
          {showAll ? "Hide empty columns" : "Show all columns"}
        </button>
      </div>

      {visibleColumns.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-64 text-muted-foreground gap-2">
          <p className="text-sm">No ChangeSets yet.</p>
          <p className="text-xs">
            Create one via <code className="font-mono">POST /api/change-sets</code>
          </p>
        </div>
      ) : (
        <div className="flex gap-3 overflow-x-auto pb-4">
          {visibleColumns.map((status) => (
            <div key={status} className="flex-shrink-0 w-64">
              <div className="flex items-center gap-2 mb-2">
                <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {COLUMN_LABELS[status] ?? status}
                </h2>
                <span className="text-xs text-muted-foreground bg-muted rounded-full px-1.5 py-0.5">
                  {byStatus[status].length}
                </span>
              </div>
              <div className="min-h-[100px]">
                {byStatus[status].map((cs) => (
                  <ChangeSetCard key={cs.id} changeSet={cs} />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
