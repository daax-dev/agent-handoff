import { getJob } from "../job-store.js";
import type { CheckStatusInput } from "../types.js";

export async function handleCheckStatus(args: CheckStatusInput) {
  const job = getJob(args.jobId);
  if (!job) {
    throw new Error(`Job not found: ${args.jobId}`);
  }

  const durationMs = job.startedAt
    ? Date.now() - new Date(job.startedAt).getTime()
    : 0;

  return {
    content: [{
      type: "text" as const,
      text: JSON.stringify({
        jobId: job.id,
        status: job.status,
        transport: job.transport,
        agent: job.agent,
        agentUrl: job.agentUrl,
        durationMs: job.completedAt ? new Date(job.completedAt).getTime() - new Date(job.startedAt!).getTime() : durationMs,
        error: job.error,
      }, null, 2),
    }],
  };
}
