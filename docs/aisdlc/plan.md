# Local AI SDLC — Comprehensive Implementation Plan

**Version:** 1.0 (post-3-round review)
**Date:** 2026-05-06
**Codebase:** `/prj/dx/src/agent-handoff` (TypeScript/Bun)
**Decision log:** `.logs/decisions.jsonl`

---

## Product Statement

A single-developer, local-first AI SDLC that gives code changes a review lifecycle with the same rigor as GitHub Pull Requests — without GitHub. One task becomes one branch becomes one worktree becomes one ChangeSet. Multiple specialized Claude agents implement, review, security-check, and summarize. A human approves before anything merges. The developer watches agents work in real time. When a change is ready, one CLI command exports it as a real GitHub PR.

**What this is NOT:** A GitHub wrapper. A LangGraph app. A Python service. A Gitea instance. A new agent framework.

**What this IS:** An extension of the existing `agent-handoff` MCP server — adding a ChangeSet domain model, a git worktree lifecycle manager, a hand-rolled TypeScript FSM, a REST/SSE API, a React dashboard, and a CLI bridge to GitHub.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                        React SPA (Vite)                          │
│  Kanban  │  ChangeSet Detail  │  Diff Viewer  │  Agent Stream    │
└──────────────────────────┬──────────────────────────────────────┘
                           │ REST + SSE
┌──────────────────────────▼──────────────────────────────────────┐
│                   REST API (Bun HTTP server)                      │
│   /api/change-sets  │  /api/tasks  │  /events/stream (SSE)       │
└──────────────────────────┬──────────────────────────────────────┘
                           │ in-process
┌──────────────────────────▼──────────────────────────────────────┐
│               Orchestrator (Hand-rolled TypeScript FSM)           │
│   State machine  │  HITL gates  │  Agent dispatch               │
└──────────┬───────────────┬────────────────────────────────────── ┘
           │               │
┌──────────▼──────┐  ┌─────▼──────────────────────────────────────┐
│  MCP Server     │  │          SQLite (bun:sqlite)                │
│  (extended)     │  │  change_sets │ tasks │ review_comments      │
│  11 tools +     │  │  check_runs  │ decisions │ agent_runs       │
│  new CS tools   │  └────────────────────────────────────────────┘
└──────────┬──────┘
           │ stdio / tmux / pool
┌──────────▼──────────────────────────────────────────────────────┐
│                    Claude Code Agents                             │
│  Planner │ Implementer │ Test Agent │ Security Reviewer │ Fixer  │
│  Architecture Reviewer │ Summarizer                             │
└─────────────────────────────────────────────────────────────────┘
           │
┌──────────▼──────────────────────────────────────────────────────┐
│               Git Worktree Manager                               │
│  create_worktree(taskId)  │  teardown(changeSetId)              │
│  .work/worktrees/TSK-XXXX/                                       │
└─────────────────────────────────────────────────────────────────┘
```

### Stack

| Layer | Technology | Notes |
|-------|-----------|-------|
| Runtime | Bun | Native SQLite, file watch, subprocess |
| Language | TypeScript | Shared types across all layers |
| State | SQLite (`bun:sqlite`) | Queryable, transactional, local |
| Audit trail | JSONL append-only | `.work/decisions/TSK-XXXX.jsonl` |
| API | Bun HTTP server | REST + SSE on port 4000 |
| UI | React 18 + Vite | TypeScript, Tailwind |
| Agent protocol | MCP stdio | Existing `@modelcontextprotocol/sdk` |
| Agent output stream | Log-tail → SSE | `.work/logs/TSK-XXXX.log` → SSE |
| Terminal view | tmux (existing) | Peer to SSE, not fallback |
| Git operations | `simple-git` or native `git` CLI | Via subprocess |
| Schema validation | Zod | Shared frontend/backend |

---

## Existing Infrastructure (MVP-0)

The current `agent-handoff` codebase provides:

| Module | Path | Reuse |
|--------|------|-------|
| MCP server + 11 tools | `src/index.ts` | Extend with ChangeSet tools |
| Job store (SQLite) | `src/job-store.ts` | Extend schema; keep job table |
| Job runner | `src/job-runner.ts` | Wrap in FSM transitions |
| Tmux spawner | `src/cli/tmux-spawner.ts` | Reuse directly; add log-file pipe |
| Worker pool | `src/pool/` | Reuse for agent dispatch |
| A2A client | `src/a2a/` | Keep for external agents only |
| JSONL logger | `src/logger.ts` | Reuse for per-task decision log |
| Types | `src/types.ts` | Extend with ChangeSet types |

**Nothing is deleted.** MVP-1 extends the existing code.

---

## 6-MVP Staging

### MVP-0 (EXISTS): Agent Dispatch Infrastructure
- Multi-agent dispatch (CLI + A2A + worker pool)
- Job lifecycle (queued → running → completed/failed)
- Git diff tracking (before/after HEAD)
- JSONL logging, worker heartbeats, tmux spawning

### MVP-1: ChangeSet Domain + Git Worktrees
**PRDs:** PRD-001, PRD-002, PRD-003
- ChangeSet domain model + SQLite schema (`change_sets` table)
- Git worktree lifecycle manager (create/teardown per task)
- Spec/Plan file persistence (`.work/tasks/TSK-XXXX/spec.md`, `plan.md`, `acceptance.md`)
- ChangeSet state machine (draft→planned→implementing→reviewing→approved→merged)
- **Testable milestone:** `bun test src/__tests__/changeset.test.ts` passes; worktrees created/destroyed

### MVP-2: REST API + SSE + Basic UI
**PRDs:** PRD-004, PRD-013
- Bun HTTP server with REST endpoints for tasks + change sets
- SSE event bus (`/events/stream`) broadcasting state transitions
- React/Vite SPA with Kanban board (task list by status)
- Log-file tailing → SSE for agent output stream
- **Testable milestone:** `curl http://localhost:4000/api/change-sets` returns JSON; Kanban renders in browser

### MVP-3: MCP Tools Extension + Agent Roles
**PRDs:** PRD-005, PRD-007, PRD-008, PRD-009
- FSM engine: state transitions, checkpoint saves, rejection loops
- New MCP tools: `create_change_set`, `get_change_set`, `add_review_comment`, `approve_change_set`, `request_changes`, `get_handoff_context`
- Agent role registry (`agent-roles.yaml`) with per-role model config
- HandoffContext builder (token-efficient structured context)
- **Testable milestone:** An agent can call `create_change_set` and the FSM transitions to `planned`

### MVP-4: Multi-Agent Review Pipeline
**PRDs:** PRD-010, PRD-011, PRD-012
- Review comment system (blocking/non-blocking, per-file, per-line)
- Check runner (lint, type-check, tests run per ChangeSet)
- Per-task decision log (DEC-XXXX entries linked to TSK-XXXX)
- Full planner → implementer → reviewer → security reviewer → fixer chain
- **Testable milestone:** A full review cycle (implement → review → request changes → fix → approve) completes without human input

### MVP-5: Full Review Dashboard
**PRDs:** PRD-014, PRD-015
- Diff viewer (unified/split) with inline review comments
- Live agent stream panel (SSE-fed terminal view per ChangeSet)
- Check run status display
- **Testable milestone:** Open a ChangeSet in the UI; see diff, inline comments, and live agent output simultaneously

### MVP-6: HITL Gates + CLI Bridge
**PRDs:** PRD-006, PRD-016, PRD-017
- HITL gate system: pauses FSM at configurable checkpoints; notifies human; waits for approval/rejection
- `localsdlc` CLI: `init`, `new`, `status`, `review`, `approve`, `merge`, `export`, `import-issue`
- GitHub inner↔outer bridge: `export` pushes branch + creates GitHub PR; `import-issue` pulls GitHub issue → local task
- **Testable milestone:** `localsdlc export chg_001 --remote origin` creates a GitHub PR with ChangeSet summary as body

---

## PRD Index (17 PRDs in 6 Groups)

### Group 1: Core Domain

| PRD | Title | MVP Stage | Key Output |
|-----|-------|-----------|-----------|
| PRD-001 | ChangeSet Domain Model + State Machine | MVP-1 | `change_sets` table, FSM states, Zod schemas |
| PRD-002 | Git Worktree Lifecycle Manager | MVP-1 | `WorktreeManager` class, `.work/worktrees/` |
| PRD-003 | Spec and Plan File Persistence | MVP-1 | `.work/tasks/TSK-XXXX/` layout, `SpecStore` |

### Group 2: Orchestrator

| PRD | Title | MVP Stage | Key Output |
|-----|-------|-----------|-----------|
| PRD-004 | REST API Server + SSE Event Bus | MVP-2 | Bun HTTP, `/api/*`, `/events/stream` |
| PRD-005 | FSM Engine (State Transitions + Checkpoints) | MVP-3 | `FSMEngine`, `transition()`, SQLite checkpoint |
| PRD-006 | HITL Gate System | MVP-6 | `HITLGate`, pause/resume, approval records |

### Group 3: Agent Integration

| PRD | Title | MVP Stage | Key Output |
|-----|-------|-----------|-----------|
| PRD-007 | MCP Tools Extension (ChangeSet-Aware) | MVP-3 | 6 new MCP tools |
| PRD-008 | Agent Role Registry | MVP-3 | `agent-roles.yaml`, model routing |
| PRD-009 | HandoffContext Builder | MVP-3 | `HandoffContext`, token budget enforcement |

### Group 4: Review System

| PRD | Title | MVP Stage | Key Output |
|-----|-------|-----------|-----------|
| PRD-010 | Review Comment System | MVP-4 | `review_comments` table, blocking/advisory |
| PRD-011 | Check Runner | MVP-4 | `check_runs` table, lint/typecheck/test |
| PRD-012 | Per-Task Decision Log | MVP-4 | `decisions` table, DEC-XXXX entries per task |

### Group 5: UI

| PRD | Title | MVP Stage | Key Output |
|-----|-------|-----------|-----------|
| PRD-013 | React App Shell + Kanban Board | MVP-2 | `ui/`, Kanban by status, SSE client |
| PRD-014 | Diff Viewer + Inline Review Comments | MVP-5 | Monaco/diff2html panel, comment overlay |
| PRD-015 | Live Agent Stream Panel | MVP-5 | SSE terminal view per ChangeSet |

### Group 6: CLI + Bridge

| PRD | Title | MVP Stage | Key Output |
|-----|-------|-----------|-----------|
| PRD-016 | `localsdlc` CLI | MVP-6 | `src/cli/localsdlc.ts`, 8 subcommands |
| PRD-017 | GitHub Inner↔Outer Loop Bridge | MVP-6 | `export` + `import-issue` commands |

---

## Domain Model

### ChangeSet

```typescript
type ChangeSetStatus =
  | "draft"
  | "planned"
  | "implementing"
  | "reviewing"
  | "changes_requested"
  | "approved"
  | "merged"
  | "abandoned";

interface ChangeSet {
  id: string;              // chg_XXXXXX
  task_id: string;         // TSK-XXXXXX
  title: string;
  description: string;
  source_branch: string;   // feat/TSK-XXXXXX
  target_branch: string;   // main
  worktree_path: string;   // .work/worktrees/TSK-XXXXXX
  status: ChangeSetStatus;
  created_at: string;      // ISO 8601
  updated_at: string;
  merged_at: string | null;
  github_issue_url: string | null;
  github_pr_url: string | null;
  remote_branch: string | null;
}
```

### Task

```typescript
interface Task {
  id: string;              // TSK-XXXXXX
  change_set_id: string;   // chg_XXXXXX
  title: string;
  spec_path: string;       // .work/tasks/TSK-XXXXXX/spec.md
  plan_path: string | null;
  acceptance_path: string; // .work/tasks/TSK-XXXXXX/acceptance.md
  assigned_agent: string | null;
  agent_role: string | null;
  status: "backlog" | "in_progress" | "done" | "blocked";
  created_at: string;
}
```

### ReviewComment

```typescript
interface ReviewComment {
  id: string;
  change_set_id: string;
  author_agent: string;
  author_role: string;
  file_path: string | null;
  line_number: number | null;
  body: string;
  severity: "blocking" | "advisory" | "nit";
  resolved: boolean;
  created_at: string;
}
```

### CheckRun

```typescript
interface CheckRun {
  id: string;
  change_set_id: string;
  name: string;           // "typecheck" | "lint" | "test" | "security"
  status: "pending" | "running" | "passed" | "failed";
  output: string | null;
  started_at: string;
  completed_at: string | null;
}
```

---

## State Machine

```
draft ──────────────────► planned
  (create_change_set)       │
                            │ (assign implementer)
                            ▼
                     implementing
                            │
                    ┌───────┴───────┐
                    │               │
              (submit)         (blocker)
                    │               │
                    ▼               ▼
               reviewing      changes_requested
                    │               │
             ┌──────┴──────┐        │ (implementer picks up)
             │             │        │
       (all clear)  (changes)        └────► implementing (loop)
             │             │
             ▼             ▼
          approved   changes_requested
             │
    [HITL gate: human must approve]
             │
             ▼
          merged ──────────────────► (optional) GitHub PR via export
```

**Rejection loop:** `changes_requested` → `implementing` → `reviewing` is unbounded. An agent-level circuit breaker (max 3 review cycles) escalates to human.

**HITL checkpoints (configurable):**
1. After security review passes → before merge approval
2. After 3 failed review cycles → escalation

---

## File System Layout

```
agent-handoff/
├── src/
│   ├── index.ts                  # MCP server (extend with CS tools)
│   ├── types.ts                  # Extend with ChangeSet types
│   ├── job-store.ts              # Extend schema with new tables
│   ├── job-runner.ts             # Wrap in FSM
│   ├── fsm/
│   │   ├── engine.ts             # FSMEngine class
│   │   ├── states.ts             # State enum + transition table
│   │   └── hitl.ts               # HITLGate class
│   ├── domain/
│   │   ├── change-set.ts         # ChangeSet CRUD + Zod schema
│   │   ├── task.ts               # Task CRUD + Zod schema
│   │   ├── review-comment.ts     # ReviewComment CRUD
│   │   ├── check-run.ts          # CheckRun CRUD
│   │   └── decision.ts           # DecisionEntry CRUD
│   ├── worktree/
│   │   └── manager.ts            # WorktreeManager class
│   ├── spec/
│   │   └── store.ts              # SpecStore: read/write spec.md etc.
│   ├── context/
│   │   └── handoff-context.ts    # HandoffContext builder
│   ├── roles/
│   │   ├── agent-roles.yaml      # Per-role model + prompt config
│   │   └── registry.ts           # Role lookup + model routing
│   ├── api/
│   │   ├── server.ts             # Bun HTTP server
│   │   ├── routes/
│   │   │   ├── change-sets.ts
│   │   │   ├── tasks.ts
│   │   │   └── events.ts         # SSE endpoint
│   │   └── sse.ts                # SSE broadcaster
│   ├── cli/
│   │   ├── tmux-spawner.ts       # Existing (no changes)
│   │   └── localsdlc.ts          # New: localsdlc CLI
│   ├── tools/                    # MCP tool handlers (existing)
│   │   ├── handoff-task.ts
│   │   └── ...
│   └── mcp-tools/               # New ChangeSet MCP tools
│       ├── create-change-set.ts
│       ├── get-change-set.ts
│       ├── add-review-comment.ts
│       ├── approve-change-set.ts
│       ├── request-changes.ts
│       └── get-handoff-context.ts
├── ui/                          # React/Vite SPA
│   ├── src/
│   │   ├── App.tsx
│   │   ├── pages/
│   │   │   ├── KanbanBoard.tsx
│   │   │   ├── ChangeSetDetail.tsx
│   │   │   └── AgentStream.tsx
│   │   ├── components/
│   │   │   ├── DiffViewer.tsx
│   │   │   ├── ReviewComments.tsx
│   │   │   ├── CheckRunStatus.tsx
│   │   │   └── StreamPanel.tsx
│   │   └── hooks/
│   │       └── useSSE.ts
│   └── vite.config.ts
├── .work/                       # Runtime artifacts (gitignored)
│   ├── worktrees/
│   │   └── TSK-000001/          # Per-task git worktree
│   ├── tasks/
│   │   └── TSK-000001/
│   │       ├── spec.md
│   │       ├── plan.md
│   │       └── acceptance.md
│   └── logs/
│       └── TSK-000001.log       # Agent stdout → SSE source
├── agent-roles.yaml             # Symlinked from src/roles/
├── docs/
│   └── aisdlc/
│       ├── plan.md              # This file
│       ├── analysis.md
│       ├── tradeoffs.md
│       └── prds/                # 17 PRDs
└── .logs/
    └── decisions.jsonl          # Append-only decision log
```

---

## Agent Roles + Model Mapping

From `agent-roles.yaml` (DEC-013):

```yaml
roles:
  planner:
    model: claude-sonnet-4-6
    description: Breaks GitHub issues / task specs into implementable subtasks
    prompt_template: roles/prompts/planner.md

  implementer:
    model: claude-sonnet-4-6
    description: Writes code in the assigned worktree
    prompt_template: roles/prompts/implementer.md
    max_context_tokens: 8500

  test_agent:
    model: claude-haiku-4-5-20251001
    description: Writes and runs tests for the ChangeSet
    prompt_template: roles/prompts/test-agent.md

  reviewer:
    model: claude-sonnet-4-6
    description: Code review focused on correctness and maintainability
    prompt_template: roles/prompts/reviewer.md

  security_reviewer:
    model: claude-opus-4-7
    description: Security review — OWASP, injection, supply chain, secrets
    prompt_template: roles/prompts/security-reviewer.md

  architecture_reviewer:
    model: claude-opus-4-7
    description: Checks design decisions against ADRs and platform architecture
    prompt_template: roles/prompts/architecture-reviewer.md

  fixer:
    model: claude-sonnet-4-6
    description: Addresses blocking review comments; re-implements narrow changes
    prompt_template: roles/prompts/fixer.md

  summarizer:
    model: claude-haiku-4-5-20251001
    description: Generates ChangeSet summary for export to GitHub PR body
    prompt_template: roles/prompts/summarizer.md
```

**Env override:** `LOCALSDLC_MODEL_SECURITY_REVIEWER=claude-sonnet-4-6` overrides the YAML default.

---

## Inner↔Outer Loop Bridge Contract

**Export (inner → outer):**
```
localsdlc export chg_000001 [--remote origin] [--draft]

1. Verify ChangeSet status == "approved"
2. git push origin feat/TSK-000001
3. gh pr create \
     --title "<ChangeSet title>" \
     --body "$(localsdlc pr-body chg_000001)" \
     --head feat/TSK-000001 \
     --base main
4. Record pr_url in change_sets.github_pr_url
5. Emit SSE event: { type: "exported", changeSetId, prUrl }
```

**PR body template:**
```markdown
## Summary
<ChangeSet description>

## Changes
<diff stats from check runner>

## Review Results
<table of check runs + agent review comments>

## Decisions
<per-task decision log entries>

## Inner Loop Details
Local ChangeSet: chg_000001
Tasks: TSK-000001, TSK-000002
Review cycles: 2
Agents: planner(sonnet), implementer(sonnet), security_reviewer(opus)
```

**Import (outer → inner):**
```
localsdlc import-issue <github-issue-url>

1. gh issue view --json title,body,labels,number
2. Create local Task with issue body as spec.md
3. Set change_sets.github_issue_url = issue URL
4. Print: "Created TSK-000002 from github.com/org/repo/issues/42"
```

---

## Token Budget Policy (DEC-009)

HandoffContext enforces per-role token budgets:

| Slot | Max Tokens | Source |
|------|-----------|--------|
| Task spec | 2 048 | `.work/tasks/TSK-XXXX/spec.md` |
| Diff | 5 120 | `diff://chg_XXXX` MCP resource |
| Acceptance criteria | 1 024 | `.work/tasks/TSK-XXXX/acceptance.md` |
| Blocking review comments | 512 | `review_comments` WHERE blocking=true |
| Architecture context | 1 024 | `task://TSK-XXXX` MCP resource |
| **Total budget** | **9 728** | vs. naive ~31K |

If any slot exceeds its budget, the builder truncates with a `[truncated — see full at <ref>]` marker and emits a WARN log entry.

---

## Security Constraints

- Agents run in worktrees, not the main working tree. A malicious agent cannot corrupt `main`.
- Merge requires human approval (HITL gate, non-bypassable).
- MCP tools that modify ChangeSet state (approve, merge) require `authorization: "human"` claim in the call context.
- `localsdlc export` refuses to push if the ChangeSet is not `approved`.
- Agent stdout is written to `.work/logs/TSK-XXXX.log`; the log file path is validated to prevent path traversal.
- `gh` CLI is used for all GitHub operations — no raw API tokens stored in the codebase.

---

## Self-Review Round 1

**What's weak:** The file system layout is speculative. Path names may shift during implementation. The state machine diagram doesn't show what triggers each transition (agent tool call? API call? HITL approval?).

**Corrections:**
1. Each transition must be explicitly triggered. Added clarification in state machine diagram: tmux-pane/pool → agent calls `submit_result` (existing) or new `request_review` MCP tool → FSM `transition()` is called.
2. `.work/` is a runtime directory (gitignored). The layout is correct but the note should be explicit.
3. The token budget table should cite the Gemini doc as the source for the 31K→8.5K pattern.

**What's missing:** No mention of how the existing `job-store.ts` schema is extended (ALTER TABLE vs. migration file). Decision: Bun SQLite migrations via a `migrations/` folder with numbered `.sql` files. `job-store.ts` runs them at startup.

---

## Self-Review Round 2

**Harsher critique of Round 1:**

The Round 1 self-review added minor patches but missed a bigger structural issue: the plan conflates two concerns — **the MCP server** (which is the agent's tool plane) and **the REST API** (which is the UI's data plane). These must be separate processes or at minimum separate routers bound to different ports. Otherwise, adding the Bun HTTP server to the MCP stdio process creates a mixed-transport problem (one process would handle both `StdioServerTransport` for MCP and HTTP for the UI, which Bun supports but requires careful initialization order).

**Correction:** PRD-004 must explicitly state: the REST API server runs as a separate Bun process (or a second `Bun.serve` instance on port 4000) alongside the MCP stdio process. They share the same SQLite database. The MCP server does NOT expose HTTP directly.

**Also missing from Round 1:** Conflict resolution (Gap 3 from analysis.md). Two parallel agents working on files in different worktrees may produce merge conflicts when the ChangeSet targets the same base. The plan needs a conflict detection step before `approved → merged`. If conflict detected: FSM transitions to a `conflict_detected` intermediate state; the fixer agent rebases the worktree; check runs re-execute; reviewer re-approves.

**Adding:** `conflict_detected` state to the state machine (between `approved` and `merged`).

---

## Self-Review Round 3

**Final harsh assessment:**

The plan is architecturally sound and covers all 17 PRDs. Weaknesses that remain:

1. **No explicit data migration strategy.** The existing `job-store.ts` uses a hardcoded `CREATE TABLE IF NOT EXISTS`. This works for greenfield tables but will fail if we need to add columns to the existing `jobs` table (which we do — `change_set_id`). The plan mentions a `migrations/` folder but doesn't specify the migration runner. Decision: use a lightweight migration runner — a `migrations.ts` module that reads numbered `*.sql` files from `migrations/` and tracks applied migrations in a `schema_migrations` table.

2. **The agent-roles.yaml is listed in two places** (`src/roles/agent-roles.yaml` and a root-level symlink). Drop the symlink. The file lives in `src/roles/agent-roles.yaml`. The `localsdlc` CLI and MCP server both reference it by absolute path resolved from the repository root.

3. **MVP-3 is too large.** PRD-005, PRD-007, PRD-008, PRD-009 are in the same stage. PRD-005 (FSM engine) is a prerequisite for PRD-007 (MCP tools) and should be split off into its own milestone: MVP-2.5 (FSM engine), then PRD-007/008/009 in MVP-3. Renumbering is cosmetic; keep the 6-stage labels and note that PRD-005 must complete before PRD-007.

4. **The HITL gate (PRD-006) is in MVP-6**, which means 5 MVPs run without any human gate. This is intentional (inner-loop development needs to be fast for testing) but must be stated explicitly: **during MVP-1 through MVP-5, the FSM auto-approves after the security reviewer passes.** MVP-6 adds the HITL gate as a production-mode gate.

5. **No mention of the `bun run dev` startup sequence.** The developer needs to start two processes: the MCP server (`bun run mcp`) and the REST API + UI server (`bun run dev`). A `Makefile` or `package.json` `dev` script should start both (Bun supports `bun --bun run dev` with multiple processes via `concurrently`).

These are fixable during implementation, not plan-level blockers. The plan is complete enough to begin writing PRDs.

---

## Implementation Order (Critical Path)

```
PRD-001 ──► PRD-002 ──► PRD-003
   │
   ├──► PRD-005 (FSM engine)
   │         │
   │         ├──► PRD-007 (MCP tools)
   │         ├──► PRD-008 (Agent roles)
   │         └──► PRD-009 (HandoffContext)
   │
   ├──► PRD-004 (REST API + SSE) ──► PRD-013 (Kanban UI)
   │
   ├──► PRD-010 (Review comments)
   ├──► PRD-011 (Check runner)
   └──► PRD-012 (Decision log)
            │
            ├──► PRD-014 (Diff viewer)
            ├──► PRD-015 (Stream panel)
            │
            ├──► PRD-006 (HITL gates)
            ├──► PRD-016 (localsdlc CLI)
            └──► PRD-017 (GitHub bridge)
```

PRD-001 is the root. Nothing builds until the ChangeSet schema + state enum exist.

---

## Decision Log References

All architectural decisions are recorded in `.logs/decisions.jsonl`. Key decisions by PRD:

| PRD(s) | Decisions |
|--------|-----------|
| PRD-001 | DEC-001 (FSM), DEC-004 (ChangeSet naming), DEC-005 (TypeScript) |
| PRD-002 | DEC-007 (MVP staging) |
| PRD-003 | (analysis.md Gap 4 — spec persistence) |
| PRD-004 | DEC-002 (React SPA), DEC-008 (streaming peers) |
| PRD-005 | DEC-001 (hand-rolled FSM) |
| PRD-006 | (analysis.md Round 1, item 6 — HITL non-negotiable) |
| PRD-007 | DEC-003 (A2A external only) |
| PRD-008 | DEC-013 (per-role model mapping) |
| PRD-009 | DEC-009 (HandoffContext builder) |
| PRD-013 | DEC-002 (visualization stack) |
| PRD-017 | DEC-010 (inner/outer loop bridge) |
