# PRD Implementation Status

## Done — Implemented + Tested

| PRD | Name | Test file | Tests |
|-----|------|-----------|-------|
| 001 | ChangeSet Domain Model | `src/__tests__/changeset.test.ts` | 30 |
| 002 | Worktree Manager | `src/__tests__/worktree.test.ts` | 12 |
| 003 | Spec/Plan Persistence | `src/__tests__/spec-store.test.ts` | 21 |
| 004 | REST API + SSE Bus | `src/__tests__/api.test.ts` | 17 |
| 005 | FSM Engine | `src/__tests__/fsm.test.ts` | 16 |
| 007 | MCP Tools Extension | `src/__tests__/mcp-tools.test.ts` | 14 |
| 008 | Agent Role Registry | `src/__tests__/registry.test.ts` | 10 |
| 009 | Handoff Context Builder | `src/__tests__/handoff-context.test.ts` | 14 |
| 010 | Review Comment System | `src/__tests__/review-comments.test.ts` | 15 |
| 011 | Check Runner | `src/__tests__/check-runner.test.ts` | 7 |
| 012 | Per-Task Decision Log | `src/__tests__/decisions.test.ts` | 13 |
| 015 | Live Agent Stream Panel | `ui/src/__tests__/StreamPanel.test.tsx` | 3 |
| 022 | Clean Install + Dev Setup | `src/__tests__/setup.test.ts` | 12 |

**263 tests total — `bun test` runs everything.**

## Done — Implemented, Visual Verification Only

| PRD | Name | How to verify |
|-----|------|--------------|
| 013 | React App Shell + Kanban | `bun run dev:web` → http://localhost:5173 — Kanban loads |
| 014 | Diff Viewer + Inline Comments | Open a ChangeSet → Diff tab — colored diff, inline review comments |

## Not Started

| PRD | Name | Depends on |
|-----|------|-----------|
| 006 | HITL Gate System | 005 |
| 016 | localsdlc CLI | 004, 005 |
| 017 | GitHub Bridge | 005 |
| 018 | Developer Experience (port mgmt) | folded into 022 — done |
| 019 | Theme + Visual Redesign | — |
| 020 | Agent Orchestrator | 005, 009 |
| 021 | Agent Settings UI | 020 |

## Run Tests

```bash
# All tests
bun test

# Individual PRD
bun test src/__tests__/changeset.test.ts    # PRD-001
bun test src/__tests__/worktree.test.ts     # PRD-002
bun test src/__tests__/spec-store.test.ts   # PRD-003
bun test src/__tests__/api.test.ts          # PRD-004
bun test src/__tests__/fsm.test.ts          # PRD-005
bun test src/__tests__/mcp-tools.test.ts    # PRD-007
bun test src/__tests__/registry.test.ts     # PRD-008
bun test src/__tests__/handoff-context.test.ts  # PRD-009
bun test src/__tests__/review-comments.test.ts  # PRD-010
bun test src/__tests__/check-runner.test.ts # PRD-011
bun test src/__tests__/decisions.test.ts    # PRD-012
bun test ui/src/__tests__/StreamPanel.test.tsx  # PRD-015
bun test src/__tests__/setup.test.ts        # PRD-022

# Typechecks
bun run typecheck         # backend
cd ui && bun run typecheck  # frontend
```

## Manual Acceptance — PRD-022 (Clean Install)

Run `scripts/verify.sh` from the repo root. See that file for what each step checks.
