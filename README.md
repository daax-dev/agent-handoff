# agent-handoff — Local SDLC Workbench

A local AI-assisted software development lifecycle system. ChangeSets flow through a configurable FSM, agents (Claude Code, Codex, Copilot, Aider) pick up work automatically, and a React UI gives you a live view of everything.

## Prerequisites

- [Bun](https://bun.sh) ≥ 1.0.0 — `brew install oven-sh/bun/bun`

## Quick Start

```bash
git clone <repo>
cd agent-handoff
bun run setup
```

## Connect an agent

### Claude Code (one command)

Run this from inside the `agent-handoff` directory:

```bash
# Project-scoped (just your current project):
claude mcp add agent-handoff -- bun run "$(pwd)/src/index.ts"

# Global (available in every Claude Code session):
claude mcp add --scope user agent-handoff -- bun run "$(pwd)/src/index.ts"
```

That's it. No JSON editing, no path copying. Restart Claude Code and the tools are live.

### Other tools (Cursor, Windsurf, VS Code, Claude Desktop)

All of them take the same command — just swap the path to wherever you cloned the repo:

```bash
# Get your absolute path:
echo "$(pwd)/src/index.ts"
```

Then register `bun run <that path>` as an MCP stdio server in your tool's config. See [docs/installation-guide.md](docs/installation-guide.md) for copy-paste config blocks for every tool.

---

## Using it

Installing the MCP gives your agent a set of tools. Here's what to actually do with them.

### Step 1: See what agents are available

```
You: List available agents
```

The agent calls `list_agents` → shows which CLI tools (`claude`, `codex`, `gemini`, `aider`, etc.) are on your PATH and ready to receive work.

### Step 2: Hand off a task

```
You: Hand off to claude: "Add a health check endpoint at GET /health"
```

The agent calls `handoff_task` → spawns a headless `claude -p` process, runs your prompt, captures output. Returns a job ID immediately so your session stays unblocked.

### Step 3: Check and collect

```
You: Check on that handoff / Get the result
```

`check_status` → running / completed / failed  
`get_result` → full output, files changed, git diff

### Full tool list

| Tool | What it does |
|------|-------------|
| `list_agents` | Show available CLI agents and their PATH status |
| `handoff_task` | Delegate a task to another agent (CLI spawn or A2A) |
| `check_status` | Poll a job's current state |
| `get_result` | Fetch completed output, changed files, and diff |
| `cancel_task` | Kill a running job |
| `register_agent` | Add a remote A2A agent by URL |
| `register_worker` | Join the pull-mode task pool as a worker |
| `pull_task` | Grab the next queued task from the pool |
| `submit_result` | Return completed work to the pool coordinator |
| `worker_heartbeat` | Keep your worker registration alive (call every 30s) |
| `list_workers` | See all registered workers and their status |
| `create_change_set` | Start a new ChangeSet with isolated git worktree |
| `submit_for_review` | Move a ChangeSet from implementing → reviewing |
| `add_review_comment` | Attach a blocking/advisory/nit comment to a review |
| `request_changes` | Require fixes before a ChangeSet can be approved |
| `approve_change_set` | Approve and unblock a ChangeSet |
| `claim_task` | Claim an assigned task as the implementing agent |
| `log_decision` | Record a decision with rationale in the ChangeSet log |
| `get_handoff_context` | Read the full context for a ChangeSet handoff |

For full demos (push mode, pull mode, multi-agent pools, tmux) see [docs/installation-guide.md](docs/installation-guide.md).

---

## Optional: Web UI

```bash
bun run dev:web
```

Open http://localhost:5173 for a live Kanban view of all ChangeSets and jobs.

| Process | Default Port | Purpose |
|---------|-------------|---------|
| API server | 4000 | REST + SSE + SQLite |
| UI dev server | 5173 | React SPA (Kanban + detail) |
| MCP server | stdio | Agent tool calls |

Ports are auto-detected if defaults are in use (API: 4000–4009, UI: 5173–5182). Set `PORT` and `VITE_UI_PORT` in `.env.local` to pin them.

---

## Troubleshooting

**`list_agents` shows nothing available** — The CLI tools aren't on PATH. Install them (`brew install claude`, etc.) or verify with `which claude`.

**Server doesn't respond after `mcp add`** — Test it directly:
```bash
bun run src/index.ts
# Should print "agent-handoff server started" to stderr
```
If it fails, run `bun install` in the project directory first.

**Database errors on startup** — Delete `.work/` and re-run `bun run setup`. All data lives in `.work/`; removing it starts fresh.

**Pull mode workers sharing state** — The MCP stdio transport spawns a new server per client, so workers in different terminals get separate queues by default. For shared queues, use push mode or run one coordinator session that manages the pool. See [docs/installation-guide.md](docs/installation-guide.md) for the multi-agent setup.
