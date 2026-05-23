# Architecture

Architectural decisions require operator approval before implementation.
ADRs log to `.logs/decisions/architecture.jsonl` (see `.claude/history.md`).

---

## Default Patterns
- Layering: `domain/` (core types/logic) → `orchestrator/` + `fsm/` (state machine driving the local SDLC) → handler surfaces (`mcp-tools/` + `tools/` for MCP, `api/` for REST, `cli/commands/` for the CLI). Integrations live in `a2a/` (JSON-RPC client/handshake/agent-card) and `pool/` (worker queue + registry).
- API style: mixed — MCP tools over stdio, REST over HTTP (`src/api/`), and A2A JSON-RPC over HTTP (outbound client).
- State machine: task lifecycle is FSM-driven (`src/fsm/`). Job lifecycle: `queued → running → completed | failed | timed_out | cancelled`. Job IDs `hnd_<12 alnum>`, worker IDs `wkr_<12 alnum>`.
- Persistence: single SQLite store (`bun:sqlite`, `src/db.ts`) is the source of truth. Schema is migration-driven (`migrations/NNN_*.sql`). Do not introduce a second source of truth.
- Validation: Zod at boundaries (tool inputs, API payloads, spec parsing).
- Configuration: env vars for runtime config (e.g., `DB_PATH`); the server otherwise inherits the parent shell environment. Secrets never in source control or committed env files.
- Time: UTC everywhere internally. Local time is a presentation concern.

---

## Boundaries
- Module boundary = test boundary. If two modules cannot be tested apart, they are one module. Each `src/` subsystem has tests in `tests/` or `src/__tests__/`.
- The web UI (`ui/`) talks to the backend only through the REST API — no direct DB access from the frontend.
- A2A and CLI-spawn agents are external processes: invoke them through the adapter/client layer (`src/a2a/`, `src/cli/`), with explicit timeouts (default job timeout 300000ms) and cancellation (SIGTERM / `tasks/cancel`).
- Service-to-service trust for A2A goes through SPIFFE identity (`src/auth/spiffe.ts`).

---

## Anti-Patterns (refuse these)
- A second source of truth alongside the SQLite store, or in-memory state that should be persisted.
- Editing an already-applied SQL migration instead of adding a new numbered one.
- Hand-editing generated build output under `dist/`.
- Bypassing the adapter/client layer to shell out to an agent CLI directly from handlers.
- "Temporary" workarounds without an expiry date and an owner.
- Secrets in env files, source control, or CI variables without rotation.

---

## Decision Logging
Log to `.logs/decisions/architecture.jsonl`:
```json
{"id":"arch-001","date":"YYYY-MM-DD","decision":"...","rationale":"...","alternatives":"...","references":["https://..."]}
```

---

## Reference Architectures
When citing patterns, prefer primary sources:
- Model Context Protocol spec (modelcontextprotocol.io) and `@modelcontextprotocol/sdk`.
- A2A protocol spec (google.github.io/A2A) for cross-agent JSON-RPC.
- SPIFFE/SPIRE docs for workload identity.
- OWASP for application security patterns.
Cite the exact URL in `.logs/references/architecture.jsonl`.
