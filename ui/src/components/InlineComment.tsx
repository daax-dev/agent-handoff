import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { ReviewComment, CommentSeverity } from "@/types";

function severityVariant(
  severity: CommentSeverity
): "default" | "secondary" | "destructive" | "outline" {
  switch (severity) {
    case "blocking": return "destructive";
    case "major": return "destructive";
    case "minor": return "secondary";
    case "info": return "outline";
  }
}

interface InlineCommentProps {
  comment: ReviewComment;
  onResolve: () => void;
}

export function InlineComment({ comment, onResolve }: InlineCommentProps) {
  return (
    <div
      className={`border-l-4 ml-20 pl-3 py-2 pr-3 text-xs ${
        comment.resolved_at
          ? "border-muted bg-muted/30 opacity-60"
          : comment.severity === "blocking" || comment.severity === "major"
          ? "border-red-400 bg-red-50 dark:bg-red-950/30"
          : comment.severity === "minor"
          ? "border-yellow-400 bg-yellow-50 dark:bg-yellow-950/30"
          : "border-blue-300 bg-blue-50 dark:bg-blue-950/30"
      }`}
    >
      <div className="flex items-center gap-2 mb-1">
        <Badge variant={severityVariant(comment.severity)} className="text-[10px] px-1 py-0">
          {comment.severity}
        </Badge>
        <span className="text-muted-foreground">{comment.author_agent}</span>
        {comment.resolved_at && (
          <span className="text-muted-foreground italic">resolved</span>
        )}
      </div>
      <p className="whitespace-pre-wrap">{comment.body}</p>
      {!comment.resolved_at && (
        <Button
          size="sm"
          variant="outline"
          className="mt-2 h-6 text-[10px]"
          onClick={onResolve}
        >
          Resolve
        </Button>
      )}
    </div>
  );
}
