# agent-handoff

**Let one AI agent hand work off to another — from your editor, with full job tracking.**

Your AI coding assistant can only do one thing at a time. agent-handoff changes that: once installed, your AI can spawn Claude, Codex, Gemini, or any other agent as a background worker, hand it a task, and come back with the result. It works through MCP, so any MCP-compatible editor can use it.

---

## Install

```bash
npm install -g @daax-dev/agent-handoff
```

> **Bun required** for the MCP server and REST API — they use Bun-native APIs.
> Install Bun: `curl -fsSL https://bun.sh/install | bash`

This gives you three commands:

| Command | What it does |
|---------|-------------|
| `agent-handoff-mcp` | MCP server — what your editor connects to |
| `agent-handoff-server` | REST API backend (needed for the CLI) |
| `agent-handoff` | CLI for creating and tracking tasks from your terminal |

---

## Connect to your editor

### Claude Code

```bash
claude mcp add agent-handoff -- agent-handoff-mcp
```

Restart Claude Code, then run `list_agents` to confirm it's connected and see which agents are available on your machine.

### Cursor, Windsurf, Claude Desktop, Zed

Add this to your MCP configuration file:

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

## Hand off your first task

Once connected, your AI editor can use these MCP tools:

**1. See what agents are available on your machine**
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

**3. Check on it**
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

---

## Three ways to delegate

### Spawn a local agent

The default mode. agent-handoff spawns the agent as a child process and captures its output, exit code, and git diff.

```
handoff_task({
  agent: "claude",       // claude | codex | gemini | copilot | opencode
  prompt: "Refactor src/db/queries.ts to use parameterized queries",
  workingDirectory: "/path/to/project",
  model: "opus"          // optional
})
```

Add `spawnMode: "tmux"` to open a visible tmux window (`daax-<agent>`) so you can watch the agent work in real time.

### Delegate to a remote A2A agent

Register any [A2A-compliant](https://google.github.io/A2A/) agent by URL, then hand off tasks to it:

```
register_agent({ url: "https://research-agent.example.com", authToken: "tok_123" })

handoff_task({
  agentUrl: "https://research-agent.example.com",
  prompt: "Summarize Q4 trends in cloud compute pricing"
})
```

agent-handoff sends `message/send`, polls `tasks/get`, and returns when the task reaches a terminal state.

> Cross-machine setup and authentication: [docs/cross-machine-and-auth.md](docs/cross-machine-and-auth.md)

### Use a worker pool

Post tasks to a FIFO queue; registered workers claim and execute them. Useful when you want multiple agents running in parallel or when worker availability is dynamic.

**Queue a task:**
```
handoff_task({
  agent: "claude",
  prompt: "Optimize the user-service database queries",
  pool: true,
  requiredCapabilities: ["database"]
})
→ { jobId: "hnd_s1t2u3v4w5x6", transport: "pool" }
```

**Worker side:**
```
register_worker({ name: "db-specialist", capabilities: ["typescript", "database"] })
→ { workerId: "wkr_m3n4o5p6q7r8" }

pull_task({ workerId: "wkr_m3n4o5p6q7r8" })
→ { available: true, jobId: "hnd_s1t2u3v4w5x6", prompt: "Optimize..." }

submit_result({ workerId: "wkr_m3n4o5p6q7r8", jobId: "hnd_s1t2u3v4w5x6",
                status: "completed", output: "Reduced p95 latency by 40%" })
```

Workers must heartbeat every 60 seconds (`worker_heartbeat`) or they go offline.

---

## CLI — manage tasks from your terminal

The CLI lets you create and track ChangeSets. A **ChangeSet** is a unit of tracked work: a task spec, a git branch, and a status lifecycle managed by the REST API server.

**Start the server (Terminal 1):**
```bash
agent-handoff-server
# → API server listening on http://localhost:4000
```

**Use the CLI (Terminal 2):**
```bash
export AGENT_HANDOFF_URL=http://localhost:4000

agent-handoff new "add rate limiting"       # create a task + ChangeSet
agent-handoff list                           # list all active ChangeSets
agent-handoff status chg_000001             # detail for one
agent-handoff review chg_000001             # check comments + CI status
agent-handoff approve chg_000001            # approve
agent-handoff merge chg_000001              # merge the branch
agent-handoff export chg_000001             # push branch + open GitHub PR
```

### CLI reference

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

Global flags:
```bash
--url <url>     # REST API URL (overrides AGENT_HANDOFF_URL)
--token <token> # Bearer token (overrides AGENT_HANDOFF_TOKEN)
--json          # Machine-readable output (list, status, review)
```

---

## Tools reference

### Core tools

| Tool | Description |
|------|-------------|
| `handoff_task` | Dispatch a task (CLI spawn, A2A, or pool) |
| `check_status` | Poll job status |
| `get_result` | Retrieve full output and git diff |
| `cancel_task` | Kill a running or queued job |
| `list_agents` | List available CLI agents and registered A2A agents |
| `register_agent` | Register an A2A endpoint |

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
| `agent` | `string` | CLI agent: `claude`, `codex`, `gemini`, `copilot`, `opencode` |
| `agentUrl` | `string` | A2A endpoint URL (mutually exclusive with `agent`) |
| `prompt` | `string` | Task description |
| `workingDirectory` | `string` | Working directory (CLI agents) |
| `model` | `string` | Model override, e.g. `"opus"`, `"o3"`, `"gemini-2.5-flash"` |
| `timeoutMs` | `number` | Timeout in ms (default: 300 000) |
| `spawnMode` | `"headless" \| "tmux"` | CLI spawn mode (default: `"headless"`) |
| `pool` | `boolean` | Queue for worker pool instead of direct spawn |
| `requiredCapabilities` | `string[]` | Required capabilities for pool matching |
| `contextPayload` | `string` | Serialized HandoffContext for task continuation |
| `dodCriteria` | `object[]` | Definition of Done criteria (two-phase handshake) |
| `senderSpiffeId` | `string` | Sender SPIFFE ID (stored; not enforced) |

Exactly one of `agent` or `agentUrl` is required.

---

## Supported CLI agents

| Agent | Command | Notes |
|-------|---------|-------|
| Claude | `claude` | JSON output, supports `--model` |
| Codex | `codex` | JSONL via stdin |
| Gemini | `gemini` | JSON output, supports `--model` |
| Copilot | `copilot` | Plain text output |
| OpenCode | `opencode` | JSON output, supports `--model` |

All detected via PATH. Use `list_agents` to see what's installed on your system.

---

## Advanced features

### Pass state between agents

When handing off a partially complete task, attach a `contextPayload` so the receiving agent knows what was done, what decisions were made, and what comes next.

```typescript
import { createHandoffContext, serializeContext } from "@daax-dev/agent-handoff/handoff-context";

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

Payloads are deflate-compressed and base64-encoded. Limits: 50 KB compressed, 500 KB uncompressed.

### Definition of Done handshake

Require the receiving agent to commit to criteria before the task starts. If a required criterion can't be met, the handoff fails immediately.

```
handoff_task({
  agent: "claude",
  prompt: "Add OAuth2 support",
  dodCriteria: [
    { id: "tests_pass",   description: "All tests pass after changes", required: true },
    { id: "type_check",   description: "TypeScript compiles cleanly",  required: true },
    { id: "docs_updated", description: "API docs updated",             required: false }
  ]
})
```

A `CAPABILITY_MISMATCH` rejection means the receiver declared it can't meet a required criterion. `ACK_TIMEOUT` rejections retry automatically with exponential backoff (5 attempts, 100 ms → 800 ms).

### SPIFFE identity

Attach a sender SPIFFE ID for identity tracing. Stored on the job; not yet enforced for access control.

```
handoff_task({
  agentUrl: "https://agent.example.com",
  prompt: "...",
  senderSpiffeId: "spiffe://trust-domain.example.com/agent/coordinator"
})
```

---

## Configuration

### MCP server env vars

| Variable | Default | Purpose |
|----------|---------|---------|
| `RECEIVER_CAPABILITIES` | _(unset)_ | Comma-separated capability IDs for local DoD evaluation. When unset, `dodCriteria` handshakes are accepted locally. |
| `HAWKEYE_URL` | _(unset)_ | HTTP endpoint to POST a warning when a handshake times out. Best-effort. |
| `HANDOFF_LOG_PROMPTS` | `false` | Set `"true"` to include prompt text (≤500 chars) in logs. Redacted by default. |
| `HANDOFF_LOG_DIR` | `.logs/handoffs` | Directory for JSONL event logs. |

### REST API server env vars

| Variable | Default | Purpose |
|----------|---------|---------|
| `PORT` | `4000` | Port the REST API listens on |
| `API_TOKEN` | _(unset)_ | When set, all requests require `Authorization: Bearer <token>`. Health endpoint is always exempt. |
| `API_TOKEN_ALLOW_UI_ORIGIN_BYPASS` | `0` | Set `"1"` to exempt Vite dev-server origins (ports 5173–5182) from token auth when on loopback. Not for production use behind a reverse proxy. |

### CLI client env vars

| Variable | Default | Purpose |
|----------|---------|---------|
| `AGENT_HANDOFF_URL` | `http://localhost:4000` | REST API URL. Overridden by `--url`. |
| `AGENT_HANDOFF_TOKEN` | _(unset)_ | Bearer token. Overridden by `--token`. |

---

## Logging

Handoff events are logged to `.logs/handoffs/YYYY-MM-DD.jsonl` (overrideable with `HANDOFF_LOG_DIR`):

```json
{
  "timestamp": "2026-02-14T12:34:56.789Z",
  "jobId": "hnd_a1b2c3d4e5f6",
  "event": "task_created",
  "transport": "cli",
  "agent": "claude"
}
```

Set `HANDOFF_LOG_PROMPTS=true` to include the prompt text in log entries (truncated to 500 characters).

---

## Architecture

```
MCP client (Claude Code, Cursor…)
       │ stdio
agent-handoff MCP server
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
       └── JSONL logger (.logs/handoffs/)
```

All job state is in-memory and resets on server restart.

| Module | Role |
|--------|------|
| `src/job-store.ts` | In-memory job store with snapshot/rollback for retry safety |
| `src/handoff-context.ts` | HandoffContext schema, canonical serialization, deflate codec |
| `src/a2a/handshake.ts` | Two-phase DoD handshake, 30s timeout, Hawkeye escalation |
| `src/a2a/retry.ts` | Exponential backoff retry (ACK_TIMEOUT only, 5 attempts max) |
| `src/auth/spiffe.ts` | HMAC-SHA256 envelope signing and verification |
| `src/cli/` | Per-agent adapters + tmux spawner |
| `src/pool/` | FIFO job queue + worker registry with heartbeat liveness |
| `src/utils/logger.ts` | JSONL event logger (prompts redacted by default) |

---

## Development

```bash
bun run test       # run all tests (vitest)
bun run typecheck  # tsc --noEmit
```

Test files live in `tests/`. To add a CLI adapter:
1. Create `src/cli/<name>.ts` extending `BaseAdapter` — implement `buildArgs()` and `parseOutput()`
2. Add the agent name to `AgentName` in `src/types.ts`
3. Register in `src/cli/registry.ts`
4. Add tests in `tests/cli-adapters.test.ts`

See [docs/faq.md](docs/faq.md) for non-MCP orchestrator examples.
