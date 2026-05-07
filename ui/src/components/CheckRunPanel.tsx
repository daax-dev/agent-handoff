import { useState } from "react";
import type { CheckRun, CheckRunStatus } from "@/types";

function StatusIcon({ status }: { status: CheckRunStatus }) {
  switch (status) {
    case "passed":
      return <span className="text-green-500 text-base">✓</span>;
    case "failed":
      return <span className="text-red-500 text-base">✗</span>;
    case "running":
      return <span className="text-blue-500 animate-spin inline-block">⟳</span>;
    case "skipped":
      return <span className="text-muted-foreground text-base">–</span>;
    default:
      return <span className="text-muted-foreground text-base">○</span>;
  }
}

interface CheckRunPanelProps {
  checkRuns: CheckRun[];
}

export function CheckRunPanel({ checkRuns }: CheckRunPanelProps) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  if (checkRuns.length === 0) {
    return (
      <div className="text-sm text-muted-foreground p-4">No check runs yet.</div>
    );
  }

  function toggleExpand(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div className="divide-y text-sm">
      {checkRuns.map((run) => (
        <div key={run.id} className="p-3">
          <div
            className="flex items-center gap-2 cursor-pointer select-none"
            onClick={() => run.output && toggleExpand(run.id)}
          >
            <StatusIcon status={run.status} />
            <span className="font-medium font-mono">{run.name}</span>
            <span className="text-muted-foreground text-xs ml-auto">
              {run.exit_code != null ? `exit ${run.exit_code}` : ""}
            </span>
            {run.output && (
              <span className="text-xs text-muted-foreground">
                {expanded.has(run.id) ? "▲" : "▼"}
              </span>
            )}
          </div>
          {expanded.has(run.id) && run.output && (
            <pre className="mt-2 text-xs bg-muted p-2 rounded overflow-auto max-h-48 whitespace-pre-wrap">
              {run.output}
            </pre>
          )}
        </div>
      ))}
    </div>
  );
}
