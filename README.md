# agent-handoff — Universal Agent Handoff

An MCP server that lets any AI coding agent delegate tasks to other AI agents. Supports three usage modes: direct CLI spawn, A2A protocol over HTTP, and a shared worker pool — all managed through a unified set of MCP tools.

## Overview

agent-handoff solves a simple problem: your AI coding agent needs to hand off work to another agent. Maybe it needs a specialist, maybe it wants to parallelize, or maybe it wants to fire-and-forget a background task.

**11 MCP tools** cover the full lifecycle: dispatch work, track progress, collect results, and manage workers.

**3 usage modes** give flexibility in how agents execute:

| Mode | Transport | How it works |
|------|-----------|-------------|
| **Push — CLI** | `cli` | Spawns a local agent process (headless or in tmux) |
| **Push — A2A** | `a2a` | Calls an A2A-compliant HTTP endpoint via JSON-RPC |
| **Pull — Pool** | `pool` | Queues the task; registered workers pull and execute |

## Quick Start

### Install

```bash
cd agent-handoff
bun install
```

### Run the MCP server

```bash
bun run start
# or for development with auto-reload
bun dev
```

### Add to your MCP client

Add to `~/.mcp.json` or your client's MCP config:

```json
{
  "mcpServers": {
    "agent-handoff": {
      "command": "bun",
      "args": ["run", "/path/to/agent-handoff/src/index.ts"]
    }
  }
}
```

### Basic usage

```
You: Use handoff_task to ask claude to refactor the auth module
Agent: *calls handoff_task with agent="claude", prompt="Refactor the auth module..."*
Agent: Job hnd_abc123xyz456 created. Checking status...
Agent: *calls check_status with jobId="hnd_abc123xyz456"*
Agent: Job is running (45s elapsed)...
Agent: *calls get_result with jobId="hnd_abc123xyz456"*
Agent: Done. 3 files changed, all tests passing.
```

## Usage Modes

### Push Mode — CLI Handoff

Spawn any supported CLI agent as a local process. The agent runs in the background and agent-handoff tracks its output, exit code, and git changes.

```
handoff_task({
  agent: "claude",
  prompt: "Add input validation to the signup form",
  workingDirectory: "/path/to/project",
  model: "opus"
})
```

**Response:**
```json
{
  "jobId": "hnd_a1b2c3d4e5f6",
  "status": "queued",
  "transport": "cli"
}
```

#### Tmux spawn mode

For real-time visibility into what the agent is doing, use `spawnMode: "tmux"`. This opens a new tmux window where you can watch the agent's output live.

```
handoff_task({
  agent: "claude",
  prompt: "Debug the failing test in auth.test.ts",
  spawnMode: "tmux"
})
```

The tmux window is named `daax-<agent>` (e.g., `daax-claude`). Output is captured from the pane when the command completes.

**Requirements:** tmux must be installed and a session must be active.

#### Git diff tracking

For CLI jobs, agent-handoff automatically:
1. Snapshots `git rev-parse HEAD` before the agent runs
2. After completion, runs `git diff --name-only` and `git diff --stat` against the snapshot
3. Includes `filesChanged` and `diffSummary` in the result

### Push Mode — A2A Handoff

Call any agent that implements the [A2A protocol](https://google.github.io/A2A/) (Agent-to-Agent, JSON-RPC over HTTP).

**Step 1: Register the agent**

```
register_agent({ url: "https://research-agent.example.com" })
```

This fetches `/.well-known/agent.json` from the endpoint and caches the agent card (name, description, skills).

**Step 2: Hand off the task**

```
handoff_task({
  agentUrl: "https://research-agent.example.com",
  prompt: "Research the latest trends in WebAssembly"
})
```

**Response:**
```json
{
  "jobId": "hnd_x9y8z7w6v5u4",
  "status": "queued",
  "transport": "a2a"
}
```

agent-handoff sends a `message/send` JSON-RPC call, then polls `tasks/get` until the task reaches a terminal state. Results include agent messages and artifacts.

### Pull Mode — Worker Pool

Instead of pushing work to a specific agent, queue tasks for any available worker to pick up. This is ideal for multi-agent architectures where agents self-organize.

**Step 1: Register workers**

Each worker agent calls:
```
register_worker({
  name: "backend-specialist",
  capabilities: ["typescript", "database"]
})
```

**Response:**
```json
{
  "workerId": "wkr_m3n4o5p6q7r8",
  "name": "backend-specialist",
  "status": "idle",
  "capabilities": ["typescript", "database"]
}
```

**Step 2: Queue a task**

The coordinator hands off with `pool: true`:
```
handoff_task({
  agent: "claude",
  prompt: "Optimize the database queries in user-service",
  pool: true,
  requiredCapabilities: ["database"]
})
```

**Response:**
```json
{
  "jobId": "hnd_s1t2u3v4w5x6",
  "status": "queued",
  "transport": "pool",
  "mode": "pool"
}
```

**Step 3: Worker pulls and executes**

```
pull_task({ workerId: "wkr_m3n4o5p6q7r8" })
```

**Response:**
```json
{
  "available": true,
  "jobId": "hnd_s1t2u3v4w5x6",
  "prompt": "Optimize the database queries in user-service",
  "requiredCapabilities": ["database"],
  "timeoutMs": 300000
}
```

Matching semantics:
- Jobs with no `requiredCapabilities` are pullable by any idle worker.
- Jobs with `requiredCapabilities` are only pullable by workers that include all required capability tokens.
- Matching is capability-aware while preserving FIFO among each worker's matchable jobs.

**Step 4: Worker submits result**

```
submit_result({
  workerId: "wkr_m3n4o5p6q7r8",
  jobId: "hnd_s1t2u3v4w5x6",
  status: "completed",
  output: "Optimized 3 queries, reduced p95 latency by 40%"
})
```

**Step 5: Keep workers alive**

Workers must send heartbeats every 60 seconds or they go offline:

```
worker_heartbeat({ workerId: "wkr_m3n4o5p6q7r8" })
```

## Tools Reference

### handoff_task

Hand off a task to another AI coding agent via CLI spawn, A2A protocol, or worker pool.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `agent` | `"claude" \| "codex" \| "gemini" \| "copilot" \| "opencode" \| "aider"` | One of `agent` or `agentUrl` | CLI agent to spawn |
| `agentUrl` | `string` (URL) | One of `agent` or `agentUrl` | A2A agent endpoint URL |
| `prompt` | `string` | Yes | Task description for the agent |
| `workingDirectory` | `string` | No | Working directory for CLI agents (defaults to cwd) |
| `model` | `string` | No | Model override (agent-specific, e.g. "opus", "o3") |
| `timeoutMs` | `number` | No | Timeout in milliseconds (default: 300000) |
| `spawnMode` | `"headless" \| "tmux"` | No | Spawn mode for CLI agents (default: "headless") |
| `pool` | `boolean` | No | If true, queue for worker pool instead of direct spawn |
| `requiredCapabilities` | `string[]` | No | Required worker capabilities for pool jobs only |

**Validation rules:**
- Exactly one of `agent` or `agentUrl` must be provided
- If `agent` is specified, the CLI tool must be available on PATH
- `requiredCapabilities` is only valid when `pool` is `true`
- Capability tokens are normalized by trimming whitespace and lowercasing

### check_status

Check the status of a handoff job.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `jobId` | `string` | Yes | The job ID returned by handoff_task |

**Response:**
```json
{
  "jobId": "hnd_a1b2c3d4e5f6",
  "status": "running",
  "transport": "cli",
  "agent": "claude",
  "durationMs": 45230
}
```

### get_result

Get the full result of a completed handoff job.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `jobId` | `string` | Yes | The job ID returned by handoff_task |

**CLI job response:**
```json
{
  "jobId": "hnd_a1b2c3d4e5f6",
  "status": "completed",
  "transport": "cli",
  "exitCode": 0,
  "stdout": "Refactored auth module...",
  "stderr": "",
  "filesChanged": ["src/auth.ts", "src/auth.test.ts"],
  "diffSummary": "2 files changed, 45 insertions(+), 12 deletions(-)"
}
```

**A2A job response:**
```json
{
  "jobId": "hnd_x9y8z7w6v5u4",
  "status": "completed",
  "transport": "a2a",
  "stdout": "Agent response text...",
  "artifacts": [
    { "name": "report", "text": "Research findings..." }
  ]
}
```

If the job is still running, returns:
```json
{
  "jobId": "hnd_a1b2c3d4e5f6",
  "status": "running",
  "message": "Job is still in progress. Use check_status to poll."
}
```

### list_agents

List available AI coding agents (CLI tools on PATH and registered A2A agents). Takes no parameters.

**Response:**
```json
{
  "cli": [
    { "name": "claude", "available": true, "command": "claude" },
    { "name": "codex", "available": false, "command": "codex" },
    { "name": "gemini", "available": true, "command": "gemini" },
    { "name": "copilot", "available": false, "command": "copilot" },
    { "name": "opencode", "available": false, "command": "opencode" },
    { "name": "aider", "available": false, "command": "aider" }
  ],
  "a2a": [
    { "name": "Research Agent", "url": "https://research.example.com", "skills": ["Research"] }
  ]
}
```

### register_agent

Register an A2A-compliant agent by its endpoint URL. Fetches and caches the agent card from `/.well-known/agent.json`.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `url` | `string` (URL) | Yes | Base URL of the A2A agent |

**Response:**
```json
{
  "registered": true,
  "name": "Research Agent",
  "url": "https://research.example.com",
  "description": "Performs web research",
  "skills": ["Research", "Summarization"]
}
```

### cancel_task

Cancel a running or queued handoff job. Kills the CLI process (SIGTERM) or sends `tasks/cancel` to A2A endpoints.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `jobId` | `string` | Yes | The job ID to cancel |

**Response:**
```json
{
  "jobId": "hnd_a1b2c3d4e5f6",
  "success": true,
  "status": "cancelled",
  "message": "Job cancelled successfully"
}
```

Only jobs in `queued` or `running` state can be cancelled.

### register_worker

Register as a worker in the task pool.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `name` | `string` | Yes | Worker name (e.g. agent identity) |
| `capabilities` | `string[]` | No | Worker capabilities for task matching |

**Response:**
```json
{
  "workerId": "wkr_m3n4o5p6q7r8",
  "name": "backend-specialist",
  "status": "idle",
  "capabilities": ["typescript", "database"],
  "message": "Worker registered. Use pull_task to get work, worker_heartbeat to stay alive."
}
```

### pull_task

Pull the next available task from the pool queue. Worker must be registered and idle.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `workerId` | `string` | Yes | Your worker ID from register_worker |

**Response (task available):**
```json
{
  "available": true,
  "jobId": "hnd_s1t2u3v4w5x6",
  "prompt": "Optimize database queries",
  "workingDirectory": "/path/to/project",
  "model": "opus",
  "requiredCapabilities": ["database"],
  "timeoutMs": 300000
}
```

**Response (no tasks):**
```json
{
  "available": false,
  "message": "No compatible tasks in queue"
}
```

### submit_result

Submit the result of a completed task back to the pool.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `workerId` | `string` | Yes | Your worker ID |
| `jobId` | `string` | Yes | The job ID you were assigned |
| `status` | `"completed" \| "failed"` | Yes | Task outcome |
| `output` | `string` | No | Task output / result text |
| `error` | `string` | No | Error message if failed |

**Response:**
```json
{
  "acknowledged": true,
  "jobId": "hnd_s1t2u3v4w5x6",
  "workerStatus": "idle"
}
```

### worker_heartbeat

Send a heartbeat to keep your worker registration alive. Workers go offline after 60 seconds without a heartbeat.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `workerId` | `string` | Yes | Your worker ID |

**Response:**
```json
{
  "workerId": "wkr_m3n4o5p6q7r8",
  "status": "idle",
  "lastHeartbeatAt": "2026-02-14T12:00:00.000Z"
}
```

### list_workers

List all registered workers and their current status. Takes no parameters.

**Response:**
```json
{
  "total": 3,
  "idle": 2,
  "busy": 1,
  "offline": 0,
  "workers": [
    {
      "id": "wkr_m3n4o5p6q7r8",
      "name": "backend-specialist",
      "status": "busy",
      "capabilities": ["typescript", "database"],
      "currentJobId": "hnd_s1t2u3v4w5x6",
      "lastHeartbeatAt": "2026-02-14T12:00:00.000Z"
    }
  ]
}
```

## Supported CLI Agents

| Agent | Command | Output Format | Notes |
|-------|---------|---------------|-------|
| **Claude** | `claude` | JSON (`--output-format json`) | Supports `--model` override |
| **Codex** | `codex` | JSONL (`exec --json`) | Prompt sent via stdin |
| **Gemini** | `gemini` | JSON (`--output-format json`) | Supports `--model` override |
| **Copilot** | `copilot` | Plain text | No structured output |
| **OpenCode** | `opencode` | JSON (`-f json`) | Supports `--model` override |
| **Aider** | `aider` | Plain text | Supports `--model` override |

All agents are auto-detected via `PATH`. Use `list_agents` to see which are available on your system.

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                     MCP Client                          │
│              (Claude, Cursor, etc.)                     │
└───────────────────────┬─────────────────────────────────┘
                        │ stdio (MCP protocol)
┌───────────────────────▼─────────────────────────────────┐
│                   agent-handoff server                       │
│                                                         │
│  ┌─────────────┐  ┌──────────────┐  ┌───────────────┐  │
│  │ Tool Router  │  │  Job Store   │  │    Logger     │  │
│  │ (11 tools)   │  │ (in-memory)  │  │ (.logs/tools) │  │
│  └──────┬───┬──┘  └──────────────┘  └───────────────┘  │
│         │   │                                           │
│  ┌──────▼───┼──────────┬────────────────────────────┐   │
│  │          │          │                            │   │
│  │  ┌───────▼──┐  ┌────▼─────┐  ┌────────────────┐ │   │
│  │  │CLI Runner│  │A2A Client│  │  Worker Pool    │ │   │
│  │  │          │  │          │  │                  │ │   │
│  │  │ Headless │  │ JSON-RPC │  │ ┌────────────┐  │ │   │
│  │  │ or Tmux  │  │ over HTTP│  │ │ Job Queue  │  │ │   │
│  │  └──┬───┬──┘  └────┬─────┘  │ │ (FIFO)     │  │ │   │
│  │     │   │          │        │ └────────────┘  │ │   │
│  │     │   │          │        │ ┌────────────┐  │ │   │
│  │     │   │          │        │ │  Worker    │  │ │   │
│  │     │   │          │        │ │  Registry  │  │ │   │
│  │     │   │          │        │ └────────────┘  │ │   │
│  │     │   │          │        └────────────────┘ │   │
│  └─────┼───┼──────────┼──────────────────────────┘   │
│         │   │          │                               │
└─────────┼───┼──────────┼───────────────────────────────┘
          │   │          │
    ┌─────▼┐ ┌▼────┐  ┌──▼──────────────┐
    │claude│ │tmux │  │ A2A Agent       │
    │codex │ │pane │  │ (HTTP endpoint) │
    │gemini│ │     │  └─────────────────┘
    │...   │ │     │
    └──────┘ └─────┘
```

### Key internals

- **Job Store** (`src/job-store.ts`): In-memory Map of all jobs, keyed by `hnd_*` ID. CRUD operations.
- **Job Runner** (`src/job-runner.ts`): Spawns CLI processes or manages A2A polling. Tracks git state before/after.
- **CLI Adapters** (`src/cli/`): Per-agent adapters that build command args and parse output. Base class handles process spawning.
- **Tmux Spawner** (`src/cli/tmux-spawner.ts`): Creates tmux windows, sends commands, captures pane output on completion.
- **A2A Client** (`src/a2a/client.ts`): JSON-RPC client for `message/send`, `tasks/get`, `tasks/cancel`. Includes polling.
- **Agent Card** (`src/a2a/agent-card.ts`): Fetches and caches `/.well-known/agent.json` for A2A discovery.
- **Worker Pool** (`src/pool/`): FIFO job queue + worker registry with heartbeat-based liveness.
- **Logger** (`src/utils/logger.ts`): Appends JSONL entries per completed handoff.

### Job lifecycle

```
queued → running → completed
                 → failed
                 → timed_out
       → cancelled
```

Job IDs use the format `hnd_<12 alphanumeric chars>` (e.g., `hnd_a1b2c3d4e5f6`).
Worker IDs use `wkr_<12 alphanumeric chars>`.

## Logging

Every completed handoff is logged as JSONL to `.logs/tools/handoff-YYYY-MM-DD.jsonl`.

**Log entry format:**

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

The `.logs/tools/` directory is created automatically on first write.

## Configuration

agent-handoff uses no external configuration files. All state is in-memory and resets on server restart.

**Environment:** The server inherits the shell environment from the parent process. CLI agents are spawned with the same environment, so API keys, PATH entries, and tool configs are available to child processes.

**Timeouts:** Default job timeout is 300,000ms (5 minutes). Override per-job with `timeoutMs`.

**Heartbeat:** Workers go offline after 60 seconds without a heartbeat. Sending a heartbeat to an offline worker brings it back online.

## Development

### Running tests

```bash
bun test
```

Tests are in `tests/` and cover:
- `job-store.test.ts` — CRUD operations on the job store
- `cli-adapters.test.ts` — Adapter arg building, output parsing, registry
- `a2a-client.test.ts` — Agent card registration, JSON-RPC client (mocked fetch)
- `tools.test.ts` — Tool handler logic (check_status, get_result, list_agents, cancel_task)
- `logger.test.ts` — JSONL log writing

### Adding a new CLI adapter

1. Create `src/cli/<name>.ts` extending `BaseAdapter`
2. Implement `buildArgs()` and `parseOutput()`
3. Add the agent name to the `AgentName` type in `src/types.ts`
4. Register the adapter in `src/cli/registry.ts`
5. Add tests in `tests/cli-adapters.test.ts`

### Project structure

```
src/
  index.ts              # MCP server setup, tool registration
  job-store.ts          # In-memory job store (Map)
  job-runner.ts         # CLI spawn + A2A polling orchestration
  types.ts              # All TypeScript interfaces
  cli/
    base-adapter.ts     # Abstract adapter with process spawning
    claude.ts           # Claude Code adapter
    codex.ts            # OpenAI Codex adapter (stdin-based)
    gemini.ts           # Google Gemini adapter
    copilot.ts          # GitHub Copilot adapter
    opencode.ts         # OpenCode adapter
    registry.ts         # Adapter registry + PATH detection
    tmux-spawner.ts     # Tmux window management
  a2a/
    types.ts            # A2A protocol types (AgentCard, Task, JSON-RPC)
    client.ts           # JSON-RPC client (send, get, cancel, poll)
    agent-card.ts       # Agent card fetch + registration cache
  pool/
    job-queue.ts        # FIFO queue for pool mode
    worker-registry.ts  # Worker lifecycle + heartbeat tracking
  tools/
    handoff-task.ts     # handoff_task handler
    check-status.ts     # check_status handler
    get-result.ts       # get_result handler
    list-agents.ts      # list_agents handler
    register-agent.ts   # register_agent handler
    cancel-task.ts      # cancel_task handler
    register-worker.ts  # register_worker handler
    pull-task.ts        # pull_task handler
    submit-result.ts    # submit_result handler
    worker-heartbeat.ts # worker_heartbeat handler
    list-workers.ts     # list_workers handler
  utils/
    git.ts              # Git HEAD snapshot + diff helpers
    logger.ts           # JSONL file logger
tests/                  # bun:test test files
```
