import type { Database } from "bun:sqlite";
import { randomUUID } from "node:crypto";

interface Input {
  changeSetId: string;
  body: string;
  severity: "blocking" | "advisory" | "nit";
  filePath?: string;
  lineNumber?: number;
  authorAgent?: string;
  authorRole?: string;
}

function mcpText(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
}
function mcpError(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }], isError: true };
}

export async function handleAddReviewComment(args: Input, db: Database) {
  const cs = db
    .query<{ id: string }, [string]>("SELECT id FROM change_sets WHERE id = ?")
    .get(args.changeSetId);

  if (!cs) {
    return mcpError({ error: `ChangeSet ${args.changeSetId} not found` });
  }

  const id = `cmt_${randomUUID().replace(/-/g, "").slice(0, 10)}`;
  const now = new Date().toISOString();

  db.run(
    `INSERT INTO review_comments
       (id, change_set_id, author_agent, author_role, file_path, line_number, body, severity, resolved, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`,
    [
      id,
      args.changeSetId,
      args.authorAgent ?? "unknown",
      args.authorRole ?? "reviewer",
      args.filePath ?? null,
      args.lineNumber ?? null,
      args.body,
      args.severity,
      now,
    ]
  );

  return mcpText({ commentId: id, severity: args.severity });
}
