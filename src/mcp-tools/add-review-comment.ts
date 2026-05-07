import type { Database } from "bun:sqlite";
import { createReviewComment, ReviewCommentSeveritySchema } from "../domain/review-comment.js";
import { mcpText, mcpError } from "./response.js";

interface Input {
  changeSetId: string;
  body: string;
  severity: "blocking" | "advisory" | "nit";
  filePath?: string;
  lineNumber?: number;
  authorAgent?: string;
  authorRole?: string;
}

export async function handleAddReviewComment(args: Input, db: Database) {
  const cs = db
    .query<{ id: string }, [string]>("SELECT id FROM change_sets WHERE id = ?")
    .get(args.changeSetId);

  if (!cs) {
    return mcpError({ error: `ChangeSet ${args.changeSetId} not found` });
  }

  const severityParsed = ReviewCommentSeveritySchema.safeParse(args.severity);
  if (!severityParsed.success) {
    return mcpError({ error: `Invalid severity: ${args.severity}` });
  }

  const comment = createReviewComment(db, {
    changeSetId: args.changeSetId,
    body: args.body,
    severity: severityParsed.data,
    filePath: args.filePath,
    lineNumber: args.lineNumber,
    authorAgent: args.authorAgent,
    authorRole: args.authorRole,
  });

  return mcpText({ commentId: comment.id, severity: comment.severity });
}
