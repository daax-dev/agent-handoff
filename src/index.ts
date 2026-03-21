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

const server = new McpServer({
  name: "agent-handoff",
  version: "0.1.0",
});

// Tool: handoff_task
server.tool(
  "handoff_task",
  "Hand off a task to another AI coding agent (CLI spawn or A2A protocol). Returns a job ID for tracking.",
  {
    agent: z.enum(["claude", "codex", "gemini", "copilot", "opencode", "aider"]).optional().describe("CLI agent to use (spawns local process)"),
    agentUrl: z.string().url().optional().describe("A2A agent endpoint URL (uses A2A protocol)"),
    prompt: z.string().describe("Task description / prompt for the agent"),
    workingDirectory: z.string().optional().describe("Working directory for CLI agents (defaults to cwd)"),
    model: z.string().optional().describe("Model override (agent-specific)"),
    timeoutMs: z.number().optional().describe("Timeout in milliseconds (default: 300000)"),
    spawnMode: z.enum(["headless", "tmux"]).optional().describe("Spawn mode: 'headless' (default) runs as background process, 'tmux' runs in visible tmux pane"),
    pool: z.boolean().optional().describe("If true, queue the task for worker pool pickup instead of direct spawn"),
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
