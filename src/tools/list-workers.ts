import { listWorkers } from "../pool/worker-registry.js";

export async function handleListWorkers() {
  const workers = listWorkers();

  return {
    content: [{
      type: "text" as const,
      text: JSON.stringify({
        total: workers.length,
        idle: workers.filter((w) => w.status === "idle").length,
        busy: workers.filter((w) => w.status === "busy").length,
        offline: workers.filter((w) => w.status === "offline").length,
        workers: workers.map((w) => ({
          id: w.id,
          name: w.name,
          status: w.status,
          capabilities: w.capabilities,
          currentJobId: w.currentJobId,
          lastHeartbeatAt: w.lastHeartbeatAt,
        })),
      }, null, 2),
    }],
  };
}
