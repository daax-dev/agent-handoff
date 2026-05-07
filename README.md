# agent-handoff — Local SDLC Workbench

A local AI-assisted software development lifecycle system. ChangeSets flow through a configurable FSM, agents (Claude Code, Codex, Copilot, Aider) pick up work automatically, and a React UI gives you a live view of everything.

## Prerequisites

- [Bun](https://bun.sh) ≥ 1.0.0 — `brew install oven-sh/bun/bun`

## Quick Start

```bash
git clone <repo>
cd agent-handoff
bun run setup
bun run dev:web
```

Open http://localhost:5173

## What runs

| Process | Default Port | Purpose |
|---------|-------------|---------|
| API server | 4000 | REST + SSE + SQLite |
| UI dev server | 5173 | React SPA (Kanban + detail) |
| MCP server | stdio | Agent tool calls via `bun run src/index.ts` |

## Ports

Ports are auto-detected — if 4000 is in use, the API starts on 4001, etc. (range: 4000–4009 for API, 5173–5182 for UI). The startup output always shows which ports were selected.

To fix ports, set `PORT` and `VITE_UI_PORT` in `.env.local`.

## Connect an agent

Add to your Claude Code MCP settings (`~/.claude/claude_desktop_config.json` or similar):

```json
{
  "mcpServers": {
    "agent-handoff": {
      "command": "bun",
      "args": ["run", "src/index.ts"],
      "cwd": "/absolute/path/to/agent-handoff"
    }
  }
}
```

## Troubleshooting

**Port already in use** — The dev script finds the next free port automatically. If all 10 ports in the range are blocked, free at least one and retry.

**Database errors on startup** — Delete `.work/` and re-run `bun run setup`. Your data is only in `.work/`; removing it starts fresh.

**`bun run setup` fails** — Check that Bun ≥ 1.0.0 is installed (`bun --version`). Ensure you have write access to the repo directory.

## Configuration

See `.env.example` for all configurable environment variables. Copy to `.env.local` to override defaults (`.env.local` is never committed).
