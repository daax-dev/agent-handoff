import type { Database } from "bun:sqlite";
import { HITLGate } from "../../fsm/hitl.js";
import type { SSEBroadcaster } from "../sse.js";
import { json, notFound, badRequest, err } from "../response.js";

export function approvalRoutes(
  db: Database,
  sse: SSEBroadcaster,
  path: string,
  req: Request
): Response | Promise<Response> | null {
  const { method } = req;

  // GET /api/approvals/:changeSetId — list approvals for a ChangeSet
  const listMatch = path.match(/^\/api\/approvals\/by-changeset\/(chg_\d{6})$/);
  if (listMatch && method === "GET") {
    const gate = new HITLGate(db, sse);
    return json(gate.listApprovals(listMatch[1]));
  }

  // GET /api/approvals/:id — get single approval
  const getMatch = path.match(/^\/api\/approvals\/([0-9a-f-]{36})$/);
  if (getMatch && method === "GET") {
    const gate = new HITLGate(db, sse);
    const row = gate.getApproval(getMatch[1]);
    return row ? json(row) : notFound("Approval not found");
  }

  // POST /api/approvals/:id/approve
  const approveMatch = path.match(/^\/api\/approvals\/([0-9a-f-]{36})\/approve$/);
  if (approveMatch && method === "POST") {
    const approvalId = approveMatch[1];
    const gate = new HITLGate(db, sse);
    if (!gate.getApproval(approvalId)) return notFound("Approval not found");
    return req.json().then((body: unknown) => {
      try {
        const decidedBy = (body as Record<string, unknown>)?.decided_by as string | undefined;
        const newStatus = gate.approve(approvalId, decidedBy ?? "human");
        return json({ approvalId, decision: "approved", newStatus });
      } catch (e) {
        return err(e instanceof Error ? e.message : String(e));
      }
    }) as unknown as Response;
  }

  // POST /api/approvals/:id/reject
  const rejectMatch = path.match(/^\/api\/approvals\/([0-9a-f-]{36})\/reject$/);
  if (rejectMatch && method === "POST") {
    const approvalId = rejectMatch[1];
    const gate = new HITLGate(db, sse);
    if (!gate.getApproval(approvalId)) return notFound("Approval not found");
    return req.json().then((body: unknown) => {
      const reason = (body as Record<string, unknown>)?.reason as string | undefined;
      if (!reason) return badRequest("reason is required");
      try {
        const decidedBy = (body as Record<string, unknown>)?.decided_by as string | undefined;
        const newStatus = gate.reject(approvalId, reason, decidedBy ?? "human");
        return json({ approvalId, decision: "rejected", newStatus });
      } catch (e) {
        return err(e instanceof Error ? e.message : String(e));
      }
    }) as unknown as Response;
  }

  return null;
}
