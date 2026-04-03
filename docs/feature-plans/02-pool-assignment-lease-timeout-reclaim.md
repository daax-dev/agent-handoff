# Feature Plan: Pool Assignment Lease Timeout + Reclaim (PASS)

## Selection Verdict (Harsh + Objective)

- Value: 9/10
- Risk reduction: 10/10
- Testability: 9/10
- Complexity risk: 6/10
- Overall: PASS

This feature passed because it closes a core reliability gap: pool jobs can be assigned and never completed if a worker disappears after `pull_task`.

---

## Problem Statement

Current pool flow marks a job `running` when assigned and expects `submit_result` to finish it. If the worker crashes, disconnects, or never returns, the job can remain stuck indefinitely and the worker can remain effectively unavailable.

---

## User Value

1. Prevents permanently stuck jobs in pool mode.
2. Improves throughput by reclaiming abandoned assignments.
3. Makes pool behavior robust under worker churn and failure.
4. Enables predictable recovery without manual intervention.

---

## Scope

### In scope

- Introduce assignment lease metadata when a worker pulls a job.
- Reclaim assignment on lease expiration.
- Return reclaimed jobs to queue under defined ordering policy.
- Reset worker assignment state during reclaim.

### Out of scope

- Cross-process distributed locking.
- Persistent lease state across server restart.
- New transport protocols.

---

## Proposed API and Schema Changes

1. Pool runtime configuration:
   - Introduce `poolLeaseMs` with a default (for example, 120000).
2. Job schema:
   - Add assignment metadata fields, e.g.:
     - `assignedWorkerId?: string`
     - `leaseExpiresAt?: string`
     - `leaseVersion?: number`
3. Worker schema (optional):
   - Track assignment timestamp to support diagnostics.

No user-facing MCP parameter changes are required for initial implementation, but optional future extension can expose `leaseMs` in pull responses.

---

## Design Details

### Lease lifecycle

1. On `pull_task` assignment:
   - Set job `status=running`, `assignedWorkerId=workerId`, `leaseExpiresAt=now+poolLeaseMs`.
   - Mark worker busy with `currentJobId`.

2. Lease refresh:
   - Normative rule: each successful `worker_heartbeat` from the currently assigned worker extends `leaseExpiresAt` to `now + poolLeaseMs` while job status is `running`.

3. Reclaim trigger:
   - Reclaim checks MUST run synchronously at the start of `pull_task`, `worker_heartbeat`, and `submit_result`.
   - A periodic sweep timer is optional and must not be required for correctness.

4. On reclaim:
   - If lease expired and job still running, transition back to queued state and clear assignment metadata.
   - Mark previously assigned worker as `idle` and clear `currentJobId`.
   - Re-enqueue job at queue tail.

5. `submit_result` safety:
   - Reject stale submissions when caller is not current `assignedWorkerId`.
   - Return error message: `Worker <workerId> is not assigned to job <jobId>`.

Likely modules touched:
- `src/types.ts`
- `src/job-store.ts`
- `src/tools/pull-task.ts`
- `src/tools/submit-result.ts`
- `src/tools/worker-heartbeat.ts`
- `src/pool/job-queue.ts`
- `src/pool/worker-registry.ts`

---

## Test Plan (100% Objective)

Primary test target: `tests/pool.test.ts` with deterministic time controls.

### Unit/integration tests

1. **Assignment writes lease metadata**
   - After `pull_task`, job has `assignedWorkerId`, `leaseExpiresAt`, and worker is busy.

2. **Expired lease is reclaimed**
   - Advance clock past lease expiry.
   - Trigger reclaim path.
   - Assert job returns to `queued`, assignment metadata cleared, worker not stuck busy.

3. **Non-expired lease is not reclaimed**
   - Before expiry, reclaim check does nothing.

4. **Reclaimed job is re-pullable**
   - Another worker pulls reclaimed job successfully.

5. **Stale submit_result is rejected**
   - Worker A assigned job, lease expires and job reclaimed to worker B.
   - Worker A submit attempt fails with message `Worker <workerId> is not assigned to job <jobId>`.

6. **Queue ordering policy is deterministic**
   - Validate exact expected order after reclaim with mandatory tail insertion.

### Failure-path tests

7. **No double assignment**
   - A running job cannot be assigned to two workers concurrently.

8. **Heartbeat refresh behavior**
   - Assigned worker heartbeat extends lease and prevents reclaim before new expiry.

---

## Vagrant-Skill Full Validation (Optional, Teardown-Friendly)

1. `vagrant up`
2. `bun install`
3. Run full tests: `bun test`
4. Run targeted reclaim tests repeatedly (e.g., 20 loops) to detect timing flakes.
5. `vagrant destroy -f`

Pass condition:
- Reclaim tests pass repeatedly in clean VM cycles.
- No flaky timing behavior after multiple teardown/recreate runs.

---

## Acceptance Criteria (Binary)

1. Assigned pool jobs include `assignedWorkerId` and `leaseExpiresAt` at assignment time.
2. Reclaim checks execute at the start of `pull_task`, `worker_heartbeat`, and `submit_result`.
3. Lease expiration reclaims running jobs automatically, resets prior worker to `idle` with cleared `currentJobId`, and re-enqueues reclaimed jobs at queue tail.
4. Reclaimed jobs can be reassigned and completed successfully by a different worker.
5. Stale `submit_result` from non-owner workers fails with message `Worker <workerId> is not assigned to job <jobId>`.
6. Tests use deterministic time control and validate lease creation, extension, expiration reclaim, queue ordering, and stale ownership rejection.

---

## Definition of Done

- Lease and reclaim implemented with explicit invariants.
- All new reclaim and stale-submission tests pass.
- Existing pool roundtrip tests still pass.
- Documentation updated for reclaim semantics.

---

## GitHub Issue Draft

### Title

Add pool assignment lease timeout and automatic reclaim

### Body

Add lease-based assignment tracking for pool jobs so abandoned assignments are reclaimed automatically. On lease expiry, return the job to queue, clear stale worker ownership, and reject stale `submit_result` calls. Include deterministic tests for lease lifecycle, reclaim, ordering policy, and stale ownership protection.
