import { createJob } from "../job-store.js";
import { runCliJob, runA2AJob } from "../job-runner.js";
import { isAgentAvailable } from "../cli/registry.js";
import { getRegisteredAgent } from "../a2a/agent-card.js";
import { enqueue } from "../pool/job-queue.js";
import { normalizeCapabilities } from "../pool/capabilities.js";
import { logHandoffEvent } from "../utils/logger.js";
import type { HandoffTaskInput } from "../types.js";

export async function handleHandoffTask(args: HandoffTaskInput) {
  if (!args.agent && !args.agentUrl) {
    throw new Error("Either 'agent' or 'agentUrl' must be provided");
  }
  if (args.agent && args.agentUrl) {
    throw new Error("Provide either 'agent' or 'agentUrl', not both");
  }

  if (args.agent && !isAgentAvailable(args.agent)) {
    throw new Error(`Agent '${args.agent}' is not available on PATH. Run list_agents to see available agents.`);
  }

  const requiredCapabilities = normalizeCapabilities(args.requiredCapabilities);
  if (!args.pool && requiredCapabilities.length > 0) {
    throw new Error("'requiredCapabilities' can only be provided when 'pool' is true");
  }

  const transport = args.pool ? "pool" : args.agent ? "cli" : "a2a";

  // Resolve auth headers from registered agent card (if A2A)
  let authHeaders: Record<string, string> | undefined;
  if (args.agentUrl) {
    const registered = getRegisteredAgent(args.agentUrl);
    if (registered?.authHeaders) {
      authHeaders = registered.authHeaders;
    }
  }

  const job = createJob({
    transport,
    agent: args.agent,
    agentUrl: args.agentUrl,
    prompt: args.prompt,
    workingDirectory: args.workingDirectory,
    model: args.model,
    spawnMode: args.spawnMode,
    requiredCapabilities: requiredCapabilities.length > 0 ? requiredCapabilities : undefined,
    timeoutMs: args.timeoutMs,
    authHeaders,
  });

  logHandoffEvent({
    timestamp: new Date().toISOString(),
    event: "task_created",
    jobId: job.id,
    transport,
    agent: args.agent,
    agentUrl: args.agentUrl,
    prompt: args.prompt,
    model: args.model,
    workingDirectory: args.workingDirectory,
    spawnMode: args.spawnMode,
  });

  // Pool mode: enqueue for worker pickup instead of spawning
  if (args.pool) {
    enqueue(job.id);
    logHandoffEvent({
      timestamp: new Date().toISOString(),
      event: "pool_enqueued",
      jobId: job.id,
      transport: "pool",
      prompt: args.prompt,
    });
    return {
      content: [{
        type: "text" as const,
        text: JSON.stringify({ jobId: job.id, status: job.status, transport: "pool", mode: "pool" }, null, 2),
      }],
    };
  }

  // Run async (don't await)
  if (transport === "cli") {
    runCliJob(job).catch(() => {});
  } else {
    runA2AJob(job).catch(() => {});
  }

  return {
    content: [{
      type: "text" as const,
      text: JSON.stringify({ jobId: job.id, status: job.status, transport }, null, 2),
    }],
  };
}
