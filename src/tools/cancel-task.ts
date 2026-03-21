import { cancelJob } from "../job-runner.js";
import { getJob } from "../job-store.js";
import { logHandoffEvent } from "../utils/logger.js";
import type { CancelTaskInput } from "../types.js";

export async function handleCancelTask(args: CancelTaskInput) {
  const job = getJob(args.jobId);
  if (!job) {
    throw new Error(`Job not found: ${args.jobId}`);
  }

  const success = await cancelJob(args.jobId);

  if (success) {
    logHandoffEvent({
      timestamp: new Date().toISOString(),
      event: "task_cancelled",
      jobId: args.jobId,
      transport: job.transport,
      agent: job.agent,
      agentUrl: job.agentUrl,
    });
  }

  return {
    content: [{
      type: "text" as const,
      text: JSON.stringify({
        jobId: args.jobId,
        success,
        status: success ? "cancelled" : job.status,
        message: success ? "Job cancelled successfully" : `Cannot cancel job in '${job.status}' state`,
      }, null, 2),
    }],
  };
}
