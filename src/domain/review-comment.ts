import { z } from "zod";
import type { Database } from "bun:sqlite";

export const ReviewCommentSeveritySchema = z.enum(["blocking", "advisory", "nit"]);
export type ReviewCommentSeverity = z.infer<typeof ReviewCommentSeveritySchema>;

export const ReviewCommentSchema = z.object({
  id: z.string(),
  change_set_id: z.string(),
  author_agent: z.string(),
  author_role: z.string(),
  file_path: z.string().nullable(),
  line_number: z.number().int().nullable(),
  body: z.string().min(1),
  severity: ReviewCommentSeveritySchema,
  resolved: z.number().int(),
  resolved_by: z.string().nullable(),
  resolved_at: z.string().nullable(),
  created_at: z.string(),
});

export type ReviewComment = z.infer<typeof ReviewCommentSchema>;

export const CreateReviewCommentInputSchema = z.object({
  changeSetId: z.string(),
  body: z.string().min(1, "body is required"),
  severity: ReviewCommentSeveritySchema,
  filePath: z.string().optional(),
  lineNumber: z.number().int().optional(),
  authorAgent: z.string().optional(),
  authorRole: z.string().optional(),
});
export type CreateReviewCommentInput = z.infer<typeof CreateReviewCommentInputSchema>;

export class CommentAlreadyResolvedError extends Error {
  constructor(commentId: string) {
    super(`Comment ${commentId} is already resolved`);
    this.name = "CommentAlreadyResolvedError";
  }
}

export class CommentNotFoundError extends Error {
  constructor(commentId: string) {
    super(`Comment ${commentId} not found`);
    this.name = "CommentNotFoundError";
  }
}

function nextId(db: Database): string {
  const row = db
    .query<{ value: number }, []>(
      "UPDATE sequences SET value = value + 1 WHERE name = 'review_comments' RETURNING value"
    )
    .get();
  if (!row) throw new Error("sequences table not initialized for review_comments");
  return `cmt_${String(row.value).padStart(6, "0")}`;
}

export function createReviewComment(db: Database, input: CreateReviewCommentInput): ReviewComment {
  const id = nextId(db);
  const now = new Date().toISOString();
  db.run(
    `INSERT INTO review_comments
      (id, change_set_id, author_agent, author_role, file_path, line_number, body, severity, resolved, resolved_by, resolved_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, NULL, NULL, ?)`,
    [
      id,
      input.changeSetId,
      input.authorAgent ?? "unknown",
      input.authorRole ?? "reviewer",
      input.filePath ?? null,
      input.lineNumber ?? null,
      input.body,
      input.severity,
      now,
    ]
  );
  return getReviewComment(db, id)!;
}

export function getReviewComment(db: Database, id: string): ReviewComment | null {
  return db
    .query<ReviewComment, [string]>("SELECT * FROM review_comments WHERE id = ?")
    .get(id) ?? null;
}

export function listReviewComments(
  db: Database,
  changeSetId: string,
  filters: { severity?: ReviewCommentSeverity; resolved?: boolean } = {}
): ReviewComment[] {
  const conditions = ["change_set_id = ?"];
  const params: (string | number)[] = [changeSetId];

  if (filters.severity !== undefined) {
    conditions.push("severity = ?");
    params.push(filters.severity);
  }
  if (filters.resolved !== undefined) {
    conditions.push("resolved = ?");
    params.push(filters.resolved ? 1 : 0);
  }

  const sql = `SELECT * FROM review_comments WHERE ${conditions.join(" AND ")} ORDER BY created_at ASC`;
  return db.query<ReviewComment, typeof params>(sql).all(...params);
}

export function listBlockingComments(db: Database, changeSetId: string): ReviewComment[] {
  return listReviewComments(db, changeSetId, { severity: "blocking", resolved: false });
}

export function resolveComment(
  db: Database,
  commentId: string,
  resolvedBy: string
): ReviewComment {
  const comment = getReviewComment(db, commentId);
  if (!comment) throw new CommentNotFoundError(commentId);
  if (comment.resolved === 1) throw new CommentAlreadyResolvedError(commentId);

  const now = new Date().toISOString();
  db.run(
    "UPDATE review_comments SET resolved = 1, resolved_by = ?, resolved_at = ? WHERE id = ?",
    [resolvedBy, now, commentId]
  );
  return getReviewComment(db, commentId)!;
}
