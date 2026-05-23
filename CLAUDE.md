<!-- CLAUDE.md and AGENTS.md share the Operator Preferences and Hard Guardrails below. Keep them in sync. -->

# CLAUDE.md

## Project
Name: agent-handoff (`@daax-dev/agent-handoff`)
Purpose: MCP server + REST API + CLI + web UI for cross-agent task delegation — hand off work between AI coding agents (Claude, Codex, Gemini, Copilot, OpenCode, Aider) via CLI spawn or the A2A protocol, with an FSM-driven local SDLC orchestrator.
Goal: A published npm package whose three binaries (`agent-handoff-mcp`, `agent-handoff-server`, `agent-handoff`) let any MCP-compatible editor delegate, track, and review tasks across agents; "done" = typecheck clean, `vitest` green, `bun run build` succeeds, and CI passes on `main`.

---

## Operator Preferences
<!-- Operator-specific. Revise or replace when applying to a different operator. -->
- State facts only. No sugarcoating.
- Surface problems, blockers, and risks immediately.
- Consult before one-way-door decisions and before any architectural change.
- Never answer from a guess. Validate claims against primary sources. If validation is not possible, say so explicitly.
- Objective language. No first-person pronouns. No apologies or hedges.

---

## Hard Guardrails (always apply)
- Plan before any non-trivial change. Write the plan down. Wait for approval.
- Never commit or merge directly to `main`.
- Never commit secrets, tokens, keys, or `.env` files with live values.
- No destructive git (`reset --hard`, force-push, branch delete) without explicit operator approval.
- Never overwrite uncommitted user changes. Inspect existing patterns before editing.
- Run typecheck (`bun run typecheck`) and tests (`bun run test`) after changes. If that is not possible, state exactly why.
- Never edit files under `dist/` or generated SQL migration artifacts by hand.
- Log non-trivial decisions to `.logs/decisions/<topic>.jsonl`.
- Repo-local instructions override these template defaults.

---

## Required Reading
`.claude/workflow.md` is always loaded (see include below) — planning and definition of done apply to every task.

Read the matching file **before** you:
- write or edit code → `.claude/language.md` (formatting, linting, testing for that language)
- make an architectural or cross-boundary decision → `.claude/architecture.md`
- touch dependencies, runtime, or infrastructure → `.claude/stack.md`
- perform branch / PR / commit / merge operations → `.claude/sourcecontrol.md`
- write a decision or reference log entry → `.claude/history.md`

@.claude/workflow.md
