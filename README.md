# agent-handoff

**Hand off tasks between AI agents — from any MCP client, to any agent, in three modes.**

Your Claude session shouldn't have to do everything. With agent-handoff, it can spawn a local agent subprocess, post a task to a remote A2A endpoint, or queue work for a pool of specialized workers — all through the same MCP tools, with full job tracking.

---

## Three ways to delegate

| Mode | When to use | How it works |
|------|-------------|-------------|
| **CLI spawn** | Local agent, same machine | Spawns `claude -p`, `codex`, `gemini`, etc. as a child process |
| **A2A HTTP** | Remote agent or external service | Calls an A2A-compliant JSON-RPC endpoint |
| **Worker pool** | Multi-agent queues | Tasks sit in a FIFO queue; registered workers pull and execute |

---

## Install

> **Bun required** for the MCP server and REST API server (Bun-native APIs).
> Install Bun: `curl -fsSL https://bun.sh/install | bash`

```bash
npm install -g @daax-dev/agent-handoff
```

One install, three commands:

| Command | What it does | Runtime |
|---------|-------------|---------|
| `agent-handoff-mcp` | MCP server — connects to Claude Code, Cursor, etc. | Bun |
| `agent-handoff-server` | REST API server on `:4000` — backend for the CLI | Bun |
| `agent-handoff` | CLI client — manage ChangeSets from any terminal | Node |

---

## MCP server setup

### Claude Code

```bash
claude mcp add agent-handoff -- agent-handoff-mcp
```

Restart Claude Code. Run `list_agents` to confirm it's connected.

### Cursor / Windsurf / Claude Desktop / Zed

Add to your MCP config file:

```json
{
  "mcpServers": {
    "agent-handoff": {
      "command": "agent-handoff-mcp"
    }
  }
}
```

Config file locations for each client: [docs/installation-guide.md](docs/installation-guide.md)

---

## Getting started

### MCP — hand off your first task

**1. Check what agents are available on your machine**
```
list_agents
→ claude: available ✓
→ codex: not available ✗
→ gemini: available ✓
```

**2. Hand off a task**
```
handoff_task({
  agent: "claude",
  prompt: "Add input validation to src/routes/signup.ts",
  workingDirectory: "/path/to/your/project"
})
→ { jobId: "hnd_a1b2c3d4e5f6", status: "queued" }
```

**3. Check status**
```
check_status({ jobId: "hnd_a1b2c3d4e5f6" })
→ { status: "running", durationMs: 12400 }
```

**4. Get the result**
```
get_result({ jobId: "hnd_a1b2c3d4e5f6" })
→ {
    status: "completed",
    exitCode: 0,
    filesChanged: ["src/routes/signup.ts"],
    diffSummary: "1 file changed, 34 insertions(+), 2 deletions(-)"
  }
```

### CLI — create and track a ChangeSet

**Terminal 1 — start the REST API server**
```bash
agent-handoff-server
# → API server listening on http://localhost:4000
```

**Terminal 2 — use the CLI**
```bash
export AGENT_HANDOFF_URL=http://localhost:4000
# export AGENT_HANDOFF_TOKEN=mysecret   # only if server was started with API_TOKEN set

agent-handoff new "add rate limiting"
# → Created task TSK-000001 and ChangeSet chg_000001

agent-handoff list
# ID             TASK        STATUS               TITLE
# chg_000001     TSK-000001  draft                add rate limiting

agent-handoff status chg_000001
agent-handoff review chg_000001     # blocking comments + check runs
agent-handoff approve chg_000001
agent-handoff merge chg_000001      # merge the branch
# or:
agent-handoff export chg_000001     # push branch + open GitHub PR
```

---

## CLI reference

| Command | Description |
|---------|-------------|
| `agent-handoff new <title>` | Create a task + ChangeSet, open spec in `$EDITOR` |
| `agent-handoff list` | List all active ChangeSets |
| `agent-handoff status [id]` | List all, or detail for one |
| `agent-handoff review [id]` | Blocking comments + check runs |
| `agent-handoff approve <id>` | Approve a ChangeSet |
| `agent-handoff merge <id>` | Merge into target branch |
| `agent-handoff export <id>` | Push branch + open GitHub PR |
| `agent-handoff import-issue <url>` | Import a GitHub issue as a task |
| `agent-handoff setup` | Install agent skills into `.claude/settings.json` |

Global flags (all commands):

```bash
--url <url>     # REST API server URL (overrides AGENT_HANDOFF_URL)
--token <token> # Bearer token (overrides AGENT_HANDOFF_TOKEN)
--json          # Machine-readable JSON output (list, status, review)
```

JSON output for scripting / CI:
```bash
agent-handoff list --json
agent-handoff status chg_000001 --json
agent-handoff --url http://remote:4000 --token $TOKEN list --json
```

See [docs/faq.md](docs/faq.md) for OpenClaw and non-MCP orchestrator examples.

---

## Usage

### CLI spawn

Spawn any supported agent as a background process. agent-handoff captures stdout/stderr, exit code, and the git diff.

```
handoff_task({
  agent: "claude",          // claude | codex | gemini | copilot | opencode
  prompt: "Refactor src/db/queries.ts to use parameterized queries",
  workingDirectory: "/path/to/project",
  model: "opus",            // optional model override
  timeoutMs: 120000         // default 300s
})
```

Use `spawnMode: "tmux"` to open a visible tmux window so you can watch the agent work in real time. The window is named `daax-<agent>`.

### A2A HTTP endpoint

Register any [A2A-compliant](https://google.github.io/A2A/) agent once, then hand off to it by URL.

```
register_agent({ url: "https://research-agent.example.com", authToken: "tok_123" })

handoff_task({
  agentUrl: "https://research-agent.example.com",
  prompt: "Summarize Q4 trends in cloud compute pricing"
})
```

agent-handoff sends `message/send`, polls `tasks/get`, and returns the result when the task reaches a terminal state.

> Cross-machine delegation, authentication details, and network requirements: [docs/cross-machine-and-auth.md](docs/cross-machine-and-auth.md)

### Worker pool

Queue tasks for workers to pull. Useful when you want multiple agents running in parallel or when worker availability is dynamic.

**Coordinator queues work:**
```
handoff_task({
  agent: "claude",
  prompt: "Optimize the user-service database queries",
  pool: true,
  requiredCapabilities: ["database"]
})
→ { jobId: "hnd_s1t2u3v4w5x6", transport: "pool" }
```

**Worker registers and pulls:**
```
register_worker({ name: "db-specialist", capabilities: ["typescript", "database"] })
→ { workerId: "wkr_m3n4o5p6q7r8" }

pull_task({ workerId: "wkr_m3n4o5p6q7r8" })
→ { available: true, jobId: "hnd_s1t2u3v4w5x6", prompt: "Optimize..." }
```

**Worker submits result:**
```
submit_result({ workerId: "wkr_m3n4o5p6q7r8", jobId: "hnd_s1t2u3v4w5x6",
                status: "completed", output: "Reduced p95 latency by 40%" })
```

Workers must heartbeat every 60 seconds (`worker_heartbeat`) or go offline. Capability matching is exact-token FIFO.

---

## Advanced features

### HandoffContext — pass state between agents

When handing off a partially complete task, attach a `contextPayload` so the receiving agent knows exactly what was done, what decisions were made, and what comes next.

```typescript
import { createHandoffContext, serializeContext } from "./src/handoff-context.js";

const payload = serializeContext(createHandoffContext({
  sourceJobId: "hnd_prev123",
  completed_tasks: [
    { id: "t-1", title: "Built auth scaffold", completedAt: new Date().toISOString() }
  ],
  decisions: [
    { description: "Use HMAC-SHA256 for signing", rationale: "No SPIFFE lib available",
      decidedAt: new Date().toISOString() }
  ],
  modified_files: [{ path: "src/auth/spiffe.ts", changeType: "added" }],
  next_steps: [
    { order: 1, description: "Write integration tests for signHandoff and verifyHandoff" }
  ],
  workingContext: { gitBranch: "feat/spiffe-auth", gitHeadSha: "abc1234" }
}));

handoff_task({ agent: "claude", prompt: "Continue from where I left off", contextPayload: payload })
```

The payload is deflate-compressed and base64-encoded. Serialization is deterministic (canonical JSON with sorted keys) so the same context always produces the same bytes — safe to sign or cache. Hard limits: 50 KB compressed, 500 KB uncompressed (decompression bomb guard).

### Two-phase DoD handshake

Require the receiving agent to commit to Definition of Done criteria before the task starts. If any required criterion can't be met, the handoff fails fast.

```
handoff_task({
  agent: "claude",
  prompt: "Add OAuth2 support",
  dodCriteria: [
    { id: "tests_pass", description: "All tests pass after changes", required: true },
    { id: "type_check", description: "TypeScript compiles cleanly",  required: true },
    { id: "docs_updated", description: "API docs updated",           required: false }
  ]
})
```

**How evaluation works:**
- If `RECEIVER_CAPABILITIES` env var is set, the server checks criteria against that list locally. Missing required criteria → `CAPABILITY_MISMATCH` rejection.
- If `RECEIVER_CAPABILITIES` is not set (the default), the handoff is accepted locally and the remote receiver is expected to evaluate the criteria on its end.
- A 30-second acknowledgment timeout applies. On timeout, the job fails with `ACK_TIMEOUT`.

**Failure response:**
```json
{
  "status": "failed",
  "handshakeStatus": "rejected",
  "reason": "CAPABILITY_MISMATCH",
  "detail": "Receiver cannot meet required DoD criteria: tests_pass"
}
```

### Automatic ACK retry

`ACK_TIMEOUT` rejections are automatically retried with exponential backoff. On each retry the job rolls back to its pre-handshake state so the attempt is clean.

| Attempt | Delay |
|---------|-------|
| 1st | — |
| 2nd | 100 ms |
| 3rd | 200 ms |
| 4th | 400 ms |
| 5th | 800 ms |

After 5 total attempts the job is marked `failed` with `retryExhausted: true`. Non-retryable codes (`CAPABILITY_MISMATCH`, `MALFORMED_PROPOSAL`) never retry.

### SPIFFE identity

Attach a sender SPIFFE ID to any handoff for identity tracing. Stored on the job; not yet enforced for access control.

```
handoff_task({
  agentUrl: "https://agent.example.com",
  prompt: "...",
  senderSpiffeId: "spiffe://trust-domain.example.com/agent/coordinator"
})
```

`src/auth/spiffe.ts` provides `signHandoff` / `verifyHandoff` for HMAC-SHA256 envelope signing with expiry checks, for use when building agents that emit or consume signed handoffs.

---

## Tools reference

### Core handoff tools

| Tool | Description |
|------|-------------|
| `handoff_task` | Dispatch a task (CLI spawn, A2A, or pool) |
| `check_status` | Poll job status |
| `get_result` | Retrieve full output and git diff |
| `cancel_task` | Kill a running or queued job |
| `list_agents` | List available CLI agents and registered A2A agents |
| `register_agent` | Register an A2A endpoint (fetches agent card) |

### Pool tools

| Tool | Description |
|------|-------------|
| `register_worker` | Join the worker pool with optional capabilities |
| `pull_task` | Claim the next compatible queued task |
| `submit_result` | Report task outcome back to the pool |
| `worker_heartbeat` | Keep worker registration alive (60s TTL) |
| `list_workers` | Show all workers and their current status |

### `handoff_task` parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `agent` | `"claude" \| "codex" \| "gemini" \| "copilot" \| "opencode"` | CLI agent to spawn |
| `agentUrl` | `string` (URL) | A2A endpoint URL (mutually exclusive with `agent`) |
| `prompt` | `string` | Task description |
| `workingDirectory` | `string` | Working directory for CLI agents |
| `model` | `string` | Model override (e.g. `"opus"`, `"o3"`, `"gemini-2.5-flash"`) |
| `timeoutMs` | `number` | Job timeout in ms (default: 300 000) |
| `spawnMode` | `"headless" \| "tmux"` | CLI spawn mode (default: `"headless"`) |
| `pool` | `boolean` | Queue for worker pool instead of direct spawn |
| `requiredCapabilities` | `string[]` | Required capabilities for pool jobs |
| `contextPayload` | `string` | Base64 HandoffContext from `serializeContext()` |
| `dodCriteria` | `{ id, description, required? }[]` | DoD criteria for two-phase handshake |
| `senderSpiffeId` | `string` | Sender SPIFFE ID (stored; not enforced) |

**Rules:** exactly one of `agent` or `agentUrl`; `requiredCapabilities` only when `pool: true`; CLI agent must be on PATH.

---

## Supported CLI agents

| Agent | Command | Output | Notes |
|-------|---------|--------|-------|
| Claude | `claude` | JSON | `--output-format json`, supports `--model` |
| Codex | `codex` | JSONL | Prompt via stdin, `exec --json` |
| Gemini | `gemini` | JSON | `--output-format json`, supports `--model` |
| Copilot | `copilot` | Plain text | No structured output |
| OpenCode | `opencode` | JSON | `-f json`, supports `--model` |

All detected via `PATH`. Use `list_agents` to see what's available on your system.

---

## Configuration

All job state is in-memory and resets on server restart. No config files.

### MCP server env vars

| Variable | Default | Purpose |
|----------|---------|---------|
| `RECEIVER_CAPABILITIES` | _(unset)_ | Comma-separated capability IDs for local DoD evaluation. When unset, `dodCriteria` handshakes are accepted locally. |
| `HAWKEYE_URL` | _(unset)_ | HTTP endpoint to POST a warning when a handshake times out. Best-effort. |
| `HANDOFF_LOG_PROMPTS` | `false` | Set `"true"` to include prompt text (≤500 chars) in JSONL logs. Redacted by default. |

### REST API server env vars

Start the REST API server with `bun run dev:api` (or `bun run src/api/server.ts`):

| Variable | Default | Purpose |
|----------|---------|---------|
| `PORT` | `4000` | Port the REST API listens on |
| `API_TOKEN` | _(unset)_ | When set, all API requests require `Authorization: Bearer <token>`. Health endpoint is always exempt. |
| `API_TOKEN_ALLOW_UI_ORIGIN_BYPASS` | `0` | Set `"1"` to exempt Vite dev-server origins (ports 5173–5182) from token auth when on loopback. |

### CLI client env vars

| Variable | Default | Purpose |
|----------|---------|---------|
| `AGENT_HANDOFF_URL` | `http://localhost:4000` | REST API server URL. Overridden by `--url` flag. |
| `AGENT_HANDOFF_TOKEN` | _(unset)_ | Bearer token. Overridden by `--token` flag. |
| `LOCALSDLC_API_URL` | _(unset)_ | Legacy alias for `AGENT_HANDOFF_URL`. Still recognized. |

**CLI agent auth:** agents inherit the full shell environment — API keys, PATH entries, tool configs — all available automatically.

**A2A auth:** pass `authToken` or `authHeaders` to `register_agent`. Headers are sent on every subsequent request. Not persisted across restarts.

---

## Logging

Every completed handoff is appended to `.logs/tools/handoff-YYYY-MM-DD.jsonl` (created automatically).

```json
{
  "timestamp": "2026-02-14T12:34:56.789Z",
  "jobId": "hnd_a1b2c3d4e5f6",
  "transport": "cli",
  "agent": "claude",
  "status": "completed",
  "exitCode": 0,
  "durationMs": 45230,
  "filesChanged": ["src/auth.ts"]
}
```

---

## Architecture

```
MCP client (Claude Code, Cursor…)
       │ stdio
agent-handoff server
  ├── handoff_task ──► CLI Runner (headless / tmux)
  │                       ├── claude -p …
  │                       ├── codex exec …
  │                       └── gemini -p …
  ├── handoff_task ──► A2A Client (JSON-RPC over HTTP)
  │                       └── message/send → tasks/get → tasks/cancel
  ├── handoff_task ──► Worker Pool (FIFO queue)
  │    pull_task ◄──       └── workers pull, execute, submit
  │
  └── Job Store (in-memory Map, hnd_* IDs)
       ├── snapshot / rollback (DoD retry safety)
       └── JSONL logger (.logs/tools/)
```

Key modules:

| Module | Role |
|--------|------|
| `src/job-store.ts` | In-memory job store with snapshot/rollback for retry safety |
| `src/handoff-context.ts` | HandoffContext schema, canonical serialization, deflate codec |
| `src/a2a/handshake.ts` | Two-phase DoD handshake, 30s timeout, Hawkeye escalation |
| `src/a2a/retry.ts` | Exponential backoff retry (ACK_TIMEOUT only, 5 attempts max) |
| `src/auth/spiffe.ts` | HMAC-SHA256 envelope signing and SVID verification |
| `src/cli/` | Per-agent adapters (arg building, output parsing, PATH detection) |
| `src/pool/` | FIFO job queue + worker registry with heartbeat liveness |
| `src/utils/logger.ts` | JSONL file logger (prompts redacted by default) |

---

## Development

```bash
bun test          # run all tests (vitest)
bun run typecheck # tsc --noEmit
```

Test files:

| File | Covers |
|------|--------|
| `handoff-context.test.ts` | Schema, roundtrip, size limits, decompression bomb |
| `handshake.test.ts` | Two-phase handshake, timeout, escalation, schemas |
| `handshake-retry.test.ts` | Exponential backoff, exhaustion, snapshot/rollback |
| `spiffe.test.ts` | signHandoff, verifyHandoff, expiry, malformed inputs |
| `pool.test.ts` | Worker registration, FIFO matching, heartbeat liveness |
| `job-store.test.ts` | CRUD, snapshot, rollback |
| `cli-adapters.test.ts` | Adapter arg building, output parsing, registry |
| `a2a-client.test.ts` | Agent card, JSON-RPC client (mocked fetch) |
| `tools.test.ts` | check_status, get_result, list_agents, cancel_task handlers |
| `logger.test.ts` | JSONL write, prompt redaction |

### Adding a CLI adapter

1. Create `src/cli/<name>.ts` extending `BaseAdapter`; implement `buildArgs()` and `parseOutput()`
2. Add the agent name to `AgentName` in `src/types.ts`
3. Register in `src/cli/registry.ts`
4. Add tests in `tests/cli-adapters.test.ts`

### Project layout

```
src/
  index.ts              MCP server, 23 tools registered
  job-store.ts          In-memory jobs + snapshot/rollback
  job-runner.ts         CLI spawn + A2A polling
  handoff-context.ts    HandoffContext schema + codec
  types.ts              All interfaces and event types
  cli/                  Per-agent adapters + tmux spawner
  a2a/                  A2A client, agent card, handshake, retry
  auth/                 SPIFFE/SVID envelope signing
  pool/                 FIFO queue + worker registry
  tools/                11 core tool handlers
  mcp-tools/            ChangeSet and session tool handlers
  utils/                Git helpers + JSONL logger
tests/                  Vitest tests
docs/
  installation-guide.md Full setup for all MCP clients
  cross-machine-and-auth.md Cross-machine limits + auth patterns
examples/
  demo-non-claude-agents.md CLI hand-off examples (Codex, Gemini, Copilot)
```
