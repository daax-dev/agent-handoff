# Copilot Instructions

GitHub Copilot reads this file automatically. Rules here are enforced in every session.

---

## Project
Name: agent-handoff (`@daax-dev/agent-handoff`)
Purpose: MCP server + REST API + CLI + web UI for cross-agent task delegation between AI coding agents via CLI spawn or the A2A protocol, backed by an FSM-driven local SDLC orchestrator and a SQLite store.

---

## Operator Preferences
<!-- Operator-specific. Revise or replace when applying to a different operator. -->
- State facts only. No sugarcoating.
- Surface problems, blockers, and risks immediately.
- Consult before one-way-door or architectural decisions.
- Never answer from a guess. Say so when a claim cannot be validated.
- Objective language. No first-person pronouns. No apologies.

---

## Planning
- A plan is required for any non-trivial change. Trivial = typo fix, single-line config update, obvious rename.
- Write the plan first. Present it. Wait for approval. Do not start coding until approved.
- Present options with trade-offs. The operator decides; the agent executes.

---

## Stack
- Runtime: Bun >= 1.0 (CI pins 1.1.38). Server and REST API use Bun-native APIs (`bun:sqlite`); they do not run on plain Node.
- Language: TypeScript 5.9 (`strict: true`), ESM (`"type": "module"`, `module`/`moduleResolution`: NodeNext).
- Persistence: SQLite via `bun:sqlite` (DB at `.work/agent-handoff.db`, WAL + foreign keys on). Schema is migration-driven (`migrations/*.sql`); tests use an in-memory DB.
- Validation: Zod schemas. CLI uses `commander`; YAML specs via `js-yaml`.
- Web UI (`ui/`): React 18 + Vite 6 + TypeScript + Tailwind CSS + `@xyflow/react`.
- Test framework: Vitest at the root (via `bun run test` → `vitest run`). The UI (`ui/`) uses Bun's native runner (`bun:test`) + `@testing-library/react` + happy-dom (preloaded via `ui/bunfig.toml`); run with `bun --cwd ui test` (no Vitest in `ui/`, and UI tests are not wired into CI).
- CI: GitHub Actions (`.github/workflows/ci.yml` → `_build-and-test.yml`): typecheck, test, build on push/PR to `main`.

---

## Code Conventions
- No standalone formatter or linter is configured in this repo (no ESLint/Prettier/Biome). Match the surrounding file's existing style; do not introduce a formatter without operator approval.
- TypeScript is `strict`. No `any` / untyped code without a justifying comment.
- All tests must pass (`bun run test`) and `bun run typecheck` must be clean before declaring done.
- Lockfile (`bun.lock`) is currently gitignored even though CI runs `bun install --frozen-lockfile` and no lockfile is committed — a known inconsistency to reconcile separately. Treat dependency changes as deliberate — note them in the PR.
- Never edit files under `dist/` (build output) or hand-edit generated migration artifacts.
- SQLite schema changes go in a new numbered `migrations/NNN_*.sql` file — never edit an applied migration.

---

## Source Control
- Host: GitHub — `github.com/daax-dev/agent-handoff`. Default branch `main`.
- Never commit directly to `main`. All work lands via PR.
- Branch naming: `feature/`, `fix/`, `docs/`, `chore/`.
- Commits: imperative mood, present tense. Subject <= 72 characters. Body explains **why**.
- PR body must include: problem statement, approach, alternatives considered, test evidence.
- Never merge your own PR unless explicitly authorized.
- Never commit secrets, tokens, keys, or `.env` files with live values.

---

## Architecture
- Module boundary = test boundary. If two modules cannot be tested apart, they are one module.
- Layered server: `domain/`, `orchestrator/`, `fsm/` (state machine), `mcp-tools/` + `tools/` (MCP handlers), `api/` (REST), `cli/` (commander commands), `a2a/` (JSON-RPC client/handshake), `pool/` (worker queue + registry). Keep these boundaries.
- Secrets go through environment, never source control or committed env files. UTC everywhere internally.
- "Temporary" workarounds without an expiry date and an owner are not acceptable.
- All persisted state lives in the SQLite store; do not introduce a second source of truth.

---

## Definition of Done
A task is done only when:
- All tests pass (`bun run test`).
- `bun run typecheck` passes with no errors; `bun run build` succeeds.
- PR opened with problem statement, approach, and test evidence.
- No `[FILL IN]` placeholders left in code or PR-affected source files. (Documented gaps in the `.claude/*.md` agent-config docs — explicitly annotated with "none enforced today" — are exempt.)
- Decisions logged in `.logs/decisions/` if a non-trivial choice was made.
