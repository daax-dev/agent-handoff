import { heartbeat, getWorker } from "../pool/worker-registry.js";
import { logHandoffEvent } from "../utils/logger.js";
import type { WorkerHeartbeatInput } from "../types.js";

export async function handleWorkerHeartbeat(args: WorkerHeartbeatInput) {
  // Snapshot pre-heartbeat state to detect first heartbeat
  // (registeredAt === lastHeartbeatAt only before first heartbeat call)
  const preWorker = getWorker(args.workerId);
  const isFirstHeartbeat =
    preWorker != null &&
    preWorker.registeredAt === preWorker.lastHeartbeatAt;

  const worker = heartbeat(args.workerId);
  if (!worker) {
    throw new Error(`Worker not found: ${args.workerId}`);
  }

  if (isFirstHeartbeat) {
    logHandoffEvent({
      timestamp: new Date().toISOString(),
      event: "worker_first_heartbeat",
      workerId: worker.id,
      workerName: worker.name,
    });
  }

  return {
    content: [{
      type: "text" as const,
      text: JSON.stringify({
        workerId: worker.id,
        status: worker.status,
        currentJobId: worker.currentJobId,
        lastHeartbeatAt: worker.lastHeartbeatAt,
      }, null, 2),
    }],
  };
}
