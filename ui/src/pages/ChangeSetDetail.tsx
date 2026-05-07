import { useState } from "react";
import { useParams, Link } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DiffViewer } from "@/components/DiffViewer";
import { CheckRunPanel } from "@/components/CheckRunPanel";
import { FSMTimeline } from "@/components/FSMTimeline";
import { InlineComment } from "@/components/InlineComment";
import { StreamPanel } from "@/components/StreamPanel";
import { useChangeSetDetail, useResolveComment } from "@/hooks/useChangeSetDetail";
import type { ChangeSetStatus } from "@/types";

type Tab = "diff" | "checks" | "timeline" | "stream";

function statusVariant(
  status: ChangeSetStatus
): "default" | "secondary" | "destructive" | "outline" {
  switch (status) {
    case "merged":
    case "approved":
      return "default";
    case "changes_requested":
    case "conflict_detected":
      return "destructive";
    case "reviewing":
    case "awaiting_human_approval":
      return "secondary";
    default:
      return "outline";
  }
}

export function ChangeSetDetail() {
  const { id } = useParams<{ id: string }>();
  const [activeTab, setActiveTab] = useState<Tab>("diff");
  const [selectedTaskIdx, setSelectedTaskIdx] = useState(0);

  const { changeSet, diff, comments, checkRuns, checkpoints, tasks } =
    useChangeSetDetail(id ?? "");

  const resolve = useResolveComment(id ?? "");

  if (!id) return <div className="p-6 text-muted-foreground">No ID provided.</div>;

  if (changeSet.isLoading) {
    return <div className="p-6 text-muted-foreground">Loading…</div>;
  }

  if (changeSet.error || !changeSet.data) {
    return (
      <div className="p-6">
        <p className="text-destructive">ChangeSet not found: {id}</p>
        <Link to="/" className="text-sm text-primary mt-2 inline-block">
          ← Back to board
        </Link>
      </div>
    );
  }

  const cs = changeSet.data;
  const allComments = comments.data ?? [];
  const generalComments = allComments.filter(
    (c) => c.file_path == null || c.line_number == null
  );
  const taskList = tasks.data ?? [];
  const activeTask = taskList[selectedTaskIdx];

  const tabs: { key: Tab; label: string }[] = [
    { key: "diff", label: "Diff" },
    { key: "checks", label: `Checks (${(checkRuns.data ?? []).length})` },
    { key: "timeline", label: `Timeline (${(checkpoints.data ?? []).length})` },
    { key: "stream", label: "Agent Output" },
  ];

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="border-b px-6 py-4">
        <div className="flex items-center gap-3 mb-1">
          <Link to="/" className="text-sm text-muted-foreground hover:text-foreground">
            ← Board
          </Link>
          <span className="text-muted-foreground">/</span>
          <span className="font-mono text-sm text-muted-foreground">{cs.id}</span>
        </div>
        <div className="flex items-start justify-between gap-4">
          <h1 className="text-lg font-semibold">{cs.title}</h1>
          <Badge variant={statusVariant(cs.status)}>{cs.status.replace(/_/g, " ")}</Badge>
        </div>
        <div className="text-xs text-muted-foreground mt-1 font-mono">
          {cs.source_branch} → {cs.target_branch}
        </div>
      </div>

      {/* Tabs */}
      <div className="border-b flex">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setActiveTab(t.key)}
            className={`px-4 py-2 text-sm border-b-2 transition-colors ${
              activeTab === t.key
                ? "border-primary text-primary font-medium"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="flex flex-1 overflow-hidden">
        {/* Main content */}
        <div className="flex-1 overflow-auto p-4">
          {activeTab === "diff" && (
            <DiffViewer
              diffText={diff.data ?? ""}
              comments={allComments}
              onResolveComment={(cid) => resolve.mutate(cid)}
            />
          )}
          {activeTab === "checks" && (
            <CheckRunPanel checkRuns={checkRuns.data ?? []} />
          )}
          {activeTab === "timeline" && (
            <FSMTimeline checkpoints={checkpoints.data ?? []} />
          )}
          {activeTab === "stream" && (
            <div className="space-y-4">
              {taskList.length > 1 && (
                <div className="flex gap-2 flex-wrap">
                  {taskList.map((t, i) => (
                    <Button
                      key={t.id}
                      size="sm"
                      variant={i === selectedTaskIdx ? "default" : "outline"}
                      onClick={() => setSelectedTaskIdx(i)}
                    >
                      {t.id}
                    </Button>
                  ))}
                </div>
              )}
              {activeTask ? (
                <StreamPanel taskId={activeTask.id} className="rounded border overflow-hidden" />
              ) : (
                <div className="text-sm text-muted-foreground">No tasks for this ChangeSet.</div>
              )}
            </div>
          )}
        </div>

        {/* General comments sidebar */}
        {generalComments.length > 0 && (
          <aside className="w-72 border-l overflow-auto p-3 space-y-3">
            <h2 className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              General Comments
            </h2>
            {generalComments.map((c) => (
              <InlineComment
                key={c.id}
                comment={c}
                onResolve={() => resolve.mutate(c.id)}
              />
            ))}
          </aside>
        )}
      </div>
    </div>
  );
}
