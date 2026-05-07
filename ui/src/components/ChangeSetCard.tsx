import { Link } from "react-router-dom";
import { Card, CardHeader, CardTitle, CardContent, CardFooter } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useApproveChangeSet, useRejectChangeSet } from "@/hooks/useChangeSets";
import type { ChangeSet, ChangeSetStatus } from "@/types";

function statusVariant(status: ChangeSetStatus): "default" | "secondary" | "destructive" | "outline" | "success" | "warning" | "info" | "muted" {
  switch (status) {
    case "draft": return "muted";
    case "planned": return "info";
    case "implementing": return "info";
    case "reviewing": return "warning";
    case "changes_requested": return "destructive";
    case "approved": return "success";
    case "conflict_detected": return "destructive";
    case "merged": return "success";
    case "abandoned": return "muted";
    case "awaiting_human_approval": return "warning";
    default: return "outline";
  }
}

function statusLabel(status: ChangeSetStatus): string {
  return status.replace(/_/g, " ");
}

function relativeTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(ms / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

interface ChangeSetCardProps {
  changeSet: ChangeSet;
}

export function ChangeSetCard({ changeSet }: ChangeSetCardProps) {
  const approve = useApproveChangeSet();
  const reject = useRejectChangeSet();
  const isHITL = changeSet.status === "awaiting_human_approval";

  return (
    <Card className="mb-2 hover:shadow-md transition-shadow cursor-default">
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2">
          <CardTitle className="text-sm font-medium leading-snug line-clamp-2">
            <Link
              to={`/change-sets/${changeSet.id}`}
              className="hover:underline"
            >
              {changeSet.title}
            </Link>
          </CardTitle>
          <Badge variant={statusVariant(changeSet.status)} className="shrink-0">
            {statusLabel(changeSet.status)}
          </Badge>
        </div>
        <p className="text-xs text-muted-foreground font-mono">{changeSet.id}</p>
      </CardHeader>

      {changeSet.description && (
        <CardContent>
          <p className="text-xs text-muted-foreground line-clamp-2">
            {changeSet.description}
          </p>
        </CardContent>
      )}

      <CardFooter className="pt-2 flex items-center justify-between">
        <span className="text-xs text-muted-foreground">
          {relativeTime(changeSet.created_at)}
        </span>

        {isHITL && (
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="success"
              onClick={() => approve.mutate(changeSet.id)}
              disabled={approve.isPending}
            >
              Approve
            </Button>
            <Button
              size="sm"
              variant="destructive"
              onClick={() => reject.mutate(changeSet.id)}
              disabled={reject.isPending}
            >
              Reject
            </Button>
          </div>
        )}
      </CardFooter>
    </Card>
  );
}
