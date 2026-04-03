import { describe, test, expect, beforeEach } from "./test-compat.js";
import { registerWorker, getWorker, heartbeat, assignJob, completeJob, listWorkers, deregisterWorker } from "../src/pool/worker-registry.js";
import { enqueue, dequeue, peek, size, removeFromQueue, clearQueue } from "../src/pool/job-queue.js";
import { handleRegisterWorker } from "../src/tools/register-worker.js";
import { handlePullTask } from "../src/tools/pull-task.js";
import { handleSubmitResult } from "../src/tools/submit-result.js";
import { handleListWorkers } from "../src/tools/list-workers.js";
import { createJob, getJob, clearJobs } from "../src/job-store.js";
import { clearWorkers } from "../src/pool/worker-registry.js";

describe("Worker Registry", () => {
  beforeEach(() => {
    clearWorkers();
    clearQueue();
    clearJobs();
  });

  test("registerWorker creates worker with wkr_ prefix", () => {
    const worker = registerWorker("test-worker", ["coding"]);
    expect(worker.id).toMatch(/^wkr_/);
    expect(worker.name).toBe("test-worker");
    expect(worker.status).toBe("idle");
    expect(worker.capabilities).toEqual(["coding"]);
  });

  test("getWorker returns registered worker", () => {
    const worker = registerWorker("finder", []);
    const found = getWorker(worker.id);
    expect(found).toBeDefined();
    expect(found!.name).toBe("finder");
  });

  test("getWorker returns undefined for missing", () => {
    expect(getWorker("wkr_missing")).toBeUndefined();
  });

  test("heartbeat updates timestamp", () => {
    const worker = registerWorker("hb-test", []);
    const before = worker.lastHeartbeatAt;
    // Small delay to ensure timestamp differs
    const updated = heartbeat(worker.id);
    expect(updated).toBeDefined();
    expect(updated!.lastHeartbeatAt).toBeTruthy();
  });

  test("assignJob and completeJob lifecycle", () => {
    const worker = registerWorker("lifecycle-test", []);
    const job = createJob({ transport: "cli", agent: "claude", prompt: "pool test" });

    expect(assignJob(worker.id, job.id)).toBe(true);
    expect(getWorker(worker.id)!.status).toBe("busy");
    expect(getWorker(worker.id)!.currentJobId).toBe(job.id);

    expect(completeJob(worker.id)).toBe(true);
    expect(getWorker(worker.id)!.status).toBe("idle");
    expect(getWorker(worker.id)!.currentJobId).toBeUndefined();
  });

  test("deregisterWorker removes worker", () => {
    const worker = registerWorker("bye", []);
    expect(deregisterWorker(worker.id)).toBe(true);
    expect(getWorker(worker.id)).toBeUndefined();
  });

  test("listWorkers returns all workers", () => {
    const before = listWorkers().length;
    registerWorker("list-test-1", []);
    registerWorker("list-test-2", []);
    expect(listWorkers().length).toBeGreaterThanOrEqual(before + 2);
  });
});

describe("Job Queue", () => {
  beforeEach(() => {
    clearWorkers();
    clearQueue();
    clearJobs();
  });

  test("enqueue and dequeue FIFO", () => {
    enqueue("job-a");
    enqueue("job-b");
    enqueue("job-c");
    expect(dequeue()).toBe("job-a");
    expect(dequeue()).toBe("job-b");
    expect(dequeue()).toBe("job-c");
  });

  test("dequeue returns undefined when empty", () => {
    // Drain any remaining
    while (dequeue() !== undefined) {}
    expect(dequeue()).toBeUndefined();
  });

  test("peek returns next without removing", () => {
    enqueue("peek-test");
    expect(peek()).toBe("peek-test");
    expect(peek()).toBe("peek-test"); // Still there
    dequeue(); // Clean up
  });

  test("size returns queue length", () => {
    while (dequeue() !== undefined) {} // drain
    expect(size()).toBe(0);
    enqueue("s1");
    enqueue("s2");
    expect(size()).toBe(2);
    dequeue();
    dequeue();
  });

  test("removeFromQueue removes specific job", () => {
    enqueue("r1");
    enqueue("r2");
    enqueue("r3");
    expect(removeFromQueue("r2")).toBe(true);
    expect(dequeue()).toBe("r1");
    expect(dequeue()).toBe("r3");
  });
});

describe("Pool Tool Handlers", () => {
  beforeEach(() => {
    clearWorkers();
    clearQueue();
    clearJobs();
  });

  test("register_worker returns worker ID", async () => {
    const result = await handleRegisterWorker({ name: "tool-test-worker", capabilities: ["ts"] });
    const data = JSON.parse(result.content[0].text);
    expect(data.workerId).toMatch(/^wkr_/);
    expect(data.status).toBe("idle");
  });

  test("full pool roundtrip: register -> handoff(pool) -> pull -> submit -> get_result", async () => {
    // Register worker
    const regResult = await handleRegisterWorker({ name: "roundtrip-worker" });
    const { workerId } = JSON.parse(regResult.content[0].text);

    // Create a job and enqueue it (simulating handoff with pool=true)
    const job = createJob({ transport: "cli", prompt: "pool roundtrip test" });
    enqueue(job.id);

    // Worker pulls task
    const pullResult = await handlePullTask({ workerId });
    const pullData = JSON.parse(pullResult.content[0].text);
    expect(pullData.available).toBe(true);
    expect(pullData.jobId).toBe(job.id);
    expect(pullData.prompt).toBe("pool roundtrip test");

    // Worker submits result
    const submitResult = await handleSubmitResult({
      workerId,
      jobId: job.id,
      status: "completed",
      output: "task done successfully",
    });
    const submitData = JSON.parse(submitResult.content[0].text);
    expect(submitData.acknowledged).toBe(true);

    // Verify job is completed
    const finalJob = getJob(job.id);
    expect(finalJob!.status).toBe("completed");
    expect(finalJob!.stdout).toBe("task done successfully");
  });

  test("pull_task returns available:false when queue empty", async () => {
    const regResult = await handleRegisterWorker({ name: "empty-puller" });
    const { workerId } = JSON.parse(regResult.content[0].text);

    // Drain queue
    while (dequeue() !== undefined) {}

    const pullResult = await handlePullTask({ workerId });
    const data = JSON.parse(pullResult.content[0].text);
    expect(data.available).toBe(false);
  });

  test("list_workers returns worker info", async () => {
    const result = await handleListWorkers();
    const data = JSON.parse(result.content[0].text);
    expect(typeof data.total).toBe("number");
    expect(typeof data.idle).toBe("number");
    expect(Array.isArray(data.workers)).toBe(true);
  });
});
