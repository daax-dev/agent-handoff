import type { Database } from "bun:sqlite";
import {
  createReviewComment,
  listReviewComments,
  resolveComment,
  CreateReviewCommentInputSchema,
  ReviewCommentSeveritySchema,
  CommentAlreadyResolvedError,
  CommentNotFoundError,
} from "../../domain/review-comment.js";
import { json, notFound, badRequest, err } from "../response.js";

export function reviewCommentRoutes(
  db: Database,
  path: string,
  req: Request
): Response | Promise<Response> | null {
  const { method } = req;
  const url = new URL(req.url);

  // GET /api/change-sets/:csId/comments
  const listMatch = path.match(/^\/api\/change-sets\/(chg_\d{6})\/comments$/);
  if (listMatch && method === "GET") {
    const csId = listMatch[1];
    const severityParam = url.searchParams.get("severity") ?? undefined;
    const resolvedParam = url.searchParams.get("resolved");

    const severityParsed = severityParam
      ? ReviewCommentSeveritySchema.safeParse(severityParam)
      : null;
    if (severityParsed && !severityParsed.success) {
      return badRequest(`Invalid severity: ${severityParam}`);
    }

    let resolvedFilter: boolean | undefined;
    if (resolvedParam === "true") resolvedFilter = true;
    else if (resolvedParam === "false") resolvedFilter = false;

    return json(
      listReviewComments(db, csId, {
        severity: severityParsed?.data,
        resolved: resolvedFilter,
      })
    );
  }

  // POST /api/change-sets/:csId/comments
  if (listMatch && method === "POST") {
    const csId = listMatch[1];
    return req.json().then((body: unknown) => {
      const parsed = CreateReviewCommentInputSchema.safeParse({
        ...(body as Record<string, unknown>),
        changeSetId: csId,
      });
      if (!parsed.success) {
        return badRequest(parsed.error.message);
      }
      const comment = createReviewComment(db, parsed.data);
      return json(comment, 201);
    });
  }

  // PATCH /api/change-sets/:csId/comments/:cid/resolve
  const resolveMatch = path.match(
    /^\/api\/change-sets\/(chg_\d{6})\/comments\/(cmt_\d{6})\/resolve$/
  );
  if (resolveMatch && method === "PATCH") {
    const [, , cid] = resolveMatch;
    return req.json().then((body: unknown) => {
      const resolvedBy =
        ((body as Record<string, unknown>)?.resolvedBy as string) ?? "unknown";
      try {
        const comment = resolveComment(db, cid, resolvedBy);
        return json({ resolved: true, resolvedAt: comment.resolved_at, commentId: cid });
      } catch (e) {
        if (e instanceof CommentAlreadyResolvedError) {
          return json({ error: e.message, code: "ALREADY_RESOLVED" }, 409);
        }
        if (e instanceof CommentNotFoundError) {
          return notFound(e.message);
        }
        return err(e instanceof Error ? e.message : String(e));
      }
    });
  }

  return null;
}
