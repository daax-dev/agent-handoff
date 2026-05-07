import type { Database } from "bun:sqlite";
import { getAssignment } from "../domain/agent-assignment.js";
import { markBusy, listSessions } from "../domain/agent-session.js";
import { HandoffContextBuilder } from "../context/handoff-context.js";
import { AgentRoleRegistry } from "../roles/registry.js";
import { spawnAgent, isToolSpawnable } from "./spawner.js";
import { dispatchToSession } from "./dispatcher.js";

export type OrchestratorResult =
  | { mode: "dispatched"; sessionId: string }
  | { mode: "spawned"; pid: number; handoffPath: string }
  | { mode: "hitl" }
  | { mode: "skipped"; reason: string };

export interface OrchestratorOptions {
  workRoot?: string;
  repoRoot?: string;
}

export class AgentOrchestrator {
  private db: Database;
  private workRoot: string;
  private repoRoot: string;

  constructor(db: Database, opts: OrchestratorOptions = {}) {
    this.db = db;
    this.workRoot = opts.workRoot ?? process.env.WORK_ROOT ?? ".work";
    this.repoRoot = opts.repoRoot ?? process.cwd();
  }

  async run(changeSetId: string, fsmState: string, role: string): Promise<OrchestratorResult> {
    // Guard: skip if this role is already handled for this change set
    // Multiple roles CAN run simultaneously on the same ChangeSet (multi-agent).
    const activeSessions = listSessions(this.db);
    const alreadyRunning = activeSessions.find(
      (s) =>
        s.current_change_set_id === changeSetId &&
        s.status === "busy" &&
        (s.roles.length === 0 || s.roles.includes(role))
    );
    if (alreadyRunning) {
      return { mode: "skipped", reason: `Session ${alreadyRunning.id} already busy on ${changeSetId} as ${role}` };
    }

    const assignment = getAssignment(this.db, fsmState, role);
    if (!assignment || !assignment.enabled) {
      return { mode: "skipped", reason: `No enabled assignment for ${fsmState}/${role}` };
    }

    const { tool } = assignment;

    if (tool === "human") {
      return { mode: "hitl" };
    }

    // Build handoff context
    const registry = new AgentRoleRegistry(this.repoRoot);
    const builder = new HandoffContextBuilder(this.db, this.repoRoot, registry);
    let handoffContent: string;
    try {
      const payload = await builder.build(changeSetId, role);
      handoffContent = formatHandoffMarkdown(changeSetId, role, payload);
    } catch (e) {
      handoffContent = `# Handoff: ${changeSetId} — ${role}\n\nContext build failed: ${e instanceof Error ? e.message : String(e)}`;
    }

    // Mode B: prefer pre-spawned session
    const dispatch = dispatchToSession(this.db, tool, role, changeSetId);
    if (dispatch.dispatched) {
      markBusy(this.db, dispatch.sessionId, changeSetId);
      return { mode: "dispatched", sessionId: dispatch.sessionId };
    }

    // Mode A: on-demand spawn
    if (isToolSpawnable(tool)) {
      const result = spawnAgent(tool, {
        changeSetId,
        role,
        handoffContent,
        workRoot: this.workRoot,
      });
      return { mode: "spawned", pid: result.pid, handoffPath: result.handoffPath };
    }

    return { mode: "skipped", reason: `Tool ${tool} is not spawnable and no waiting session found` };
  }
}

function formatHandoffMarkdown(
  changeSetId: string,
  role: string,
  payload: { taskSpec: string; diff: string; acceptanceCriteria: string; blockingComments: string; architectureContext: string; rolePrompt: string }
): string {
  return [
    `# Handoff Context`,
    ``,
    `**ChangeSet**: ${changeSetId}  `,
    `**Role**: ${role}`,
    ``,
    `## Role Prompt`,
    payload.rolePrompt,
    ``,
    `## Task Specification`,
    payload.taskSpec,
    ``,
    `## Acceptance Criteria`,
    payload.acceptanceCriteria,
    ``,
    `## Diff`,
    "```diff",
    payload.diff,
    "```",
    ``,
    `## Blocking Comments`,
    payload.blockingComments,
    ``,
    `## Architecture Context`,
    payload.architectureContext,
  ].join("\n");
}
