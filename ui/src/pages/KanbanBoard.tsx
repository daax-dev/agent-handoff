import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { SlidersHorizontal } from "lucide-react";
import { useChangeSets } from "@/hooks/useChangeSets";
import { useSSE } from "@/hooks/useSSE";
import { ChangeSetCard } from "@/components/ChangeSetCard";
import { AgentActivityBar } from "@/components/AgentActivityBar";
import type { ChangeSetStatus, SSEEvent } from "@/types";

const ALL_COLUMNS: ChangeSetStatus[] = [
  "draft",
  "planned",
  "implementing",
  "reviewing",
  "changes_requested",
  "approved",
  "conflict_detected",
  "awaiting_human_approval",
  "merged",
  "abandoned",
];

const COLUMN_LABELS: Record<string, string> = {
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

const COLUMN_BORDER: Record<string, string> = {
  draft:                  "border-t-status-draft",
  planned:                "border-t-status-planned",
  implementing:           "border-t-status-implementing",
  reviewing:              "border-t-status-reviewing",
  changes_requested:      "border-t-status-changes_requested",
  approved:               "border-t-status-approved",
  conflict_detected:      "border-t-status-conflict",
  merged:                 "border-t-status-merged",
  abandoned:              "border-t-status-abandoned",
  awaiting_human_approval:"border-t-status-hitl",
};

export function KanbanBoard() {
  const qc = useQueryClient();
  const { data: changeSets = [], isLoading, isError } = useChangeSets();
  const [showEmpty, setShowEmpty] = useState(true);

  useSSE((event: SSEEvent) => {
    if (event.type === "change_set_created" || event.type === "change_set_updated") {
      qc.invalidateQueries({ queryKey: ["change-sets"] });
    }
  });

  const byStatus = ALL_COLUMNS.reduce<Record<string, typeof changeSets>>(
    (acc, s) => { acc[s] = changeSets.filter((cs) => cs.status === s); return acc; },
    {}
  );

  const hitlCount = byStatus["awaiting_human_approval"]?.length ?? 0;
  const visibleColumns = showEmpty
    ? ALL_COLUMNS
    : ALL_COLUMNS.filter((s) => byStatus[s].length > 0);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64 text-muted-foreground text-sm">
        Loading…
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <p className="text-sm text-destructive font-medium">API server unreachable</p>
          <p className="text-xs text-muted-foreground mt-1">Run <code className="font-mono bg-muted px-1 rounded">bun run dev:web</code></p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Live agent activity strip — visible whenever sessions exist */}
      <AgentActivityBar />

      {/* Board header */}
      <div className="flex items-center justify-between px-4 pt-3.5 pb-3 border-b">
        <div>
          <h1 className="text-base font-semibold leading-none">Board</h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            {changeSets.length} change set{changeSets.length !== 1 ? "s" : ""}
            {hitlCount > 0 && (
              <span className="ml-2 text-status-hitl font-medium">
                · {hitlCount} awaiting approval
              </span>
            )}
          </p>
        </div>
        <button
          className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
          onClick={() => setShowEmpty((v) => !v)}
        >
          <SlidersHorizontal size={12} />
          {showEmpty ? "Hide empty" : "All columns"}
        </button>
      </div>

      {visibleColumns.length === 0 ? (
        <div className="flex flex-col items-center justify-center flex-1 text-muted-foreground gap-2">
          <p className="text-sm">No ChangeSets yet.</p>
          <p className="text-xs font-mono bg-muted px-2 py-1 rounded">POST /api/change-sets</p>
        </div>
      ) : (
        <div className="overflow-y-auto flex-1 p-4">
          <div
            className="gap-3"
            style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", alignItems: "start" }}
          >
            {visibleColumns.map((status) => (
              <div
                key={status}
                className={`flex flex-col rounded-lg border bg-card border-t-2 ${COLUMN_BORDER[status] ?? "border-t-border"}`}
              >
                <div className="flex items-center gap-2 px-3 py-2.5 border-b bg-card rounded-t-lg">
                  <span className="text-xs font-semibold text-foreground truncate">
                    {COLUMN_LABELS[status] ?? status}
                  </span>
                  <span className="ml-auto text-xs text-muted-foreground bg-muted rounded-full px-1.5 py-0.5 leading-none">
                    {byStatus[status].length}
                  </span>
                </div>
                <div className="p-2 flex flex-col gap-2">
                  {byStatus[status].length === 0 ? (
                    <div className="text-xs text-muted-foreground text-center py-6">Empty</div>
                  ) : (
                    byStatus[status].map((cs) => (
                      <ChangeSetCard key={cs.id} changeSet={cs} />
                    ))
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
