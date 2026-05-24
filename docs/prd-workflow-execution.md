# PRD: Code-First Workflow Execution Runtime

**Status:** Draft v0.1  
**Author:** JP + Jarvis  
**Date:** 2026-05-24  
**Parent:** [BROKER-PRD.md](BROKER-PRD.md)  
**Related:** [feature-plans/04-gsd-v1-fsm-and-orchestrator.md](feature-plans/04-gsd-v1-fsm-and-orchestrator.md)  
**Reference:** [Claude Code Workflows — Ray Amjad (May 22 2026)](https://www.youtube.com/watch?v=c0gVowvMR-g)

---

## Problem

### The LLM-as-orchestrator leak

Every multi-agent workflow in agent-handoff today has the same structural problem: **a model holds the state between agents**.

The current GSD orchestrator plan (`feature-plans/04`) makes this explicit — the `gsd_orchestrator` is a Claude model that reads FSM state, decides which agents to spawn, and then receives their results back into its context window before firing the next transition. That model context grows with every agent dispatch:

```
gsd_orchestrator (model)
    ├── dispatches researcher → result comes back into orchestrator context
    ├── dispatches pm_planner → result comes back into orchestrator context
    ├── dispatches plan_verifier → result comes back into orchestrator context
    └── decides next transition (context now full of intermediate results)
```

This creates three compounding problems:

1. **Token tax.** Every sub-agent result re-enters the orchestrator's context. A GSD execution phase with 4–5 wave agents means 4–5 full results accumulate in a single model context before the next FSM transition fires.

2. **Degradation over time.** The orchestrator gets "sloppier" as its window fills. Conditional dispatch decisions (e.g., "if the verifier found gaps, spawn fixers") are especially fragile — the model may misread its own accumulated state when the context is large.

3. **No context isolation.** There is no mechanism today to pass a result from agent A directly to agent B's prompt. Everything routes back through the orchestrator model, even when the orchestrator has nothing to add.

### Why this matters now

Feature plan 04 is the next planned build. If it ships with a model-based orchestrator, it bakes this problem in. The GSD multi-phase loop — `executing → verifying → gap_fixing → verifying → shipping` — is exactly the kind of long multi-agent chain where context bleed compounds worst.

Anthropic itself recognised this problem, shipped a fix (Claude Code Workflows), and then quietly pulled it from their changelog — while the implementation was briefly observable in the wild. The pattern is validated. We should build it into the daax execution layer before the GSD orchestrator ships, not after.

---

## Insight: Code as the Orchestrator

The fix is to replace the model orchestrator with **code**. Instead of a Claude session holding intermediate results and deciding what to spawn next, a TypeScript file defines the full multi-phase execution plan. Routing logic lives in the code. Results pass directly from one agent's output to the next agent's prompt — the orchestrator's context never fills because the orchestrator is not a model.

```
workflow.ts (code — no model context)
    ├── phase 1: agent() → typed result → passed directly to phase 2
    ├── phase 2: pipeline(items, [agent(), agent()]) → typed results → phase 3
    └── phase 3: parallel([agent(), agent(), agent()]) → final result
```

The model orchestrator is replaced by a deterministic code file. The code IS the dispatch table. No model needs to decide what to do next — the workflow file already knows.

This is not a new idea in distributed systems (it is a workflow engine), but it is new to the agentic coding toolchain, and agent-handoff is exactly the right place to build it.

---

## Proposed Solution: Workflow Spec Files

A **workflow spec file** is a TypeScript file that defines a named multi-phase agent execution plan. It lives in `.claude/workflows/<name>.ts` (or a project-configured directory) and is invoked via the existing `handoff_task` MCP tool with a new `workflowFile` parameter.

The file exports a default async function. Inside it, three new primitives are available:

| Primitive | Description |
|-----------|-------------|
| `agent(opts)` | Spawns one sub-agent via the existing `handoff_task` dispatch path. Returns a typed result. |
| `parallel(tasks[])` | Batches N `agent()` calls, waits for all to complete. Returns an array of typed results. |
| `pipeline(items[], stages[])` | Streams each item through sequential stages. The next stage starts as soon as one item completes — does not wait for all items to finish the current stage. |

A workflow is the **code layer** sitting above the existing `handoff_task` engine. All spawning still goes through the existing CLI runner, A2A client, or worker pool — the workflow runtime just manages the sequencing and typed data flow between dispatches.

### Typed schema handoffs

Each `agent()` call accepts an optional `schema` field — a Zod schema describing the structured JSON the sub-agent must return. The workflow runtime validates the output before passing it to the next stage. If the output doesn't match the schema, the agent retries (up to the existing retry limit) before surfacing a `SCHEMA_MISMATCH` error.

This replaces the current free-form `contextPayload` for intra-workflow data flow. `contextPayload` remains for cross-workflow and inter-session continuity; schemas are for intra-workflow typed handoffs between phases.

### Budget controls

A `budget` object can be passed to the workflow executor with a `maxTokens` cap. The runtime tracks token consumption across all sub-agent dispatches and exposes a `budgetRemaining()` helper callable from within loop conditions. When the budget is exhausted, the workflow halts cleanly and returns a `BUDGET_EXCEEDED` result.

---

## How This Maps to What Already Exists

| Existing feature | Role in workflow execution | Change required |
|------------------|---------------------------|-----------------|
| `handoff_task` | Agent dispatch — called by `agent()` primitive | None — workflow runtime calls the same dispatch path |
| `contextPayload` | Cross-workflow and inter-session continuity | None — still used for handoffs between separate workflows or sessions |
| DoD handshake | Capability verification before dispatch | Integrate: `agent()` can pass `dodCriteria` to the underlying `handoff_task` call |
| Worker pool | Parallel execution backend | `parallel()` uses the pool when `pool: true` is passed to `agent()` |
| Job store (in-memory) | Tracks individual job state | Extend: add a `WorkflowRun` record that groups related jobs under a named workflow |
| JSONL audit log | Per-event logging | Extend: add `workflow_started`, `phase_entered`, `phase_completed`, `workflow_completed` events |
| FSM (ChangeSet) | High-level lifecycle tracking | Integration point: a GSD phase can be backed by a workflow file instead of an AI orchestrator — see §GSD Integration below |

---

## GSD Integration: Replacing the Model Orchestrator

Feature plan 04 proposes a `gsd_orchestrator` model that reads FSM state and dispatches agents. With this PRD in place, the orchestrator role changes:

**Before (feature plan 04 as written):**
```
FSM state entry → post-transition hook → gsd_orchestrator (model) → reads state → dispatches agents → receives results → fires next transition
```

**After (with workflow execution runtime):**
```
FSM state entry → post-transition hook → load workflow file for this state → workflow runtime executes → result → fires next transition
```

The dispatch table (state → agents) moves from the orchestrator's prompt into the workflow file. The `gsd_orchestrator` model is no longer needed for routing — it becomes optional, used only when a phase genuinely requires a model to make a non-deterministic decision (e.g. "researcher found nothing useful — should we skip planning or use a fallback source?"). All deterministic routing is handled by code.

Concretely, the `gsd-orchestrator.md` prompt template and its state→dispatch table would be replaced by one workflow file per GSD phase:

```
.claude/workflows/
  gsd-project-init.ts       # researcher + pm_planner → PROJECT.md + ROADMAP.md
  gsd-discussing.ts         # pm_planner → CONTEXT.md
  gsd-planning.ts           # researcher + planner + plan_verifier → PLAN.md
  gsd-executing.ts          # implementer × wave count (parallel)
  gsd-verifying.ts          # verifier + qa_agent → verify report; gaps → gap_fixing
  gsd-gap-fixing.ts         # fixer × gap count (pipeline)
  gsd-shipping.ts           # summarizer + pr_builder → PR URL
```

Each file is testable in isolation. The FSM post-transition hook loads the correct file by state name and invokes the workflow runtime. No model is in the routing path.

---

## Workflow Visibility

A new MCP tool `list_workflows` returns running and completed workflow runs for the current session. A workflow run record includes:

- Workflow name and file path
- Start time, current phase, elapsed time
- Per-phase status: `pending`, `running`, `completed`, `failed`
- Per-agent job IDs (linkable to existing `check_status` / `get_result` tools)
- Token consumption vs budget (when a budget is set)

This gives the same live visibility that the Claude Code `/workflows` slash command provides, surfaced through the existing MCP interface.

---

## API

### New `handoff_task` parameter

| Parameter | Type | Description |
|-----------|------|-------------|
| `workflowFile` | `string` | Absolute path to a `.ts` workflow spec file. When set, `agent` and `agentUrl` are ignored — the workflow file controls all dispatch. |
| `workflowArgs` | `Record<string, unknown>` | Runtime arguments passed to the workflow's default export. |
| `budget` | `{ maxTokens: number }` | Optional token budget for the entire workflow run. |

### Workflow runtime API (available inside workflow files)

```typescript
import type { WorkflowContext } from "@daax-dev/agent-handoff/workflow";

export default async function(ctx: WorkflowContext) {
  // ctx.args       — workflowArgs passed at invocation
  // ctx.budgetRemaining() — tokens remaining (returns Infinity if no budget set)
  // ctx.log(msg)   — writes a phaseLog entry visible in list_workflows

  const result = await ctx.agent({
    agent: "claude",
    prompt: "...",
    schema: z.object({ status: z.enum(["pass", "fail"]), notes: z.string() }),
    dodCriteria: [{ id: "tests_pass", description: "All tests pass", required: true }]
  });

  const results = await ctx.parallel([
    ctx.agent({ agent: "claude", prompt: "Fix issue A" }),
    ctx.agent({ agent: "claude", prompt: "Fix issue B" }),
  ]);

  await ctx.pipeline(items, [
    async (item) => ctx.agent({ agent: "claude", prompt: `Research ${item.id}` }),
    async (research) => ctx.agent({ agent: "claude", prompt: `Draft from ${research.summary}` }),
  ]);
}
```

### New MCP tool: `list_workflows`

Returns all workflow runs for the current session:

```json
[
  {
    "workflowRunId": "wfl_a1b2c3",
    "workflowFile": ".claude/workflows/gsd-executing.ts",
    "status": "running",
    "currentPhase": "parallel-wave-2",
    "startedAt": "2026-05-24T10:12:00Z",
    "elapsedMs": 34200,
    "phases": [
      { "name": "parallel-wave-1", "status": "completed", "agentCount": 3 },
      { "name": "parallel-wave-2", "status": "running",   "agentCount": 4 }
    ],
    "tokenBudget": { "max": 500000, "used": 212000 }
  }
]
```

---

## Acceptance Criteria

### Core runtime
- [ ] A workflow spec file (`.ts`) can be invoked via `handoff_task` with `workflowFile` path.
- [ ] `agent()` inside a workflow dispatches through the existing `handoff_task` CLI/A2A/pool path.
- [ ] `parallel()` dispatches N agents concurrently and returns when all complete.
- [ ] `pipeline()` begins stage N+1 for item K as soon as stage N for item K completes — does not wait for all items.
- [ ] A typed Zod schema on `agent()` validates the sub-agent's output; schema mismatch triggers retry up to the existing retry limit.
- [ ] Budget: when `budget.maxTokens` is exceeded, the workflow halts and returns `BUDGET_EXCEEDED`.
- [ ] `ctx.budgetRemaining()` returns a live count usable inside loop conditions.

### Visibility
- [ ] `list_workflows` MCP tool returns running and completed workflow runs for the current session.
- [ ] Each workflow run record shows per-phase status and per-agent job IDs.
- [ ] Workflow events (`started`, `phase_entered`, `phase_completed`, `completed`, `failed`) are written to the JSONL audit log.

### GSD integration
- [ ] The FSM post-transition hook can load and invoke a workflow file instead of spawning a `gsd_orchestrator` model.
- [ ] Each GSD phase has a corresponding workflow file that replaces the dispatch table in `gsd-orchestrator.md`.
- [ ] Switching a GSD phase to workflow-backed dispatch does not require changes to the FSM schema or transition definitions.

### Safety and isolation
- [ ] Results from sub-agents pass directly to the next stage via the workflow runtime — they are never injected into the invoking session's context window.
- [ ] A failed agent within a `parallel()` call does not silently swallow the error — the workflow run is marked `failed` and the error is surfaced in `list_workflows`.
- [ ] Workflow files are loaded from a configurable directory; loading from arbitrary absolute paths requires explicit opt-in (`WORKFLOW_ALLOW_ABSOLUTE_PATHS=true`).

---

## Implementation Phases

### Phase 1 — Core runtime (no FSM integration)

Minimal viable workflow runtime. No UI, no GSD wiring.

- `src/workflow/runtime.ts` — `WorkflowContext` class; `agent()`, `parallel()`, `pipeline()` implementations
- `src/workflow/executor.ts` — loads a `.ts` workflow file, resolves `WorkflowContext`, executes default export
- `src/workflow/budget.ts` — token budget tracker; `budgetRemaining()` helper
- `src/workflow/schema.ts` — Zod schema validation for agent outputs; `SCHEMA_MISMATCH` error type
- `src/workflow/store.ts` — `WorkflowRun` record; in-memory store keyed by `wfl_*` IDs
- Extend `handoff_task` handler: detect `workflowFile` param → hand off to executor
- Extend JSONL logger: `workflow_*` event types
- `list_workflows` MCP tool

### Phase 2 — GSD phase files

Replace the `gsd_orchestrator` model with per-phase workflow files.

- `.claude/workflows/gsd-*.ts` — one file per GSD FSM state (7 files, see §GSD Integration)
- Modify `src/roles/agent-roles.yaml`: mark `gsd_orchestrator` as `deprecated: true`
- Modify FSM post-transition hook (`job-runner.ts`): detect workflow file for new state → invoke executor; fall back to model orchestrator if no file present (backwards compatible)
- Integration tests: happy-path execution for `gsd-executing.ts` and `gsd-verifying.ts` with mocked `handoff_task` dispatch

### Phase 3 — `pipeline()` streaming and budget guard

- Implement the streaming `pipeline()` primitive (Phase 1 may ship with a batch approximation — Phase 3 makes it true streaming)
- Budget guard: real token counting from `get_result` responses; `BUDGET_EXCEEDED` halt
- `ctx.budgetRemaining()` live counter

### Phase 4 — Hardening and visibility polish

- Schema mismatch retry loop (Phase 1 may surface mismatch as immediate error)
- Per-workflow pause/resume (`cancel_task` extended for workflow runs)
- `list_workflows` per-phase agent job linkage (so you can call `check_status` on individual agents within a running workflow)
- Configurable workflow file directory (`WORKFLOW_DIR` env var; default `.claude/workflows`)

---

## Open Questions

1. **Runtime isolation.** Workflow files are TypeScript — they run in the same Bun process as the MCP server. Should they run in a Bun worker thread for isolation, or is same-process acceptable given the files are developer-authored?

2. **Workflow file format.** The reference implementation (Claude Code) uses plain JavaScript with runtime-injected globals. We're proposing TypeScript with an explicit `WorkflowContext` import. Is the explicit import better DX, or should we match the Claude Code ambient-globals pattern for portability?

3. **Schema library.** Zod is the natural choice (already likely in the TypeScript ecosystem here), but it adds a dependency. Alternative: a lightweight JSON Schema validator, or no runtime schema enforcement (trust the agent). Recommend Zod — schema mismatch is a real failure mode.

4. **GSD orchestrator deprecation timing.** Feature plan 04 is not yet shipped. Can Phase 2 of this PRD land before or alongside feature plan 04, so the model orchestrator never ships? Or does feature plan 04 ship first and get migrated? Recommend: ship Phase 1 of this PRD first, then build feature plan 04 directly against Phase 2 workflow files (skipping the model orchestrator entirely).

5. **Cross-workflow context.** The current `contextPayload` spec handles cross-session continuity. Should a workflow be able to spawn a *child workflow* (passing `workflowFile` inside an `agent()` call)? This would enable composable workflow primitives but adds complexity to the run store and visibility tooling.

6. **Broker alignment.** The BROKER-PRD plans to absorb agent-handoff. Where does the workflow runtime live in the broker architecture — as a first-class broker capability, or as a client-side layer that calls broker dispatch APIs? Recommend: the `WorkflowContext.agent()` call targets the broker's `handoff_task` endpoint once the broker ships, requiring only a config change in the executor.
