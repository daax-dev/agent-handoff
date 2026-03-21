# agent-handoff Installation & Demo Guide

## Prerequisites

```bash
# Install Bun (if not already installed)
curl -fsSL https://bun.sh/install | bash

# Install agent-handoff dependencies
cd /path/to/agent-handoff
bun install
```

The absolute path to `src/index.ts` is needed for all MCP registrations below. Get it:

```bash
echo "$(pwd)/src/index.ts"
# e.g., /Users/you/prj/ps/daax/agent-handoff/src/index.ts
```

---

## Installation by Tool

### Claude Code (CLI)

**Project-level** (recommended — scoped to one project):

Add to your project's `.mcp.json`:

```json
{
  "mcpServers": {
    "agent-handoff": {
      "command": "bun",
      "args": ["run", "/absolute/path/to/agent-handoff/src/index.ts"]
    }
  }
}
```

**Global** (available in all Claude Code sessions):

Add to `~/.claude.json` under `mcpServers`:

```json
{
  "mcpServers": {
    "agent-handoff": {
      "command": "bun",
      "args": ["run", "/absolute/path/to/agent-handoff/src/index.ts"]
    }
  }
}
```

**Verify**: Start Claude Code and run `list_agents` — you should see the 6 CLI agents with availability status.

### Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

```json
{
  "mcpServers": {
    "agent-handoff": {
      "command": "bun",
      "args": ["run", "/absolute/path/to/agent-handoff/src/index.ts"]
    }
  }
}
```

Restart Claude Desktop after editing.

### Cursor

Add to `.cursor/mcp.json` in your project root:

```json
{
  "mcpServers": {
    "agent-handoff": {
      "command": "bun",
      "args": ["run", "/absolute/path/to/agent-handoff/src/index.ts"]
    }
  }
}
```

Or configure globally via Cursor Settings → MCP Servers.

### Windsurf

Add to `~/.codeium/windsurf/mcp_config.json`:

```json
{
  "mcpServers": {
    "agent-handoff": {
      "command": "bun",
      "args": ["run", "/absolute/path/to/agent-handoff/src/index.ts"]
    }
  }
}
```

### VS Code + Continue

Add to `.continue/config.json`:

```json
{
  "mcpServers": [
    {
      "name": "agent-handoff",
      "command": "bun",
      "args": ["run", "/absolute/path/to/agent-handoff/src/index.ts"]
    }
  ]
}
```

### Zed

Add to Zed settings (`~/.config/zed/settings.json`):

```json
{
  "context_servers": {
    "agent-handoff": {
      "command": {
        "path": "bun",
        "args": ["run", "/absolute/path/to/agent-handoff/src/index.ts"]
      }
    }
  }
}
```

### Any MCP-Compatible Tool

agent-handoff is a standard stdio MCP server. The launch command is always:

```bash
bun run /absolute/path/to/agent-handoff/src/index.ts
```

Register this in whatever MCP configuration your tool supports. The server communicates via stdin/stdout using the MCP JSON-RPC protocol.

---

## Push Mode Demos

### Demo 1: CLI Handoff (Headless)

This is the simplest mode. Your agent spawns another CLI agent as a background process.

**From any MCP client (Claude Code, Cursor, etc.):**

```
You: List available agents
Agent: *calls list_agents*
→ claude: available ✓
→ codex: not available ✗
→ gemini: available ✓
→ copilot: not available ✗
→ opencode: not available ✗

You: Hand off to claude: "Add a health check endpoint at GET /health that returns { status: ok }"
Agent: *calls handoff_task({
  agent: "claude",
  prompt: "Add a health check endpoint at GET /health that returns { status: 'ok' }",
  workingDirectory: "/path/to/my-api"
})*
→ { jobId: "hnd_a1b2c3d4e5f6", status: "queued", transport: "cli" }

You: Check the status
Agent: *calls check_status({ jobId: "hnd_a1b2c3d4e5f6" })*
→ { status: "running", durationMs: 12340, transport: "cli", agent: "claude" }

You: Get the result
Agent: *calls get_result({ jobId: "hnd_a1b2c3d4e5f6" })*
→ {
    status: "completed",
    exitCode: 0,
    stdout: "Added health check endpoint...",
    filesChanged: ["src/routes/health.ts", "src/routes/index.ts"],
    diffSummary: "2 files changed, 15 insertions(+), 1 deletion(-)"
  }
```

**What happened under the hood:**
1. agent-handoff ran `claude -p "Add a health check endpoint..." --output-format json`
2. Captured stdout/stderr and exit code
3. Took a git snapshot before and ran `git diff` after
4. Logged the result to `.logs/tools/handoff-YYYY-MM-DD.jsonl`

### Demo 2: CLI Handoff with Model Override

```
You: Have gemini with flash model add unit tests for the auth module
Agent: *calls handoff_task({
  agent: "gemini",
  prompt: "Write unit tests for src/auth.ts covering login, logout, and token refresh",
  workingDirectory: "/path/to/project",
  model: "gemini-2.5-flash"
})*
→ { jobId: "hnd_g1h2i3j4k5l6", status: "queued", transport: "cli" }
```

### Demo 3: CLI Handoff in Tmux (Visible)

**Requirements:** tmux must be installed and you must be in a tmux session.

```
You: Hand off to claude in tmux so I can watch: "Debug the failing test in payment.test.ts"
Agent: *calls handoff_task({
  agent: "claude",
  prompt: "Debug the failing test in payment.test.ts and fix it",
  spawnMode: "tmux"
})*
→ { jobId: "hnd_t1u2v3w4x5y6", status: "queued", transport: "cli" }
```

**What you see:** A new tmux window named `daax-claude` appears. You can switch to it (`Ctrl-b n` or `Ctrl-b w`) and watch the agent's output in real time. When it finishes, agent-handoff captures the pane content and makes it available via `get_result`.

### Demo 4: CLI Handoff with Timeout and Cancel

```
You: Hand off to codex with a 60-second timeout
Agent: *calls handoff_task({
  agent: "codex",
  prompt: "Optimize the database queries",
  timeoutMs: 60000
})*
→ { jobId: "hnd_c1d2e3f4g5h6", status: "queued" }

You: Actually, cancel that
Agent: *calls cancel_task({ jobId: "hnd_c1d2e3f4g5h6" })*
→ { success: true, status: "cancelled" }
```

### Demo 5: A2A Handoff (Remote Agent)

```
You: Register a research agent at https://research.example.com
Agent: *calls register_agent({ url: "https://research.example.com" })*
→ {
    registered: true,
    name: "Research Agent",
    skills: ["web-research", "summarization"]
  }

You: Ask the research agent to analyze competitor pricing
Agent: *calls handoff_task({
  agentUrl: "https://research.example.com",
  prompt: "Analyze competitor pricing for cloud compute services"
})*
→ { jobId: "hnd_r1s2t3u4v5w6", status: "queued", transport: "a2a" }

You: Get the result
Agent: *calls get_result({ jobId: "hnd_r1s2t3u4v5w6" })*
→ {
    status: "completed",
    transport: "a2a",
    stdout: "Analysis of competitor pricing...",
    artifacts: [{ name: "pricing-report", text: "..." }]
  }
```

---

## Pull Mode Demos

### Demo 6: Single Worker Pool

This shows the coordinator → queue → worker flow from a single MCP client's perspective.

**Step 1: Coordinator queues tasks**

```
You: Queue a task for the pool: "Refactor the auth module to use JWT"
Agent: *calls handoff_task({
  agent: "claude",
  prompt: "Refactor the auth module to use JWT",
  pool: true
})*
→ { jobId: "hnd_p1q2r3s4t5u6", status: "queued", transport: "pool", mode: "pool" }
```

**Step 2: Worker registers and pulls**

```
You: Register as a worker named "backend-dev"
Agent: *calls register_worker({ name: "backend-dev", capabilities: ["typescript", "auth"] })*
→ { workerId: "wkr_w1x2y3z4a5b6", status: "idle" }

You: Pull a task
Agent: *calls pull_task({ workerId: "wkr_w1x2y3z4a5b6" })*
→ {
    available: true,
    jobId: "hnd_p1q2r3s4t5u6",
    prompt: "Refactor the auth module to use JWT",
    timeoutMs: 300000
  }
```

**Step 3: Worker does the work and submits**

```
You: (after doing the work) Submit the result
Agent: *calls submit_result({
  workerId: "wkr_w1x2y3z4a5b6",
  jobId: "hnd_p1q2r3s4t5u6",
  status: "completed",
  output: "Refactored auth to use JWT. Added token generation, validation middleware, and refresh endpoint."
})*
→ { acknowledged: true, workerStatus: "idle" }
```

**Step 4: Coordinator checks result**

```
You: Get the result of the auth task
Agent: *calls get_result({ jobId: "hnd_p1q2r3s4t5u6" })*
→ {
    status: "completed",
    stdout: "Refactored auth to use JWT. Added token generation..."
  }
```

### Demo 7: Multi-Agent Worker Pool

This is the power scenario: **multiple agents connected to the same MCP, each pulling work**.

**Setup:** Three terminal sessions, all with agent-handoff registered as an MCP server.

**Terminal 1 (Coordinator):**
```
Queue task 1: handoff_task({ prompt: "Add input validation", pool: true })
Queue task 2: handoff_task({ prompt: "Write API tests", pool: true })
Queue task 3: handoff_task({ prompt: "Update README", pool: true })
```

**Terminal 2 (Worker A — Claude Code):**
```
register_worker({ name: "worker-a", capabilities: ["backend"] })
→ wkr_aaa...

pull_task({ workerId: "wkr_aaa..." })
→ Gets task 1: "Add input validation"

# Does the work...

submit_result({ workerId: "wkr_aaa...", jobId: "hnd_1...", status: "completed", output: "Done" })

pull_task({ workerId: "wkr_aaa..." })
→ Gets task 3 (task 2 was already pulled by Worker B)
```

**Terminal 3 (Worker B — another Claude Code session):**
```
register_worker({ name: "worker-b", capabilities: ["testing"] })
→ wkr_bbb...

pull_task({ workerId: "wkr_bbb..." })
→ Gets task 2: "Write API tests"

# Does the work...

submit_result({ workerId: "wkr_bbb...", jobId: "hnd_2...", status: "completed", output: "Tests added" })
```

**Key insight:** All three sessions connect to the **same** agent-handoff server instance. The MCP server holds the shared queue in memory. Workers are FIFO — first to `pull_task` gets the next job.

### Demo 8: Worker Heartbeat Loop

Workers must heartbeat every 60s or go offline. In practice, the agent should call `worker_heartbeat` periodically while waiting for work:

```
register_worker({ name: "persistent-worker" })
→ wkr_xyz...

# Poll loop (the agent does this):
pull_task({ workerId: "wkr_xyz..." })  → { available: false }
worker_heartbeat({ workerId: "wkr_xyz..." })  → { status: "idle" }
# wait 30 seconds...
pull_task({ workerId: "wkr_xyz..." })  → { available: false }
worker_heartbeat({ workerId: "wkr_xyz..." })  → { status: "idle" }
# wait 30 seconds...
pull_task({ workerId: "wkr_xyz..." })  → { available: true, jobId: "hnd_..." }
# Got work! Do it, submit, repeat.
```

---

## Using with `claude -p` (Headless Claude)

### Push Mode — Yes, Works Perfectly

When you use `handoff_task({ agent: "claude" })`, agent-handoff literally runs:

```bash
claude -p "your prompt here" --output-format json
```

This is a headless, non-interactive Claude session. It works because:
- `claude -p` runs the prompt and exits
- stdout is captured as JSON
- Exit code 0 = success
- The spawned claude session inherits your environment (API keys, MCP configs, etc.)

**With model override:**
```bash
claude -p "your prompt" --output-format json --model opus
```

**Important:** The spawned `claude -p` session does NOT have access to agent-handoff's tools (it's a child process, not connected to the same MCP server). It runs with whatever MCP servers are in its own config.

### Pull Mode — Requires a Persistent Session

`claude -p` is one-shot (runs prompt, exits). Pull mode requires a loop:
1. `register_worker` → get worker ID
2. Loop: `pull_task` → do work → `submit_result` → `worker_heartbeat`

**This won't work with a single `claude -p` call** because the session ends after one response.

**Options for pull mode workers:**

#### Option A: Claude Code Interactive (Recommended)

Start an interactive Claude Code session with agent-handoff registered:

```bash
claude
# Then in the session:
# "Register as a worker named 'my-worker' and continuously poll for tasks"
```

The agent will use `register_worker`, then loop `pull_task` / `submit_result`. It stays alive because the session is interactive.

#### Option B: Script-Driven Loop

Write a bash script that loops `claude -p`:

```bash
#!/bin/bash
# worker-loop.sh — Headless pull-mode worker

# Register (one-shot)
WORKER_ID=$(claude -p "Call register_worker with name 'headless-worker'. Return ONLY the workerId, nothing else." 2>/dev/null)

while true; do
  # Pull task
  RESULT=$(claude -p "Call pull_task with workerId '$WORKER_ID'. If available, do the work described in the prompt, then call submit_result. If not available, just say 'NO_TASK'." 2>/dev/null)

  # Heartbeat
  claude -p "Call worker_heartbeat with workerId '$WORKER_ID'" 2>/dev/null

  sleep 30
done
```

This is clunky but functional. Each iteration is a separate `claude -p` session.

#### Option C: Any MCP Client as Worker

Any tool that supports MCP can be a worker:
- **Cursor**: Open a project, register as worker, agent pulls and submits
- **Windsurf**: Same pattern
- **Claude Desktop**: Same pattern
- **Custom script**: Use the MCP SDK to connect programmatically

### Summary: `claude -p` Compatibility

| Mode | Works with `claude -p`? | Notes |
|------|------------------------|-------|
| **Push (as caller)** | Yes | Any MCP client can call `handoff_task` |
| **Push (as target)** | Yes | agent-handoff spawns `claude -p` to do the work |
| **Pull (as worker)** | Partially | One-shot per iteration; needs a loop wrapper |
| **Pull (as coordinator)** | Yes | Any MCP client can queue tasks with `pool: true` |

---

## Cross-Tool Scenarios

### Scenario A: Claude Code delegates to Gemini

Your Claude Code session hands off a research task to Gemini CLI:

```
You: Use gemini to research the best caching strategies for our API
Agent: *calls handoff_task({ agent: "gemini", prompt: "Research caching strategies for REST APIs..." })*
```

Both tools must be installed (`claude` and `gemini` on PATH).

### Scenario B: Cursor delegates to Claude

You're working in Cursor with agent-handoff registered. Cursor's agent hands off:

```
handoff_task({ agent: "claude", prompt: "Refactor this module...", workingDirectory: "/path/to/project" })
```

Cursor spawns a headless `claude -p` process to do the work.

### Scenario C: Multiple editors share a work pool

1. **Coordinator** (Claude Code): Queues 5 tasks with `pool: true`
2. **Worker 1** (Cursor session): Registers, pulls tasks, submits
3. **Worker 2** (Windsurf session): Registers, pulls tasks, submits
4. **Worker 3** (Another Claude Code): Registers, pulls tasks, submits

All connected to the same agent-handoff server. Tasks distribute automatically.

### Scenario D: Claude Code delegates to Claude Code

Yes, this works — and it's the most common use case. Your interactive Claude Code session delegates a focused task to a headless `claude -p`:

```
handoff_task({
  agent: "claude",
  prompt: "Write comprehensive tests for src/auth.ts covering all edge cases",
  model: "sonnet"
})
```

Your session continues working while the headless session writes tests in the background. Check back with `get_result` when ready.

---

## Troubleshooting

### "Agent not available on PATH"

```
Error: Agent 'codex' is not available on PATH. Run list_agents to see available agents.
```

The CLI tool isn't installed or not in your shell's PATH. Install it or verify with `which codex`.

### "tmux is not available or no session exists"

For `spawnMode: "tmux"`:
1. Install tmux: `brew install tmux` (macOS) or `apt install tmux` (Linux)
2. Start a tmux session: `tmux new -s work`
3. Run your MCP client inside tmux

### Server doesn't start

```bash
# Test directly:
bun run /path/to/agent-handoff/src/index.ts
# Should print "agent-handoff server started" to stderr
```

If it fails, check that `bun install` completed successfully in the agent-handoff directory.

### Workers go offline

Workers must call `worker_heartbeat` every 60 seconds. If a worker goes offline:
- It can come back by calling `worker_heartbeat` again
- Its status changes back to `idle` (or `busy` if it had an assigned job)

### Pull mode: multiple MCP clients

For pull mode to work across multiple terminals/editors, they must all connect to the **same** MCP server process. The standard MCP stdio transport spawns a new server per client, so each client gets its own queue.

**To share a queue across clients**, you would need to either:
1. Use a persistent backing store (planned feature)
2. Use push mode instead (each client spawns its own jobs independently)
3. Run a single coordinator that queues tasks, and workers in separate sessions

In the current implementation, pull mode is most useful within a **single MCP client** that manages both the coordinator and worker roles (e.g., Claude Code with agent teams).
