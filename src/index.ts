import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { handleHandoffTask } from "./tools/handoff-task.js";
import { handleCheckStatus } from "./tools/check-status.js";
import { handleGetResult } from "./tools/get-result.js";
import { handleListAgents } from "./tools/list-agents.js";
import { handleRegisterAgent } from "./tools/register-agent.js";
import { handleCancelTask } from "./tools/cancel-task.js";
import { handleRegisterWorker } from "./tools/register-worker.js";
import { handlePullTask } from "./tools/pull-task.js";
import { handleSubmitResult } from "./tools/submit-result.js";
import { handleWorkerHeartbeat } from "./tools/worker-heartbeat.js";
import { handleListWorkers } from "./tools/list-workers.js";
import { handleCreateChangeSet } from "./mcp-tools/create-change-set.js";
import { handleSubmitForReview } from "./mcp-tools/submit-for-review.js";
import { handleAddReviewComment } from "./mcp-tools/add-review-comment.js";
import { handleRequestChanges } from "./mcp-tools/request-changes.js";
import { handleApproveChangeSet } from "./mcp-tools/approve-change-set.js";
import { handleGetHandoffContext } from "./mcp-tools/get-handoff-context.js";
import { handleLogDecision } from "./mcp-tools/log-decision.js";
import { handleClaimTask, handleCompleteTask } from "./mcp-tools/claim-task.js";
import { registerSession, heartbeat, disconnectSession } from "./domain/agent-session.js";
import { getDb } from "./db.js";

const server = new McpServer({
  name: "agent-handoff",
  version: "0.1.0",
});

// Tool: handoff_task
server.tool(
  "handoff_task",
  "Hand off a task to another AI coding agent (CLI spawn or A2A protocol). Returns a job ID for tracking.",
  {
    agent: z.enum(["claude", "codex", "gemini", "copilot", "opencode"]).optional().describe("CLI agent to use (spawns local process)"),
    agentUrl: z.string().url().optional().describe("A2A agent endpoint URL (uses A2A protocol)"),
    prompt: z.string().describe("Task description / prompt for the agent"),
    workingDirectory: z.string().optional().describe("Working directory for CLI agents (defaults to cwd)"),
    model: z.string().optional().describe("Model override (agent-specific)"),
    timeoutMs: z.number().optional().describe("Timeout in milliseconds (default: 300000)"),
    spawnMode: z.enum(["headless", "tmux"]).optional().describe("Spawn mode: 'headless' (default) runs as background process, 'tmux' runs in visible tmux pane"),
    pool: z.boolean().optional().describe("If true, queue the task for worker pool pickup instead of direct spawn"),
    requiredCapabilities: z.array(z.string()).optional().describe("Required capabilities for pool jobs; only allowed when pool is true"),
    contextPayload: z.string().optional().describe("Base64-encoded HandoffContext for multi-session task continuation (serialized via serializeContext())"),
    senderSpiffeId: z.string().optional().describe("SPIFFE ID of the sending agent; recorded in the job for future SVID-based envelope verification (not yet enforced)"),
    dodCriteria: z.array(z.object({
      id: z.string().describe("Machine-readable criterion key, e.g. 'tests_pass'"),
      description: z.string().describe("Human-readable description of the criterion"),
      required: z.boolean().optional().describe("Whether this is a required DoD criterion (default: true)"),
    })).optional().describe("Definition of Done criteria for two-phase handshake; receiver must accept all required criteria before task proceeds"),
  },
  async (args) => handleHandoffTask(args)
);

// Tool: check_status
server.tool(
  "check_status",
  "Check the status of a handoff job.",
  {
    jobId: z.string().describe("The job ID returned by handoff_task"),
  },
  async (args) => handleCheckStatus(args)
);

// Tool: get_result
server.tool(
  "get_result",
  "Get the full result of a completed handoff job, including output, files changed, and git diff.",
  {
    jobId: z.string().describe("The job ID returned by handoff_task"),
  },
  async (args) => handleGetResult(args)
);

// Tool: list_agents
server.tool(
  "list_agents",
  "List available AI coding agents (CLI tools on PATH and registered A2A agents).",
  {},
  async () => handleListAgents()
);

// Tool: register_agent
server.tool(
  "register_agent",
  "Register an A2A-compliant agent by its endpoint URL. Fetches and caches the agent card.",
  {
    url: z.string().url().describe("Base URL of the A2A agent (must serve /.well-known/agent.json)"),
    authToken: z.string().optional().describe("Bearer token for authenticated A2A endpoints"),
    authHeaders: z.record(z.string()).optional().describe("Custom auth headers (e.g. API key headers) for A2A requests"),
  },
  async (args) => handleRegisterAgent(args)
);

// Tool: cancel_task
server.tool(
  "cancel_task",
  "Cancel a running handoff job (kills CLI process or cancels A2A task).",
  {
    jobId: z.string().describe("The job ID to cancel"),
  },
  async (args) => handleCancelTask(args)
);

// Tool: register_worker
server.tool(
  "register_worker",
  "Register as a worker in the task pool. Workers can pull tasks and submit results.",
  {
    name: z.string().describe("Worker name (e.g. agent identity)"),
    capabilities: z.array(z.string()).optional().describe("Worker capabilities for task matching"),
  },
  async (args) => handleRegisterWorker(args)
);

// Tool: pull_task
server.tool(
  "pull_task",
  "Pull the next available task from the pool queue. Worker must be registered and idle.",
  {
    workerId: z.string().describe("Your worker ID from register_worker"),
  },
  async (args) => handlePullTask(args)
);

// Tool: submit_result
server.tool(
  "submit_result",
  "Submit the result of a completed task back to the pool.",
  {
    workerId: z.string().describe("Your worker ID"),
    jobId: z.string().describe("The job ID you were assigned"),
    status: z.enum(["completed", "failed"]).describe("Task outcome"),
    output: z.string().optional().describe("Task output / result text"),
    error: z.string().optional().describe("Error message if failed"),
  },
  async (args) => handleSubmitResult(args)
);

// Tool: worker_heartbeat
server.tool(
  "worker_heartbeat",
  "Send a heartbeat to keep your worker registration alive. Workers go offline after 60s without heartbeat.",
  {
    workerId: z.string().describe("Your worker ID"),
  },
  async (args) => handleWorkerHeartbeat(args)
);

// Tool: list_workers
server.tool(
  "list_workers",
  "List all registered workers and their current status.",
  {},
  async () => handleListWorkers()
);

// ChangeSet-aware MCP tools (PRD-007)
server.tool(
  "create_change_set",
  "Create a new ChangeSet for a task, setting up a git worktree and transitioning the FSM to 'planned'. Call this when starting work on a new task that needs its own isolated workspace.",
  {
    taskId: z.string().describe("Task ID (TSK_XXXXXX format) this ChangeSet belongs to"),
    title: z.string().describe("Short human-readable title for the ChangeSet"),
    description: z.string().optional().describe("Longer description of the changes being made"),
    targetBranch: z.string().optional().describe("Branch to merge into (default: main)"),
  },
  async (args) => {
    const db = getDb();
    return handleCreateChangeSet(args, db);
  }
);

server.tool(
  "submit_for_review",
  "Submit a ChangeSet for review, transitioning it from 'implementing' to 'reviewing'. Call this when implementation is complete and ready for agent code review.",
  {
    changeSetId: z.string().describe("ChangeSet ID (chg_XXXXXX) to submit for review"),
  },
  async (args) => {
    const db = getDb();
    return handleSubmitForReview(args, db);
  }
);

server.tool(
  "add_review_comment",
  "Add a review comment to a ChangeSet. Use severity='blocking' for issues that must be fixed before approval, 'advisory' for recommended improvements, 'nit' for minor style suggestions.",
  {
    changeSetId: z.string().describe("ChangeSet ID to add the comment to"),
    body: z.string().describe("The review comment text"),
    severity: z.enum(["blocking", "advisory", "nit"]).describe("Comment severity: 'blocking' prevents approval, 'advisory' is recommended, 'nit' is optional"),
    filePath: z.string().optional().describe("File path the comment refers to (optional)"),
    lineNumber: z.number().optional().describe("Line number the comment refers to (optional)"),
    authorAgent: z.string().optional().describe("Name of the reviewing agent (e.g. 'security_reviewer')"),
    authorRole: z.string().optional().describe("Role of the reviewing agent"),
  },
  async (args) => {
    const db = getDb();
    return handleAddReviewComment(args, db);
  }
);

server.tool(
  "request_changes",
  "Request changes on a ChangeSet, transitioning it from 'reviewing' to 'changes_requested'. Requires at least one blocking review comment to exist. Use this after adding blocking comments.",
  {
    changeSetId: z.string().describe("ChangeSet ID to request changes on"),
    summary: z.string().describe("Summary of why changes are being requested"),
  },
  async (args) => {
    const db = getDb();
    return handleRequestChanges(args, db);
  }
);

server.tool(
  "approve_change_set",
  "Approve a ChangeSet, transitioning it from 'reviewing' to 'approved'. Use this only when all blocking issues are resolved and the implementation meets the acceptance criteria.",
  {
    changeSetId: z.string().describe("ChangeSet ID to approve"),
    summary: z.string().describe("Summary of the review outcome and why the ChangeSet is approved"),
  },
  async (args) => {
    const db = getDb();
    return handleApproveChangeSet(args, db);
  }
);

server.tool(
  "get_handoff_context",
  "Retrieve a structured, token-budget-enforced context payload for a ChangeSet and role. Returns spec, diff, acceptance criteria, blocking comments, and architecture context. Use before starting work on a ChangeSet.",
  {
    changeSetId: z.string().describe("ChangeSet ID to get context for"),
    role: z.string().describe("Your agent role (planner, implementer, reviewer, security_reviewer, architecture_reviewer, fixer, test_agent, summarizer)"),
  },
  async (args) => {
    const db = getDb();
    return handleGetHandoffContext(args, db);
  }
);

server.tool(
  "log_decision",
  "Record an architectural or implementation decision made during a task. Use this to document why a choice was made, what alternatives were considered, and any sources consulted.",
  {
    taskId: z.string().describe("Task ID (TSK_XXXXXX) this decision belongs to"),
    changeSetId: z.string().describe("ChangeSet ID (chg_XXXXXX) this decision belongs to"),
    topic: z.string().describe("Short topic / title for the decision (e.g. 'Database library choice')"),
    optionsConsidered: z.array(z.string()).describe("List of options that were considered"),
    choice: z.string().describe("The option that was chosen"),
    rationale: z.string().describe("Why this option was chosen"),
    sourcesCited: z.array(z.string()).optional().describe("URLs or document references supporting the decision"),
    authorAgent: z.string().optional().describe("Name of the agent making the decision (omit for human entries)"),
  },
  async (args) => {
    const db = getDb();
    return handleLogDecision(args as Record<string, unknown>, db);
  }
);

// Tool: register_session — pre-spawned agent announces itself
server.tool(
  "register_session",
  "Register this agent as a pre-spawned session available for task dispatch. Call once at startup, then poll claim_task to receive work.",
  {
    tool: z.enum(["claude-code", "codex", "cursor", "copilot-cli", "gemini", "aider", "human"]).describe("This agent's tool identifier"),
    roles: z.array(z.string()).optional().describe("Roles this session can handle (empty = any role)"),
  },
  async (args) => {
    const db = getDb();
    const session = registerSession(db, args.tool, args.roles ?? []);
    return mcpText({ sessionId: session.id, status: session.status, message: "Registered. Poll claim_task with this sessionId to receive work." });
  }
);

// Tool: claim_task — agent polls to pick up queued work
server.tool(
  "claim_task",
  "Poll for a queued task. Returns { claimed: true, changeSetId, role, context } when work is available, or { claimed: false } when idle. Also refreshes the session heartbeat.",
  {
    sessionId: z.string().describe("Session ID returned by register_session"),
  },
  async (args) => {
    const db = getDb();
    return handleClaimTask(args, db);
  }
);

// Tool: complete_task — agent signals it has finished
server.tool(
  "complete_task",
  "Signal that the current task is complete and this session is ready for more work. Transitions session status from busy back to waiting.",
  {
    sessionId: z.string().describe("Session ID returned by register_session"),
  },
  async (args) => {
    const db = getDb();
    return handleCompleteTask(args, db);
  }
);

// Tool: session_heartbeat — keep-alive for pre-spawned sessions
server.tool(
  "session_heartbeat",
  "Send a heartbeat to keep the session alive. Call every 30 seconds. Sessions not heartbeating for >90s are marked disconnected.",
  {
    sessionId: z.string().describe("Session ID to heartbeat"),
  },
  async (args) => {
    const db = getDb();
    const session = heartbeat(db, args.sessionId);
    if (!session) return mcpError({ error: `Session ${args.sessionId} not found` });
    return mcpText({ ok: true, status: session.status });
  }
);

// Tool: disconnect_session — clean shutdown
server.tool(
  "disconnect_session",
  "Mark this session as disconnected (clean shutdown). Call before exiting.",
  {
    sessionId: z.string().describe("Session ID to disconnect"),
  },
  async (args) => {
    const db = getDb();
    disconnectSession(db, args.sessionId);
    return mcpText({ ok: true });
  }
);

function mcpText(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
}
function mcpError(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }], isError: true };
}

// Start server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write("agent-handoff server started\n");
}

main().catch((err) => {
  process.stderr.write(`Fatal error: ${err}\n`);
  process.exit(1);
});
