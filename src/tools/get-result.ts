import { getJob } from "../job-store.js";
import type { GetResultInput } from "../types.js";

export async function handleGetResult(args: GetResultInput) {
  const job = getJob(args.jobId);
  if (!job) {
    throw new Error(`Job not found: ${args.jobId}`);
  }

  if (job.status === "queued" || job.status === "running") {
    return {
      content: [{
        type: "text" as const,
        text: JSON.stringify({ jobId: job.id, status: job.status, message: "Job is still in progress. Use check_status to poll." }, null, 2),
      }],
    };
  }

  const result: Record<string, unknown> = {
    jobId: job.id,
    status: job.status,
    transport: job.transport,
  };

  if (job.transport === "cli") {
    result.exitCode = job.exitCode;
    result.stdout = job.stdout;
    result.stderr = job.stderr;
    result.filesChanged = job.filesChanged;
    result.diffSummary = job.diffSummary;
  } else {
    result.stdout = job.stdout;
    result.artifacts = job.artifacts;
  }

  if (job.error) result.error = job.error;

  return {
    content: [{
      type: "text" as const,
      text: JSON.stringify(result, null, 2),
    }],
  };
}
