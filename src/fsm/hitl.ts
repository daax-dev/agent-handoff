import type { Database } from "bun:sqlite";
import { randomUUID } from "node:crypto";
import { FSMEngine } from "./engine.js";
import { getHITLConfig, type HITLConfig } from "./hitl-config.js";
import type { SSEBroadcaster } from "../api/sse.js";

export class HITLPendingError extends Error {
  readonly approvalId: string;
  constructor(approvalId: string) {
    super(`A HITL gate is pending (approval: ${approvalId}). Human action required.`);
    this.name = "HITLPendingError";
    this.approvalId = approvalId;
  }
}

export interface ApprovalRow {
  id: string;
  change_set_id: string;
  trigger: string;
  original_status: string;
  requested_at: string;
  decided_at: string | null;
  decision: "approved" | "rejected" | null;
  decided_by: string | null;
  reason: string | null;
}

export type TransitionResult =
  | { status: "ok"; newStatus: string }
  | { status: "pending"; approvalId: string };

export class HITLGate {
  private readonly db: Database;
  private readonly fsm: FSMEngine;
  private readonly sse?: SSEBroadcaster;
  private readonly config: HITLConfig;

  constructor(db: Database, sse?: SSEBroadcaster, config?: HITLConfig) {
    this.db = db;
    this.sse = sse;
    this.fsm = new FSMEngine(db, sse);
    this.config = config ?? getHITLConfig();
  }

  transition(changeSetId: string, trigger: string): TransitionResult {
    if (!this.config.enabled || !this.config.gatedTriggers.includes(trigger)) {
      return { status: "ok", newStatus: this.fsm.transition(changeSetId, trigger) };
    }

    // Block if a gate is already open for this ChangeSet
    const pending = this.getPendingApproval(changeSetId);
    if (pending) {
      throw new HITLPendingError(pending.id);
    }

    // Open the gate — capture original status so we can restore it on approve
    const csRow = this.db
      .query<{ status: string }, [string]>("SELECT status FROM change_sets WHERE id = ?")
      .get(changeSetId);
    if (!csRow) throw new Error(`ChangeSet ${changeSetId} not found`);

    const approvalId = randomUUID();
    const now = new Date().toISOString();
    this.db.run(
      `INSERT INTO hitl_approvals (id, change_set_id, trigger, original_status, requested_at)
       VALUES (?, ?, ?, ?, ?)`,
      [approvalId, changeSetId, trigger, csRow.status, now]
    );

    this.db.run(
      "UPDATE change_sets SET status = 'awaiting_human_approval', updated_at = ? WHERE id = ?",
      [now, changeSetId]
    );

    this.sse?.emit({
      type: "hitl_requested",
      payload: { changeSetId, trigger, approvalId },
      ts: now,
    });

    // Optional desktop notification — skip silently if not installed
    try {
      const which = Bun.spawnSync(["which", "terminal-notifier"], { stdout: "pipe", stderr: "pipe" });
      if (which.exitCode === 0) {
        Bun.spawnSync(
          ["terminal-notifier", "-title", "HITL Gate", "-message", `${trigger} requires approval for ${changeSetId}`],
          { stdout: "pipe", stderr: "pipe" }
        );
      }
    } catch { /* non-fatal */ }

    return { status: "pending", approvalId };
  }

  approve(approvalId: string, decidedBy = "human"): string {
    const row = this.getApproval(approvalId);
    if (!row) throw new Error(`Approval ${approvalId} not found`);
    if (row.decided_at) throw new Error(`Approval ${approvalId} already decided`);

    const now = new Date().toISOString();
    this.db.run(
      `UPDATE hitl_approvals SET decision = 'approved', decided_at = ?, decided_by = ? WHERE id = ?`,
      [now, decidedBy, approvalId]
    );

    // Restore the pre-gate status so FSMEngine can make the transition normally
    this.db.run(
      "UPDATE change_sets SET status = ? WHERE id = ?",
      [row.original_status, row.change_set_id]
    );
    return this.fsm.transition(row.change_set_id, row.trigger);
  }

  reject(approvalId: string, reason: string, decidedBy = "human"): string {
    const row = this.getApproval(approvalId);
    if (!row) throw new Error(`Approval ${approvalId} not found`);
    if (row.decided_at) throw new Error(`Approval ${approvalId} already decided`);

    const now = new Date().toISOString();
    this.db.run(
      `UPDATE hitl_approvals SET decision = 'rejected', decided_at = ?, decided_by = ?, reason = ? WHERE id = ?`,
      [now, decidedBy, reason, approvalId]
    );

    // Rejection: merge gate → abandoned; approve gate → changes_requested
    const targetStatus = row.trigger === "merge" ? "abandoned" : "changes_requested";
    this.db.run(
      "UPDATE change_sets SET status = ?, updated_at = ? WHERE id = ?",
      [targetStatus, now, row.change_set_id]
    );

    this.sse?.emit({
      type: "change_set_updated",
      payload: { changeSetId: row.change_set_id, status: targetStatus, trigger: "hitl_rejected", ts: now },
      ts: now,
    });

    return targetStatus;
  }

  getApproval(approvalId: string): ApprovalRow | null {
    return this.db
      .query<ApprovalRow, [string]>("SELECT * FROM hitl_approvals WHERE id = ?")
      .get(approvalId);
  }

  getPendingApproval(changeSetId: string): ApprovalRow | null {
    return this.db
      .query<ApprovalRow, [string]>(
        "SELECT * FROM hitl_approvals WHERE change_set_id = ? AND decided_at IS NULL LIMIT 1"
      )
      .get(changeSetId);
  }

  listApprovals(changeSetId: string): ApprovalRow[] {
    return this.db
      .query<ApprovalRow, [string]>(
        "SELECT * FROM hitl_approvals WHERE change_set_id = ? ORDER BY requested_at ASC"
      )
      .all(changeSetId);
  }
}
