# Feature Plan: Capability-Aware Pool Routing (PASS)

## Selection Verdict (Harsh + Objective)

- Value: 9/10
- Risk reduction: 9/10
- Testability: 10/10
- Complexity risk: 4/10
- Overall: PASS

This feature passed because it resolves a documented behavior gap: workers register capabilities, but current pool assignment is FIFO-only and ignores capability matching.

---

## Problem Statement

`register_worker` accepts `capabilities`, and docs describe "task matching", but `pull_task` currently dequeues the next job without checking worker capabilities. This can assign tasks to workers that are not suitable, causing lower quality outcomes and wasted retries.

---

## User Value

1. Improves routing quality in multi-worker systems.
2. Reduces failed/low-quality results due to mismatched worker skills.
3. Makes documented behavior true in practice.
4. Provides deterministic assignment behavior teams can rely on.

---

## Scope

### In scope

- Add explicit task capability requirements on pool jobs.
- Route `pull_task` using capability compatibility.
- Preserve FIFO fairness among jobs that match a worker.
- Keep existing behavior for jobs with no capability requirements.

### Out of scope

- Cross-machine/distributed scheduling.
- Priority queues and weighted scheduling.
- Persistence across process restarts.

---

## Proposed API and Schema Changes

1. `handoff_task` input:
   - Add optional `requiredCapabilities: string[]`.
   - Only applies when `pool: true`.
2. Job schema:
   - Store `requiredCapabilities` in `Job`.
3. `pull_task` response:
   - Include `requiredCapabilities` when `available: true` so assignment decisions are inspectable.

Validation rules:
- If `pool !== true`, providing a non-empty `requiredCapabilities` array MUST fail validation.
- Capability normalization MUST be deterministic: trim whitespace and lowercase every capability token on both worker registration and job creation.

---

## Design Details

### Matching rule

- A worker matches a job when:
  - Job has no `requiredCapabilities`, or
  - Every required capability is present in worker capabilities.

### Queue selection algorithm

- On `pull_task(workerId)`:
  1. Verify worker exists and is idle.
  2. Scan queue from head to tail.
  3. Select first queued job matching worker capabilities.
  4. Remove selected job from queue, assign worker, mark job running.
  5. If no job matches, return `{ available: false }`.

Fairness:
- FIFO remains true within each worker's matchable subset.
- Non-matching jobs remain queued for compatible workers.

Suggested modules likely touched:
- `src/types.ts`
- `src/index.ts` (tool schema)
- `src/tools/handoff-task.ts`
- `src/tools/pull-task.ts`
- `src/pool/job-queue.ts` (add dequeue-by-predicate helper)
- `README.md` docs update (during implementation)

---

## Test Plan (100% Objective)

Primary test file target: `tests/pool.test.ts`

### Unit tests

1. **Matches by required capability**
   - Queue Job A (`requiredCapabilities: ["db"]`) and Job B (`requiredCapabilities: ["frontend"]`).
   - Worker with `["frontend"]` pulls Job B, not Job A.

2. **Unrestricted jobs remain pullable**
   - Queue Job A (`requiredCapabilities: ["db"]`) then Job B (no requirements).
   - Worker without `db` pulls Job B.

3. **FIFO among matching jobs**
   - Queue Job A (`["ts"]`), Job B (`["ts"]`), Worker has `["ts"]`.
   - Pull order is A then B.

4. **No eligible task returns available=false**
   - Queue only jobs requiring `["go"]`; worker has `["ts"]`.
   - Response is `available: false`, queue unchanged.

5. **Normalization behavior**
   - Worker capability `["TypeScript"]`, job requires `["typescript"]`.
   - Match succeeds after normalization.

### Regression tests

6. **Existing queue flow still works**
   - Jobs without requirements preserve old pull behavior.

7. **No silent drop while scanning**
   - Non-matching head job stays in queue after mismatch pull.

---

## Vagrant-Skill Full Validation (Optional, Teardown-Friendly)

Purpose: verify behavior in a clean machine state and avoid hidden local environment assumptions.

1. `vagrant up` with Bun preinstalled (or provisioning script).
2. Run `bun install && bun test`.
3. Run targeted pool tests only:
   - `bun test tests/pool.test.ts`
4. Destroy environment:
   - `vagrant destroy -f`

Pass condition:
- All capability-routing tests pass from clean environment.
- No environment-specific flakes after full teardown/recreate cycle.

---

## Acceptance Criteria (Binary)

1. `handoff_task(pool=true)` accepts and stores `requiredCapabilities`.
2. `pull_task` never assigns a job to an incompatible worker.
3. After `pull_task`, the relative order of all non-dequeued jobs is unchanged (stable queue invariant).
4. Existing jobs without capability requirements continue to function.
5. `pull_task(available=true)` response includes the selected job's `requiredCapabilities` field.
6. Automated tests cover positive, negative, and regression paths and pass in one CI run without retries.

---

## Definition of Done

- Code implemented with tests green.
- Tool docs updated to reflect capability-routing semantics.
- No regressions in existing pool roundtrip tests.
- Feature merged only if all acceptance criteria are satisfied.

---

## GitHub Issue Draft

### Title

Capability-aware pool routing for `pull_task`

### Body

Implement capability-based matching in pool mode so workers only receive compatible queued tasks. Add `requiredCapabilities` to pool jobs via `handoff_task`, route `pull_task` using first-match scan over queue, preserve FIFO fairness among compatible jobs, and add objective tests for match/no-match/fairness/regression scenarios.
