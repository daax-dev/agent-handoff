# Feature Plan: GSD v1 FSM + Orchestrator Role

## Status: Draft

---

## 1. Goal

Map the GSD v1 six-command development loop onto the existing `ChangeSet` FSM as an
alternate transition set. Expose a runtime toggle between `"changeset"` mode (current
code-review lifecycle) and `"gsd"` mode (GSD v1 phase lifecycle). Both modes use the same
`change_sets` table, the same `FSMEngine`, and the same API. Introduce a `gsd_orchestrator`
agent role that drives all per-state agent dispatch when GSD mode is active.

**Key constraint:** state is always persisted in the DB. File-only state is not acceptable.

---

## 2. ChangeSet as a generic workflow entity

A `ChangeSet` is a unit of tracked work — not necessarily a code review. The `status` column
holds whichever state the active FSM dictates. The transition set loaded from `workflow.json`
defines what moves are legal. Nothing in the DB schema changes.

```
Changeset mode:  draft → planned → implementing → reviewing → approved → merged
GSD mode:        project_init → roadmap_ready → discussing → planning → executing → …
```

Both are valid FSMs on the same entity. The toggle is which transition set is loaded.

---

## 3. GSD v1 Workflow → ChangeSet State Map

GSD v1 commands and their corresponding ChangeSet states:

```
/gsd-new-project          → project_init  ──► roadmap_ready
/gsd-discuss-phase  N     → roadmap_ready ──► discussing  ──► planning
/gsd-plan-phase     N     → discussing    ──► planning    ──► plan_ready
/gsd-execute-phase  N     → plan_ready    ──► executing   ──► verifying
/gsd-verify-work    N     → verifying     ──► shipping  (or ──► gap_fixing ──► verifying)
/gsd-ship           N     → shipping      ──► phase_done
/gsd-complete-milestone   → phase_done    ──► milestone_complete
/gsd-new-milestone        → milestone_complete ──► project_init   (loop)
```

### GSD ChangeSet states

| State | Represents | Agent work in this state |
|---|---|---|
| `project_init` | Brief received, roadmap not yet built | researcher, pm_planner |
| `roadmap_ready` | Roadmap approved — phase work begins | (none; HITL gate fires here) |
| `discussing` | Capturing implementation decisions for this phase | pm_planner |
| `planning` | Research + plan generation + plan verification | researcher, planner, plan_verifier |
| `plan_ready` | Plans verified, awaiting execution go-ahead | (none; optional HITL gate) |
| `executing` | Parallel-wave code execution | implementer × wave count |
| `verifying` | Acceptance testing; gaps produce fix plans | verifier, qa_agent |
| `gap_fixing` | Executing gap-closure fix plans | fixer × gap count |
| `shipping` | Building and submitting PR | summarizer, pr_builder |
| `phase_done` | PR created; loop to next phase or close | (none) |
| `milestone_complete` | All phases shipped; ready to archive | (none; HITL gate fires here) |

### Transitions

```
project_init        → roadmap_ready       : roadmap_approved     [HITL gate]
roadmap_ready       → discussing          : start_phase
roadmap_ready       → planning            : skip_discuss
discussing          → planning            : decisions_captured
planning            → plan_ready          : plans_verified        [optional HITL gate]
plan_ready          → executing           : start_execution
executing           → verifying           : execution_complete
verifying           → shipping            : verification_passed   [HITL gate]
verifying           → gap_fixing          : gaps_found
gap_fixing          → verifying           : gaps_resolved
shipping            → phase_done          : pr_created
phase_done          → discussing          : start_next_phase      (repeating loop)
phase_done          → milestone_complete  : all_phases_done
milestone_complete  → project_init        : new_milestone
```

Abandon from any non-terminal state is always available (mirrors existing changeset FSM).

### HITL gates

| Trigger | Why human approval is required |
|---|---|
| `roadmap_approved` | Human reviews generated roadmap before any code work starts |
| `plans_verified` | Optional: human spot-checks wave plan before execution commits |
| `verification_passed` | Human walks through verify-work output and signs off on shipping |
| `new_milestone` | Human confirms archive before the next version cycle begins |

---

## 4. Toggle design

`workflow.json` gains a `mode` discriminator and independent sub-trees for each mode.
Switching modes does not clobber the other mode's layouts or HITL config.

```json
{
  "mode": "gsd",
  "changeset": {
    "transitions": [ ...current transitions... ],
    "hitlGatedTriggers": ["approve", "merge"],
    "layout": { ... }
  },
  "gsd": {
    "transitions": [ ...GSD transitions... ],
    "hitlGatedTriggers": ["roadmap_approved", "verification_passed", "new_milestone"],
    "layout": { ... }
  }
}
```

`loadWorkflowConfig()` reads `mode` and returns the matching sub-tree. Both sub-trees are
always persisted. `PUT /api/fsm/workflow` accepts a `mode` field; the change takes effect
immediately (no restart required).

### Per-ChangeSet vs. project-wide mode

Two options — one must be chosen before Phase 1 begins:

**A. Project-wide toggle (simpler).** All ChangeSets in the instance follow the active mode.
The `mode` field in `workflow.json` is the single source of truth. Switching modes means all
new ChangeSets use the new FSM; existing ChangeSets retain their old status strings (readable
but non-advanceable under the new mode).

**B. Per-ChangeSet type (coexistence).** Add a `workflow_type` column (`"changeset" | "gsd"`)
to `change_sets`. The FSMEngine loads the correct transition set per row. Allows GSD phases
and code-review ChangeSets to coexist in the same instance.

Option B costs one DB migration (~10 lines) and a small change to `FSMEngine.transition()`.
It is the more general design — recommend B if there is any chance of running mixed workflows.

---

## 5. Orchestrator role

### What it is

`gsd_orchestrator` is a new entry in `agent-roles.yaml`. It is a **reactive coordinator**
triggered once per FSM state entry (post-transition hook via `job-runner.ts`) that decides
which specialist agents to spawn for the new state, then exits. It holds no implementation
knowledge and writes no code.

```yaml
gsd_orchestrator:
  model: claude-opus-4-7
  description: >
    Reads the current GSD ChangeSet FSM state, decides which specialist agents to spawn,
    records assignments, and fires the next FSM transition when their work completes.
    Stateless between dispatches — all context loaded fresh from DB and planning artifacts.
  prompt_template: roles/prompts/gsd-orchestrator.md
```

### State → dispatch table

| FSM state | Agents dispatched | Success condition | Transition fired |
|---|---|---|---|
| `project_init` | researcher, pm_planner | PROJECT.md + ROADMAP.md written | `roadmap_approved` (HITL) |
| `roadmap_ready` | — | human approves roadmap | `start_phase` |
| `discussing` | pm_planner | CONTEXT.md written for this ChangeSet | `decisions_captured` |
| `planning` | researcher, planner, plan_verifier | PLAN.md verified | `plans_verified` |
| `plan_ready` | — | gate cleared (auto or human) | `start_execution` |
| `executing` | implementer × wave count | all wave tasks committed | `execution_complete` |
| `verifying` | verifier, qa_agent | verify report complete | `verification_passed` (HITL) or `gaps_found` |
| `gap_fixing` | fixer × gap count | gap plans executed | `gaps_resolved` |
| `shipping` | summarizer, pr_builder | PR URL in DB | `pr_created` |
| `phase_done` | — | human or auto decision | `start_next_phase` or `all_phases_done` |
| `milestone_complete` | — | human confirms | `new_milestone` (HITL) |

### Orchestrator invariants

1. **Stateless between dispatches.** Fresh context loaded per job from DB + artifact files
   (PROJECT.md, ROADMAP.md, STATE.md, CONTEXT.md, PLAN.md from the configured `artifactsRoot`).
2. **No code writes.** All file mutations happen inside specialist agent contexts.
3. **Idempotent dispatch.** Before spawning, check `agent_assignments` for live assignments in
   this ChangeSet+state. Do not re-dispatch if one is already in flight.
4. **Circuit breaker.** `verifying → gap_fixing → verifying` cycling ≥ 3 times fires
   `escalated` (reusing the existing circuit-breaker pattern from `FSMEngine`).

---

## 6. New and modified files

### New files

| Path | Purpose |
|---|---|
| `src/fsm/gsd-states.ts` | GSD transition definitions and state type union (mirrors `states.ts` shape) |
| `src/roles/prompts/gsd-orchestrator.md` | Orchestrator agent prompt template |

### Modified files

| Path | Change |
|---|---|
| `src/fsm/workflow-config.ts` | Add `mode` field; `loadWorkflowConfig()` dispatches on mode sub-tree |
| `src/roles/agent-roles.yaml` | Add `gsd_orchestrator` role |
| `src/api/routes/fsm-workflow.ts` | Accept and persist `mode` toggle in `PUT /api/fsm/workflow` |
| `ui/src/pages/FlowDiagram.tsx` | Add mode selector; load GSD or ChangeSet transitions from config |
| `workflow.json` | Add `mode` key + `gsd` sub-tree alongside existing `changeset` sub-tree |

If per-ChangeSet type (§4 Option B) is chosen, additionally:

| Path | Change |
|---|---|
| `src/db/migrations/004-workflow-type.sql` | Add `workflow_type` column to `change_sets` |
| `src/fsm/engine.ts` | Accept `workflowType` param; load correct transition set |
| `src/domain/change-set.ts` | Add `workflowType` field to entity type |

### HITL plumbing

The existing `hitlGatedTriggers` check is consumed directly in the ChangeSet route handlers.
No new engine is needed — `gsd-states.ts` uses the same `TransitionDef` shape as `states.ts`,
and the existing HITL check in the route handler works against `workflowConfig.hitlGatedTriggers`
regardless of which sub-tree is active. No HITL refactor required.

### Artifact storage

GSD planning files (PROJECT.md, ROADMAP.md, CONTEXT.md, PLAN.md, STATE.md) need a per-project
home. Add an `artifactsRoot` config field (env var `LOCALSDLC_ARTIFACTS_ROOT`, defaulting to
`~/.agent-handoff/artifacts/<changeset-id>/`). The orchestrator reads this path on each dispatch.

---

## 7. Implementation phases

### Phase 1 — FSM definition + toggle (no schema changes)
- `gsd-states.ts`: GSD state union, transition array, HITL annotations
- `workflow-config.ts`: `mode` discriminator + dual sub-tree loading
- `workflow.json`: add `gsd` sub-tree
- UI mode selector in `FlowDiagram.tsx`
- `fsm-workflow.ts` API accepts `mode` toggle

### Phase 2 — Per-ChangeSet type column (if Option B chosen in §4)
- Migration: `workflow_type` column on `change_sets` (default `"changeset"`)
- `FSMEngine.transition()`: load transition set matching the ChangeSet's `workflow_type`
- API: `POST /api/change-sets` accepts optional `workflowType` param

### Phase 3 — Orchestrator role
- `gsd-orchestrator.md` prompt template + `agent-roles.yaml` entry
- Post-transition hook in API server wires state entry to orchestrator job
- Dispatch table logic: current state → agent spawn → transition fire
- Circuit breaker for `verifying ↔ gap_fixing` cycle

### Phase 4 — Integration tests
- Happy-path: `project_init → roadmap_ready → phase_done` (mocked agents)
- Circuit-breaker: 3× `gaps_found` cycles → `escalated`
- Mode-toggle: switching modes preserves layout for both sub-trees
- Idempotency: re-entering a state with live assignments does not double-spawn

---

## 8. Open questions

1. **Per-ChangeSet coexistence (§4 A vs B).** Project-wide toggle or per-row `workflow_type`?
   Decide before Phase 1 ships so the API contract for `POST /api/change-sets` is correct.
2. **Skip-discuss flag.** Should the orchestrator auto-fire `skip_discuss` based on a config
   flag, or always enter `discussing` and let the pm_planner exit quickly when no decisions
   are captured?
3. **Workstream support.** GSD supports parallel workstreams within a phase. Model as child
   ChangeSets (each with their own GSD FSM), or as execution-only parallelism contained within
   the `executing` state?
4. **Progress endpoint.** GSD's `/gsd-progress --next` auto-detects the next step. Should
   the orchestrator expose `POST /api/gsd/advance` mirroring that behavior?
