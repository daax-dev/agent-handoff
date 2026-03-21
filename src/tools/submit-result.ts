import { completeJob, getWorker } from "../pool/worker-registry.js";
import { getJob, updateJob } from "../job-store.js";
import { logHandoffEvent } from "../utils/logger.js";
import type { SubmitResultInput } from "../types.js";

export async function handleSubmitResult(args: SubmitResultInput) {
  const worker = getWorker(args.workerId);
  if (!worker) {
    throw new Error(`Worker not found: ${args.workerId}`);
  }

  const job = getJob(args.jobId);
  if (!job) {
    throw new Error(`Job not found: ${args.jobId}`);
  }

  if (worker.currentJobId !== args.jobId) {
    throw new Error(`Worker ${args.workerId} is not assigned to job ${args.jobId}`);
  }

  const completedAt = new Date().toISOString();
  const durationMs = job.startedAt ? Date.now() - new Date(job.startedAt).getTime() : 0;

  updateJob(args.jobId, {
    status: args.status,
    completedAt,
    stdout: args.output,
    error: args.error,
  });

  completeJob(args.workerId);

  logHandoffEvent({
    timestamp: completedAt,
    event: "pool_submitted",
    jobId: args.jobId,
    transport: "pool",
    workerId: args.workerId,
    workerName: worker.name,
    status: args.status,
    durationMs,
    error: args.error,
  });

  return {
    content: [{
      type: "text" as const,
      text: JSON.stringify({
        acknowledged: true,
        jobId: args.jobId,
        workerStatus: "idle",
      }, null, 2),
    }],
  };
}
