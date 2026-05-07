import type { Database } from "bun:sqlite";
import { randomUUID } from "node:crypto";
import { findTransition } from "./states.js";
import { InvalidTransitionError, CircuitBreakerError } from "./errors.js";
import type { SSEBroadcaster } from "../api/sse.js";

const CIRCUIT_BREAKER_THRESHOLD = 3;
const CIRCUIT_BREAKER_TRIGGER = "request_changes";
const CIRCUIT_BREAKER_FROM = "reviewing";
const CIRCUIT_BREAKER_TO_NORMAL = "changes_requested";

export interface CheckpointRow {
  id: string;
  change_set_id: string;
  from_status: string;
  to_status: string;
  trigger: string;
  ts: string;
  metadata: string | null;
}

export interface TransitionOptions {
  metadata?: Record<string, unknown>;
}

export class FSMEngine {
  private readonly db: Database;
  private readonly sse?: SSEBroadcaster;

  constructor(db: Database, sse?: SSEBroadcaster) {
    this.db = db;
    this.sse = sse;
  }

  transition(
    changeSetId: string,
    trigger: string,
    options: TransitionOptions = {}
  ): string {
    interface RunResult {
      newStatus: string;
      circuitBreakerError?: CircuitBreakerError;
    }

    // Run atomically with BEGIN IMMEDIATE to serialize concurrent calls.
    // We return errors rather than throw inside the transaction so that
    // the DB write commits before we surface the error to the caller.
    const run = this.db.transaction((): RunResult => {
      const row = this.db
        .query<{ status: string }, [string]>(
          "SELECT status FROM change_sets WHERE id = ?"
        )
        .get(changeSetId);

      if (!row) {
        throw new Error(`ChangeSet ${changeSetId} not found`);
      }

      const currentStatus = row.status as string;

      // Check circuit breaker BEFORE looking up the normal transition
      if (
        trigger === CIRCUIT_BREAKER_TRIGGER &&
        currentStatus === CIRCUIT_BREAKER_FROM
      ) {
        const cycleCount = this.countCycles(changeSetId);
        if (cycleCount >= CIRCUIT_BREAKER_THRESHOLD) {
          const ts = new Date().toISOString();
          this.db.run(
            "UPDATE change_sets SET status = 'escalated', updated_at = ? WHERE id = ?",
            [ts, changeSetId]
          );
          this.writeCheckpoint(
            changeSetId,
            currentStatus,
            "escalated",
            trigger,
            options.metadata
          );
          // Return the error; throw AFTER the transaction commits
          return {
            newStatus: "escalated",
            circuitBreakerError: new CircuitBreakerError(changeSetId, cycleCount + 1),
          };
        }
      }

      const def = findTransition(currentStatus as any, trigger);
      if (!def) {
        throw new InvalidTransitionError(currentStatus, trigger);
      }

      const ts = new Date().toISOString();

      if (def.to === "merged") {
        this.db.run(
          "UPDATE change_sets SET status = ?, updated_at = ?, merged_at = ? WHERE id = ?",
          [def.to, ts, ts, changeSetId]
        );
      } else {
        this.db.run(
          "UPDATE change_sets SET status = ?, updated_at = ? WHERE id = ?",
          [def.to, ts, changeSetId]
        );
      }

      this.writeCheckpoint(
        changeSetId,
        currentStatus,
        def.to,
        trigger,
        options.metadata
      );

      return { newStatus: def.to };
    });

    const { newStatus, circuitBreakerError } = run();

    this.sse?.emit({
      type: "change_set_updated",
      payload: {
        changeSetId,
        status: newStatus,
        trigger,
        ts: new Date().toISOString(),
      },
      ts: new Date().toISOString(),
    });

    // Throw circuit breaker error AFTER committing the escalated state
    if (circuitBreakerError) throw circuitBreakerError;

    return newStatus;
  }

  getHistory(changeSetId: string): CheckpointRow[] {
    return this.db
      .query<CheckpointRow, [string]>(
        "SELECT * FROM fsm_checkpoints WHERE change_set_id = ? ORDER BY ts ASC"
      )
      .all(changeSetId);
  }

  private countCycles(changeSetId: string): number {
    const row = this.db
      .query<{ n: number }, [string, string, string]>(
        `SELECT COUNT(*) as n FROM fsm_checkpoints
         WHERE change_set_id = ? AND from_status = ? AND to_status = ?`
      )
      .get(changeSetId, CIRCUIT_BREAKER_FROM, CIRCUIT_BREAKER_TO_NORMAL);
    return row?.n ?? 0;
  }

  private writeCheckpoint(
    changeSetId: string,
    fromStatus: string,
    toStatus: string,
    trigger: string,
    metadata?: Record<string, unknown>
  ): void {
    this.db.run(
      `INSERT INTO fsm_checkpoints
         (id, change_set_id, from_status, to_status, trigger, ts, metadata)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        randomUUID(),
        changeSetId,
        fromStatus,
        toStatus,
        trigger,
        new Date().toISOString(),
        metadata ? JSON.stringify(metadata) : null,
      ]
    );
  }
}
