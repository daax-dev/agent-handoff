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

  // Token usage / cost, when extracted from the agent's structured output.
  if (job.inputTokens != null) result.inputTokens = job.inputTokens;
  if (job.outputTokens != null) result.outputTokens = job.outputTokens;
  if (job.estimatedCostUsd != null) result.estimatedCostUsd = job.estimatedCostUsd;

  // Surface secret findings for "secret-blocked" jobs so callers can act on
  // them. Stored findings are already redacted (no raw secret value).
  if (job.findings && job.findings.length > 0) {
    result.findings = job.findings;
  }

  if (job.error) result.error = job.error;

  return {
    content: [{
      type: "text" as const,
      text: JSON.stringify(result, null, 2),
    }],
  };
}
