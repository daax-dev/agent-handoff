# Feature Plan: Async Runner Failure Propagation (PASS)

## Selection Verdict (Harsh + Objective)

- Value: 7/10
- Risk reduction: 8/10
- Testability: 10/10
- Complexity risk: 2/10
- Overall: PASS

This feature passed because it eliminates silent failure handling at task dispatch boundaries and guarantees jobs always reach an observable terminal state.

---

## Problem Statement

`handleHandoffTask` launches async runners and suppresses promise rejections with empty catch handlers. If a future code path throws outside existing internal catches, errors can become hard to diagnose and may leave users with unclear status visibility.

---

## User Value

1. Improves reliability and trust in `check_status` / `get_result`.
2. Prevents hidden operational failures from being ignored.
3. Simplifies incident debugging with explicit failure signals.
4. Makes async dispatch behavior safer under refactors.

---

## Scope

### In scope

- Remove silent `.catch(() => {})` behavior at dispatch points.
- Add a shared dispatch guard that:
  - catches top-level rejection,
  - transitions job to terminal failure if needed,
  - logs structured failure event.
- Ensure idempotent status transitions (do not overwrite already terminal jobs).

### Normative scope (for acceptance checks)

- Applies to runner promise dispatch started from `handleHandoffTask` in `src/tools/handoff-task.ts`.
- If dispatch logic is extracted, the same rule applies to the extracted helper that directly wraps `runCliJob` and `runA2AJob`.
- Out of scope for this feature: unrelated async code paths that do not dispatch these runner promises.

### Out of scope

- Rewriting full CLI/A2A runner internals.
- New retry framework.
- New alerting stack.

---

## Proposed Design

### Dispatch wrapper

Introduce helper in `handoff-task` or runner module, e.g.:

- `dispatchJob(job, runnerPromiseFactory)`
  - Starts runner promise.
  - `catch` writes fallback failure if job is still `queued` or `running`.
  - Emits `task_failed` event with `error` containing `dispatch_unhandled_rejection: <message>`.

### State-transition safety

- Before fallback update, read current job:
  - If terminal (`completed`, `failed`, `cancelled`, `timed_out`), do nothing.
  - Else write terminal failure with timestamp and error detail.

### Observability

- Ensure the failure is visible via:
  - `check_status` status change,
  - `get_result` includes `error`,
  - `handoffs` JSONL event entry.

Likely modules touched:
- `src/tools/handoff-task.ts`
- optionally `src/job-runner.ts` (helper placement)
- `src/job-store.ts` (no schema change needed)
- `tests/tools.test.ts` or new focused test file for handoff dispatch

---

## Test Plan (100% Objective)

### Unit tests

1. **CLI runner rejection propagates to failed job**
   - Mock `runCliJob` to reject.
   - Call `handleHandoffTask({ agent, prompt })`.
   - Assert resulting job reaches `failed` with non-empty `error`.

2. **A2A runner rejection propagates to failed job**
   - Mock `runA2AJob` to reject.
   - Assert job terminal state is `failed` and includes error reason.

3. **No overwrite of terminal state**
   - Simulate runner path that already marks job completed, then throws later.
   - Dispatch guard must not convert completed job to failed.

4. **Failure is observable in logs**
   - Assert `logHandoffEvent` was called exactly once with `event: "task_failed"` and `error` containing `dispatch_unhandled_rejection`.

### Regression tests

5. **Successful runner path unchanged**
   - Existing successful flow remains completed and unaffected.

6. **Timeout path unchanged**
   - Existing timed out jobs remain `timed_out`, not remapped to generic failed.

---

## Vagrant-Skill Full Validation (Optional, Teardown-Friendly)

1. `vagrant up`
2. `bun install`
3. `bun test` and targeted dispatch tests
4. `vagrant destroy -f`

Pass condition:
- Rejection-path tests and baseline tests pass in fresh environment.
- No hidden reliance on non-deterministic local process state.

---

## Acceptance Criteria (Binary)

1. In `src/tools/handoff-task.ts` (or extracted dispatch helper), there is no empty rejection suppression pattern for runner promises (`.catch(() => {})` or equivalent no-op handlers).
2. If a dispatched runner promise rejects while the job is non-terminal (`queued` or `running`), the job is updated to `failed` with non-empty `error` and `completedAt`.
3. Completed/cancelled/timed_out jobs are not overwritten by fallback failure handler.
4. Fallback failure path emits exactly one `task_failed` handoff event with `error` containing `dispatch_unhandled_rejection`.
5. Automated tests cover CLI and A2A rejection paths and pass in a clean run.

---

## Definition of Done

- Dispatch guard implemented and covered by tests.
- Existing behavior for success and timeout paths preserved.
- Dispatch rejection test suite runs with zero unhandled rejection reports outside intentionally asserted failures.

---

## GitHub Issue Draft

### Title

Propagate async runner dispatch failures to job state and logs

### Body

Replace silent async dispatch catch behavior with explicit failure propagation. Add a guarded dispatch wrapper that marks non-terminal jobs failed on unexpected runner rejection, logs structured failure events, and preserves existing success/timeout behavior. Add deterministic tests for CLI and A2A rejection paths.
