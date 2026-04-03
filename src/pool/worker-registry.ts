import type { Worker, WorkerStatus } from "../types.js";
import { normalizeCapabilities } from "./capabilities.js";

const workers = new Map<string, Worker>();

const HEARTBEAT_TIMEOUT_MS = 60_000; // 60 seconds

function generateWorkerId(): string {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let id = "wkr_";
  for (let i = 0; i < 12; i++) {
    id += chars[Math.floor(Math.random() * chars.length)];
  }
  return id;
}

export function registerWorker(name: string, capabilities: string[] = []): Worker {
  const now = new Date().toISOString();
  const worker: Worker = {
    id: generateWorkerId(),
    name,
    capabilities: normalizeCapabilities(capabilities),
    status: "idle",
    registeredAt: now,
    lastHeartbeatAt: now,
  };
  workers.set(worker.id, worker);
  return worker;
}

export function deregisterWorker(workerId: string): boolean {
  return workers.delete(workerId);
}

export function getWorker(workerId: string): Worker | undefined {
  const worker = workers.get(workerId);
  if (worker) {
    // Check if stale
    const elapsed = Date.now() - new Date(worker.lastHeartbeatAt).getTime();
    if (elapsed > HEARTBEAT_TIMEOUT_MS && worker.status !== "offline") {
      worker.status = "offline";
    }
  }
  return worker;
}

export function getIdleWorkers(capability?: string): Worker[] {
  return Array.from(workers.values()).filter((w) => {
    if (w.status !== "idle") return false;
    // Check heartbeat freshness
    const elapsed = Date.now() - new Date(w.lastHeartbeatAt).getTime();
    if (elapsed > HEARTBEAT_TIMEOUT_MS) {
      w.status = "offline";
      return false;
    }
    if (capability && !w.capabilities.includes(capability)) return false;
    return true;
  });
}

export function heartbeat(workerId: string): Worker | undefined {
  const worker = workers.get(workerId);
  if (!worker) return undefined;
  worker.lastHeartbeatAt = new Date().toISOString();
  if (worker.status === "offline") {
    worker.status = worker.currentJobId ? "busy" : "idle";
  }
  return worker;
}

export function assignJob(workerId: string, jobId: string): boolean {
  const worker = workers.get(workerId);
  if (!worker || worker.status !== "idle") return false;
  worker.status = "busy";
  worker.currentJobId = jobId;
  return true;
}

export function completeJob(workerId: string): boolean {
  const worker = workers.get(workerId);
  if (!worker) return false;
  worker.status = "idle";
  worker.currentJobId = undefined;
  worker.lastHeartbeatAt = new Date().toISOString();
  return true;
}

export function listWorkers(): Worker[] {
  // Refresh statuses before returning
  for (const worker of workers.values()) {
    const elapsed = Date.now() - new Date(worker.lastHeartbeatAt).getTime();
    if (elapsed > HEARTBEAT_TIMEOUT_MS && worker.status !== "offline") {
      worker.status = "offline";
    }
  }
  return Array.from(workers.values());
}

/**
 * Test-only helper to reset in-memory worker registry between test cases.
 */
export function clearWorkers(): void {
  workers.clear();
}
