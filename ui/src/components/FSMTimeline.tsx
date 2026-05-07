import type { FSMCheckpoint } from "@/types";

function relativeTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(ms / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

interface FSMTimelineProps {
  checkpoints: FSMCheckpoint[];
}

export function FSMTimeline({ checkpoints }: FSMTimelineProps) {
  if (checkpoints.length === 0) {
    return (
      <div className="text-sm text-muted-foreground p-4">No state transitions yet.</div>
    );
  }

  return (
    <ol className="relative border-l border-muted ml-4 space-y-4 py-2">
      {checkpoints.map((cp) => (
        <li key={cp.id} className="ml-4">
          <span className="absolute -left-1.5 mt-1 h-3 w-3 rounded-full border-2 border-background bg-primary" />
          <div className="text-sm">
            <span className="font-mono font-medium text-foreground">
              {cp.from_status}
            </span>
            <span className="mx-1 text-muted-foreground">→</span>
            <span className="font-mono font-medium text-foreground">
              {cp.to_status}
            </span>
            <span className="ml-2 text-xs text-muted-foreground">
              via <span className="font-mono">{cp.trigger}</span>
            </span>
          </div>
          <div className="text-xs text-muted-foreground mt-0.5">
            {relativeTime(cp.ts)} · {new Date(cp.ts).toLocaleString()}
          </div>
        </li>
      ))}
    </ol>
  );
}
