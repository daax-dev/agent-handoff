/**
 * preWarmSessions — Phase 1 of auto-warm session pool (Issue #21).
 *
 * This function is called fire-and-forget after a ChangeSet is created.
 * It checks which agent_assignments have auto_launch=1 and, for each,
 * ensures a waiting session exists for that tool.
 *
 * NOTE: The current spawnAgent() in spawner.ts is task-bound (requires
 * changeSetId, role, and handoffContent) and spawns a one-shot CLI process
 * that exits when the task completes.  A true warm-pool agent would need to
 * be a long-running process that registers itself via POST /api/agent-sessions,
 * polls for queued_change_set_id, and only then starts working.  That
 * infrastructure does not yet exist, so pre-warming is stubbed here.
 *
 * When warm-pool agent processes are available, replace the TODO block below
 * with an actual spawn that launches the long-running agent in the background.
 *
 * The existing Mode B dispatch path (dispatchToSession in orchestrator/index.ts)
 * already picks up waiting sessions registered by any means — so manually
 * pre-registered sessions or future warm-pool agents will be preferred over
 * on-demand Mode A spawning automatically.
 *
 * Issue note: the spec mentions matching on tool+model, but agent_sessions has
 * no model column — matching is done on tool only (per findWaitingSession).
 */

import type { Database } from "bun:sqlite";
import { findWaitingSession } from "../domain/agent-session.js";

interface AutoLaunchRow {
  tool: string;
  role: string;
  fsm_state: string;
}

/**
 * Fire-and-forget: for every assignment with auto_launch=1, ensure a waiting
 * session exists.  Never throws — all errors are caught and logged.
 */
export function preWarmSessions(db: Database, _changeSetId: string): void {
  // Deliberately async-free and fire-and-forget
  try {
    const assignments = db
      .query<AutoLaunchRow, []>(
        "SELECT tool, role, fsm_state FROM agent_assignments WHERE auto_launch = 1 AND enabled = 1"
      )
      .all();

    for (const { tool, role, fsm_state } of assignments) {
      try {
        const existing = findWaitingSession(db, tool, role);
        if (existing) {
          // A waiting session is already available — nothing to do
          continue;
        }

        // TODO(#21): spawn a long-running warm-pool agent process for this tool.
        // The agent process must:
        //   1. Start up (e.g. `claude --dangerously-skip-permissions`)
        //   2. Register itself via POST /api/agent-sessions with { tool, roles: [] }
        //   3. Send heartbeats every ~30s via POST /api/agent-sessions/:id/heartbeat
        //   4. Poll for queued work via GET /api/agent-sessions/:id
        //   5. When queued_change_set_id is set (Mode B dispatch), begin the task
        //   6. On completion, call markWaiting() and go back to step 3
        // Until this warm-pool agent process exists, spawnAgent() cannot be reused
        // here because it is one-shot (exits after the task) and task-bound
        // (requires a concrete changeSetId and handoff file up-front).
        console.log(
          `[auto-warm] no waiting session for ${tool}/${role} (fsm_state=${fsm_state}) — ` +
          `would pre-spawn (TODO: requires long-running warm-pool agent process)`
        );
      } catch (innerErr) {
        console.error(
          `[auto-warm] error checking session for ${tool}/${role}:`,
          innerErr instanceof Error ? innerErr.message : String(innerErr)
        );
      }
    }
  } catch (err) {
    console.error(
      "[auto-warm] preWarmSessions failed (non-fatal):",
      err instanceof Error ? err.message : String(err)
    );
  }
}
