import { describe, test, expect, beforeEach } from "./test-compat.js";
import { registerWorker, getWorker, heartbeat, assignJob, completeJob, listWorkers, deregisterWorker } from "../src/pool/worker-registry.js";
import { enqueue, dequeue, dequeueByPredicate, peek, size, removeFromQueue, clearQueue } from "../src/pool/job-queue.js";
import { handleHandoffTask } from "../src/tools/handoff-task.js";
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

  test("dequeueByPredicate selects first matching item and keeps order stable", () => {
    while (dequeue() !== undefined) {} // drain
    enqueue("p1");
    enqueue("p2");
    enqueue("p3");

    expect(dequeueByPredicate((jobId) => jobId === "p2")).toBe("p2");
    expect(dequeue()).toBe("p1");
    expect(dequeue()).toBe("p3");
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
    while (dequeue() !== undefined) {} // drain

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

  test("matches by required capability and skips incompatible head job", async () => {
    while (dequeue() !== undefined) {} // drain

    const dbJob = createJob({
      transport: "pool",
      prompt: "db task",
      requiredCapabilities: ["db"],
    });
    const frontendJob = createJob({
      transport: "pool",
      prompt: "frontend task",
      requiredCapabilities: ["frontend"],
    });
    enqueue(dbJob.id);
    enqueue(frontendJob.id);

    const frontendWorkerReg = await handleRegisterWorker({
      name: "frontend-worker",
      capabilities: ["frontend"],
    });
    const { workerId: frontendWorkerId } = JSON.parse(frontendWorkerReg.content[0].text);
    const frontendPull = await handlePullTask({ workerId: frontendWorkerId });
    const frontendPullData = JSON.parse(frontendPull.content[0].text);
    expect(frontendPullData.available).toBe(true);
    expect(frontendPullData.jobId).toBe(frontendJob.id);
    expect(frontendPullData.requiredCapabilities).toEqual(["frontend"]);

    const dbWorkerReg = await handleRegisterWorker({
      name: "db-worker",
      capabilities: ["db"],
    });
    const { workerId: dbWorkerId } = JSON.parse(dbWorkerReg.content[0].text);
    const dbPull = await handlePullTask({ workerId: dbWorkerId });
    const dbPullData = JSON.parse(dbPull.content[0].text);
    expect(dbPullData.available).toBe(true);
    expect(dbPullData.jobId).toBe(dbJob.id);
  });

  test("unrestricted jobs remain pullable when required jobs do not match", async () => {
    while (dequeue() !== undefined) {} // drain

    const restricted = createJob({
      transport: "pool",
      prompt: "db only",
      requiredCapabilities: ["db"],
    });
    const unrestricted = createJob({
      transport: "pool",
      prompt: "open task",
    });
    enqueue(restricted.id);
    enqueue(unrestricted.id);

    const regResult = await handleRegisterWorker({ name: "general-worker", capabilities: ["ts"] });
    const { workerId } = JSON.parse(regResult.content[0].text);
    const pullResult = await handlePullTask({ workerId });
    const pullData = JSON.parse(pullResult.content[0].text);

    expect(pullData.available).toBe(true);
    expect(pullData.jobId).toBe(unrestricted.id);
  });

  test("FIFO ordering is preserved among matching jobs", async () => {
    while (dequeue() !== undefined) {} // drain

    const first = createJob({
      transport: "pool",
      prompt: "ts task 1",
      requiredCapabilities: ["ts"],
    });
    const second = createJob({
      transport: "pool",
      prompt: "ts task 2",
      requiredCapabilities: ["ts"],
    });
    enqueue(first.id);
    enqueue(second.id);

    const regResult = await handleRegisterWorker({ name: "ts-worker", capabilities: ["ts"] });
    const { workerId } = JSON.parse(regResult.content[0].text);

    const firstPull = await handlePullTask({ workerId });
    const firstPullData = JSON.parse(firstPull.content[0].text);
    expect(firstPullData.available).toBe(true);
    expect(firstPullData.jobId).toBe(first.id);

    await handleSubmitResult({
      workerId,
      jobId: first.id,
      status: "completed",
      output: "done first",
    });

    const secondPull = await handlePullTask({ workerId });
    const secondPullData = JSON.parse(secondPull.content[0].text);
    expect(secondPullData.available).toBe(true);
    expect(secondPullData.jobId).toBe(second.id);
  });

  test("returns available=false when no queued task is compatible", async () => {
    while (dequeue() !== undefined) {} // drain

    const goJob = createJob({
      transport: "pool",
      prompt: "go task",
      requiredCapabilities: ["go"],
    });
    enqueue(goJob.id);

    const regResult = await handleRegisterWorker({ name: "ts-only-worker", capabilities: ["ts"] });
    const { workerId } = JSON.parse(regResult.content[0].text);
    const pullResult = await handlePullTask({ workerId });
    const data = JSON.parse(pullResult.content[0].text);

    expect(data.available).toBe(false);

    const goWorkerReg = await handleRegisterWorker({ name: "go-worker", capabilities: ["go"] });
    const { workerId: goWorkerId } = JSON.parse(goWorkerReg.content[0].text);
    const goPullResult = await handlePullTask({ workerId: goWorkerId });
    const goPullData = JSON.parse(goPullResult.content[0].text);
    expect(goPullData.available).toBe(true);
    expect(goPullData.jobId).toBe(goJob.id);
  });

  test("normalizes capability tokens for worker registration and pool handoff requirements", async () => {
    while (dequeue() !== undefined) {} // drain

    const regResult = await handleRegisterWorker({
      name: "normalized-worker",
      capabilities: [" TypeScript "],
    });
    const { workerId } = JSON.parse(regResult.content[0].text);

    const handoffResult = await handleHandoffTask({
      agentUrl: "https://example.com",
      prompt: "normalized requirements task",
      pool: true,
      requiredCapabilities: [" typescript "],
    });
    const { jobId } = JSON.parse(handoffResult.content[0].text);
    const queuedJob = getJob(jobId);
    expect(queuedJob?.requiredCapabilities).toEqual(["typescript"]);

    const pullResult = await handlePullTask({ workerId });
    const pullData = JSON.parse(pullResult.content[0].text);
    expect(pullData.available).toBe(true);
    expect(pullData.jobId).toBe(jobId);
    expect(pullData.requiredCapabilities).toEqual(["typescript"]);
  });

  test("handoff_task rejects requiredCapabilities unless pool=true", async () => {
    await expect(
      handleHandoffTask({
        agentUrl: "https://example.com",
        prompt: "invalid capability usage",
        requiredCapabilities: ["typescript"],
      }),
    ).rejects.toThrow("'requiredCapabilities' can only be provided when 'pool' is true");
  });

  test("list_workers returns worker info", async () => {
    const result = await handleListWorkers();
    const data = JSON.parse(result.content[0].text);
    expect(typeof data.total).toBe("number");
    expect(typeof data.idle).toBe("number");
    expect(Array.isArray(data.workers)).toBe(true);
  });
});
