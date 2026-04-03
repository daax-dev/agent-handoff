import { dequeueByPredicate } from "../pool/job-queue.js";
import { getWorker, assignJob } from "../pool/worker-registry.js";
import { getJob, updateJob } from "../job-store.js";
import { workerMatchesRequiredCapabilities } from "../pool/capabilities.js";
import { logHandoffEvent } from "../utils/logger.js";
import type { PullTaskInput } from "../types.js";

export async function handlePullTask(args: PullTaskInput) {
  const worker = getWorker(args.workerId);
  if (!worker) {
    throw new Error(`Worker not found: ${args.workerId}`);
  }
  if (worker.status !== "idle") {
    throw new Error(`Worker ${args.workerId} is not idle (status: ${worker.status})`);
  }

  const jobId = dequeueByPredicate((queuedJobId) => {
    const queuedJob = getJob(queuedJobId);
    if (!queuedJob || queuedJob.status !== "queued") {
      return false;
    }
    return workerMatchesRequiredCapabilities(worker.capabilities, queuedJob.requiredCapabilities);
  });
  if (!jobId) {
    return {
      content: [{
        type: "text" as const,
        text: JSON.stringify({ available: false, message: "No compatible tasks in queue" }, null, 2),
      }],
    };
  }

  const job = getJob(jobId);
  if (!job || job.status !== "queued") {
    return {
      content: [{
        type: "text" as const,
        text: JSON.stringify({ available: false, message: job ? "Job is no longer queued" : "Queued job no longer exists" }, null, 2),
      }],
    };
  }

  assignJob(args.workerId, jobId);
  updateJob(jobId, { status: "running", startedAt: new Date().toISOString() });

  logHandoffEvent({
    timestamp: new Date().toISOString(),
    event: "pool_assigned",
    jobId,
    transport: "pool",
    workerId: args.workerId,
    workerName: worker.name,
    prompt: job.prompt,
    workingDirectory: job.workingDirectory,
  });

  return {
    content: [{
      type: "text" as const,
      text: JSON.stringify({
        available: true,
        jobId: job.id,
        prompt: job.prompt,
        workingDirectory: job.workingDirectory,
        model: job.model,
        requiredCapabilities: job.requiredCapabilities ?? [],
        timeoutMs: job.timeoutMs,
      }, null, 2),
    }],
  };
}
