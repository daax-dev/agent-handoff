# Stack

`[FILL IN]` marks an undefined entry. Treat as "ask the operator," not a guess.
Only document what is confirmed and deployable today.

---

## Runtime
- Bun >= 1.0 (`engines.bun` in package.json; CI pins `1.1.38` via `oven-sh/setup-bun`). The MCP server and REST API use Bun-native APIs (`bun:sqlite`) and do not run on plain Node.
- TypeScript 5.9 (`devDependencies.typescript: ^5.9.3`), ESM (`"type": "module"`; `module`/`moduleResolution`: NodeNext). `@types/node ^24` present for Node-compat surfaces.
- Node 22 is used only in the npm publish job (`actions/setup-node`), not for running the server.

## Frameworks
- Backend: MCP server via `@modelcontextprotocol/sdk` (stdio); REST API (`src/api/`, served by `agent-handoff-server`) using Bun's HTTP server. A2A integration is a JSON-RPC-over-HTTP client (`src/a2a/`).
- Frontend: React 18 + Vite 6 + TypeScript + Tailwind CSS 3 + `@xyflow/react` flow editor + TanStack Query + React Router (in `ui/`).
- CLI: `commander` (`src/cli/`, binary `agent-handoff` / `localsdlc`).
- Validation/specs: Zod schemas; `js-yaml` for YAML spec parsing.

## Persistence
- Primary: SQLite via `bun:sqlite` (`src/db.ts`). DB at `.work/agent-handoff.db` (override with `DB_PATH`), `journal_mode = WAL`, `foreign_keys = ON`. Schema is migration-driven (`migrations/001..015_*.sql`, runner in `src/migrations/`). Tests use an in-memory DB (`:memory:`).
- Cache: none.
- Search: none.
- Object storage: local filesystem under `.work/` (worktrees, task specs, agent logs — gitignored).

## Messaging / Eventing
- none. Cross-agent coordination is via the A2A JSON-RPC client, the in-process FSM orchestrator (`src/fsm/`, `src/orchestrator/`), and the worker pool (`src/pool/`: FIFO job queue + heartbeat worker registry).

## Auth
- Identity: none for the local server (inherits parent shell environment; spawned CLI agents inherit it too).
- Service-to-service: SPIFFE-based identity helper (`src/auth/spiffe.ts`) for A2A peer trust.

## Observability
- Traces: none.
- Metrics: none.
- Logs: JSONL appended per completed handoff to `.logs/tools/handoff-YYYY-MM-DD.jsonl` (`src/utils/logger.ts`). `.logs/` is gitignored.

## Build / Package
- TypeScript: `tsc` compiles `src/` → `dist/` (`bun run build`, with shebang fixups for the three binaries). UI builds with `tsc && vite build`.
- Package manager: Bun. Lockfile `bun.lock` is gitignored in this repo but required by CI (`bun install --frozen-lockfile`).
- CI: GitHub Actions — `.github/workflows/ci.yml` calls reusable `_build-and-test.yml` (typecheck → test → build) on push/PR to `main`. `publish.yml` publishes to npm on GitHub Release via OIDC trusted publishing.
- Artifact registry: npm (public, `@daax-dev/agent-handoff`).

## Explicitly Not in Stack
List rejected tools and the reason. Prevents re-proposal.
- No ESLint / Prettier / Biome configured. No standalone formatter or linter in the repo — do not add one without operator approval; match existing file style.
- No external/remote database, cache, or message broker — persistence is local SQLite only.
