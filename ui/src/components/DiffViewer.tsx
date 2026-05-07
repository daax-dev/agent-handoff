import { useMemo } from "react";
import { parse } from "diff2html";
import type { ReviewComment } from "@/types";
import { InlineComment } from "./InlineComment";

interface DiffViewerProps {
  diffText: string;
  comments: ReviewComment[];
  onResolveComment: (commentId: string) => void;
}

type LineType = "insert" | "delete" | "context";

interface DiffLine {
  type: LineType;
  content: string;
  newNumber: number | null;
  oldNumber: number | null;
}

export function DiffViewer({ diffText, comments, onResolveComment }: DiffViewerProps) {
  const files = useMemo(() => {
    if (!diffText || diffText.startsWith("[diff unavailable")) return [];
    try {
      return parse(diffText);
    } catch {
      return [];
    }
  }, [diffText]);

  // Group inline comments by file + line number
  const commentsByFileAndLine = useMemo(() => {
    const map = new Map<string, ReviewComment[]>();
    for (const c of comments) {
      if (c.file_path && c.line_number != null) {
        const key = `${c.file_path}:${c.line_number}`;
        const existing = map.get(key) ?? [];
        map.set(key, [...existing, c]);
      }
    }
    return map;
  }, [comments]);

  if (!diffText) {
    return (
      <div className="text-sm text-muted-foreground p-4">Loading diff…</div>
    );
  }

  if (diffText.startsWith("[diff unavailable") || files.length === 0) {
    return (
      <div className="text-sm text-muted-foreground p-4 font-mono">
        {diffText || "No changes"}
      </div>
    );
  }

  return (
    <div className="overflow-auto text-xs font-mono border rounded">
      {files.map((file) => (
        <div key={file.newName || file.oldName} className="border-b last:border-b-0">
          {/* File header */}
          <div className="bg-muted px-3 py-1 font-medium text-sm flex gap-2 items-center">
            <span className="text-muted-foreground">
              {file.oldName !== file.newName && file.oldName !== "/dev/null"
                ? `${file.oldName} → `
                : ""}
            </span>
            <span>{file.newName === "/dev/null" ? file.oldName : file.newName}</span>
          </div>

          {/* Hunks */}
          {file.blocks.map((block, blockIdx) => {
            const rows: JSX.Element[] = [];

            // Hunk header
            rows.push(
              <div key={`hunk-${blockIdx}`} className="bg-blue-50 dark:bg-blue-950 px-3 py-0.5 text-blue-600 dark:text-blue-400">
                @@ {block.header} @@
              </div>
            );

            for (const line of block.lines as DiffLine[]) {
              const lineKey = `${blockIdx}-${line.oldNumber ?? "n"}-${line.newNumber ?? "n"}`;
              const bg =
                line.type === "insert"
                  ? "bg-green-50 dark:bg-green-950"
                  : line.type === "delete"
                  ? "bg-red-50 dark:bg-red-950"
                  : "bg-background";
              const prefix =
                line.type === "insert" ? "+" : line.type === "delete" ? "-" : " ";
              const textColor =
                line.type === "insert"
                  ? "text-green-800 dark:text-green-200"
                  : line.type === "delete"
                  ? "text-red-800 dark:text-red-200"
                  : "";

              rows.push(
                <div key={lineKey} className={`flex ${bg}`}>
                  <span className="w-10 shrink-0 text-right pr-2 select-none text-muted-foreground border-r">
                    {line.oldNumber ?? ""}
                  </span>
                  <span className="w-10 shrink-0 text-right pr-2 select-none text-muted-foreground border-r">
                    {line.newNumber ?? ""}
                  </span>
                  <span className={`px-2 whitespace-pre-wrap break-all ${textColor}`}>
                    {prefix}
                    {/* Strip the leading +/-/space that diff2html adds to content */}
                    {line.content.replace(/^[+\- ]/, "")}
                  </span>
                </div>
              );

              // Inject inline comments after matching lines
              const newFile = file.newName === "/dev/null" ? file.oldName : file.newName;
              const lineComments = line.newNumber
                ? commentsByFileAndLine.get(`${newFile}:${line.newNumber}`) ?? []
                : [];
              for (const comment of lineComments) {
                rows.push(
                  <InlineComment
                    key={comment.id}
                    comment={comment}
                    onResolve={() => onResolveComment(comment.id)}
                  />
                );
              }
            }

            return <div key={blockIdx}>{rows}</div>;
          })}
        </div>
      ))}
    </div>
  );
}
