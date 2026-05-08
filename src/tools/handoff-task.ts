import { createJob, updateJob, snapshotJob, rollbackJob } from "../job-store.js";
import { runCliJob, runA2AJob } from "../job-runner.js";
import { isAgentAvailable } from "../cli/registry.js";
import { getRegisteredAgent } from "../a2a/agent-card.js";
import { enqueue } from "../pool/job-queue.js";
import { normalizeCapabilities } from "../pool/capabilities.js";
import { logHandoffEvent } from "../utils/logger.js";
import type { HandoffTaskInput } from "../types.js";
import { deserializeContext } from "../handoff-context.js";
import {
  createProposal,
  executeHandshake,
} from "../a2a/handshake.js";
import {
  withHandshakeRetry,
  DEFAULT_RETRY_POLICY,
} from "../a2a/retry.js";

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

  // Issue #18: validate context payload if provided
  if (args.contextPayload) {
    try {
      deserializeContext(args.contextPayload);
    } catch (err) {
      throw new Error(
        `Invalid contextPayload: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
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
    contextPayload: args.contextPayload,
    senderSpiffeId: args.senderSpiffeId,
  });

  // Capture pre-handshake snapshot for rollback (#6)
  snapshotJob(job.id);

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

  // Issue #19: two-phase handshake when DoD criteria are provided
  if (args.dodCriteria && args.dodCriteria.length > 0) {
    const proposal = createProposal({
      senderJobId: job.id,
      prompt: args.prompt,
      contextPayload: args.contextPayload,
      dodCriteria: args.dodCriteria.map((c) => ({
        id: c.id,
        description: c.description,
        required: c.required ?? true,
      })),
    });

    updateJob(job.id, { handshakeStatus: "pending" });

    logHandoffEvent({
      timestamp: new Date().toISOString(),
      event: "handshake_proposed",
      jobId: job.id,
      transport,
    });

    const receiverCapabilitiesEnv = process.env.RECEIVER_CAPABILITIES;

    if (!receiverCapabilitiesEnv) {
      // RECEIVER_CAPABILITIES not configured: this is an outbound proposal to a remote
      // receiver that will evaluate the DoD criteria itself. Accept locally and proceed.
      updateJob(job.id, { handshakeStatus: "accepted" });

      logHandoffEvent({
        timestamp: new Date().toISOString(),
        event: "handshake_accepted",
        jobId: job.id,
        transport,
      });
    } else {
      const receiverCapabilities = receiverCapabilitiesEnv
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);

      const { response, retryCount, retryExhausted } = await withHandshakeRetry(
        () => executeHandshake(proposal, receiverCapabilities),
        DEFAULT_RETRY_POLICY,
        async (retryNumber, delayMs) => {
          rollbackJob(job.id);
          updateJob(job.id, { handshakeStatus: "pending", retryCount: retryNumber });
          logHandoffEvent({
            timestamp: new Date().toISOString(),
            event: "handshake_retry",
            jobId: job.id,
            transport,
          });
          void delayMs; // consumed by withHandshakeRetry
        },
      );

      updateJob(job.id, {
        retryCount,
        maxRetries: DEFAULT_RETRY_POLICY.maxAttempts - 1,
      });

      if (!response.accepted) {
        updateJob(job.id, {
          status: "failed",
          handshakeStatus: "rejected",
          handshakeRejectionReason: response.reason,
          completedAt: new Date().toISOString(),
          retryExhausted,
          error: retryExhausted
            ? `Handshake retry exhausted (${retryCount} retries): ${response.reason}`
            : `Handshake rejected: ${response.reason}${response.detail ? ` — ${response.detail}` : ""}`,
        });

        logHandoffEvent({
          timestamp: new Date().toISOString(),
          event: "handshake_rejected",
          jobId: job.id,
          transport,
          error: response.reason,
        });

        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify(
              {
                jobId: job.id,
                status: "failed",
                handshakeStatus: "rejected",
                reason: response.reason,
                detail: response.detail,
                retryCount,
                retryExhausted,
              },
              null,
              2,
            ),
          }],
        };
      }

      updateJob(job.id, { handshakeStatus: "accepted" });

      logHandoffEvent({
        timestamp: new Date().toISOString(),
        event: "handshake_accepted",
        jobId: job.id,
        transport,
      });
    }
  }

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
