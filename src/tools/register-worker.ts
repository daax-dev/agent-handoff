import { registerWorker } from "../pool/worker-registry.js";
import { logHandoffEvent } from "../utils/logger.js";
import type { RegisterWorkerInput } from "../types.js";

export async function handleRegisterWorker(args: RegisterWorkerInput) {
  const worker = registerWorker(args.name, args.capabilities);

  logHandoffEvent({
    timestamp: new Date().toISOString(),
    event: "worker_registered",
    workerId: worker.id,
    workerName: worker.name,
  });

  return {
    content: [{
      type: "text" as const,
      text: JSON.stringify({
        workerId: worker.id,
        name: worker.name,
        status: worker.status,
        capabilities: worker.capabilities,
        message: "Worker registered. Use pull_task to get work, worker_heartbeat to stay alive.",
      }, null, 2),
    }],
  };
}
