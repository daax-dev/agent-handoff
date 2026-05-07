import type { Database } from "bun:sqlite";
import { randomUUID } from "node:crypto";

export type SessionStatus = "waiting" | "busy" | "done" | "disconnected";

export interface AgentSession {
  id: string;
  tool: string;
  roles: string[];
  status: SessionStatus;
  connected_at: string;
  last_heartbeat: string;
  current_change_set_id: string | null;
}

interface RawRow {
  id: string;
  tool: string;
  roles: string;
  status: string;
  connected_at: string;
  last_heartbeat: string;
  current_change_set_id: string | null;
}

function toSession(row: RawRow): AgentSession {
  return {
    ...row,
    roles: JSON.parse(row.roles || "[]"),
    status: row.status as SessionStatus,
  };
}

const HEARTBEAT_TIMEOUT_MS = 90_000;

export function registerSession(db: Database, tool: string, roles: string[]): AgentSession {
  const id = randomUUID();
  const now = new Date().toISOString();
  db.run(
    `INSERT INTO agent_sessions (id, tool, roles, status, connected_at, last_heartbeat)
     VALUES (?, ?, ?, 'waiting', ?, ?)`,
    [id, tool, JSON.stringify(roles), now, now]
  );
  return getSession(db, id)!;
}

export function heartbeat(db: Database, sessionId: string): AgentSession | null {
  const now = new Date().toISOString();
  db.run(
    "UPDATE agent_sessions SET last_heartbeat = ?, status = CASE WHEN status = 'disconnected' THEN 'waiting' ELSE status END WHERE id = ?",
    [now, sessionId]
  );
  return getSession(db, sessionId);
}

export function markBusy(db: Database, sessionId: string, changeSetId: string): void {
  db.run(
    "UPDATE agent_sessions SET status = 'busy', current_change_set_id = ? WHERE id = ?",
    [changeSetId, sessionId]
  );
}

export function markWaiting(db: Database, sessionId: string): void {
  db.run(
    "UPDATE agent_sessions SET status = 'waiting', current_change_set_id = NULL WHERE id = ?",
    [sessionId]
  );
}

export function disconnectSession(db: Database, sessionId: string): void {
  db.run("UPDATE agent_sessions SET status = 'disconnected' WHERE id = ?", [sessionId]);
}

export function getSession(db: Database, id: string): AgentSession | null {
  const row = db.query<RawRow, [string]>("SELECT * FROM agent_sessions WHERE id = ?").get(id);
  return row ? toSession(row) : null;
}

export function listSessions(db: Database, includeRecent = true): AgentSession[] {
  // Include disconnected sessions from last 5 minutes so devs can see what crashed
  const cutoff = new Date(Date.now() - 5 * 60_000).toISOString();
  const rows = db
    .query<RawRow, []>(
      `SELECT * FROM agent_sessions
       WHERE status != 'disconnected' OR last_heartbeat > '${cutoff}'
       ORDER BY connected_at DESC`
    )
    .all();

  // Auto-mark timed-out sessions
  const now = Date.now();
  for (const row of rows) {
    if (row.status !== "disconnected" && now - new Date(row.last_heartbeat).getTime() > HEARTBEAT_TIMEOUT_MS) {
      db.run("UPDATE agent_sessions SET status = 'disconnected' WHERE id = ?", [row.id]);
      row.status = "disconnected";
    }
  }

  return rows.map(toSession);
}

export function findWaitingSession(db: Database, tool: string, role: string): AgentSession | null {
  const rows = db
    .query<RawRow, [string]>(
      "SELECT * FROM agent_sessions WHERE tool = ? AND status = 'waiting' ORDER BY last_heartbeat DESC LIMIT 10"
    )
    .all(tool);

  for (const row of rows) {
    const roles: string[] = JSON.parse(row.roles || "[]");
    if (roles.length === 0 || roles.includes(role)) {
      return toSession(row);
    }
  }
  return null;
}
