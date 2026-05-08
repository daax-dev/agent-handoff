# Cross-Machine Delegation and Authentication

This document explains exactly what works across machines, what doesn't, and how authentication flows through agent-handoff.

## What Works Where

| Capability | Same Machine | Across Machines | Notes |
|-----------|:---:|:---:|-------|
| CLI push (spawn agent) | Yes | **No** | Spawns a local child process — physically can't run on another machine |
| A2A push (HTTP endpoint) | Yes | **Yes** | HTTP POST works anywhere the endpoint is reachable |
| Worker pool (pull mode) | Yes | **No** | In-memory queue — each MCP stdio client gets its own server process |
| Tmux spawn | Yes | **No** | Requires local tmux session |

### CLI Push — Local Only

When you call `handoff_task({ agent: "claude", prompt: "..." })`, agent-handoff spawns `claude -p "..."` as a **child process** on the machine where the MCP server is running. There is no mechanism to run a CLI agent on a remote machine.

If you need cross-machine CLI execution, you'd need to:
1. SSH into the remote machine and run the agent there (outside agent-handoff)
2. Set up the agent as an A2A HTTP endpoint and use A2A mode instead

### A2A Push — Cross-Machine Works

When you call `handoff_task({ agentUrl: "https://agent.example.com", prompt: "..." })`, agent-handoff sends an HTTP POST to that URL. The agent can be anywhere — same machine, another server, a cloud service, a different network entirely. As long as the URL is reachable, it works.

This is the intended path for cross-machine delegation.

### Worker Pool — Same Process Only

The worker pool (register_worker, pull_task, submit_result) uses an **in-memory queue** inside the agent-handoff server process. MCP's stdio transport spawns a **separate server process per client**. This means:

- Two Claude Code sessions → two separate agent-handoff processes → two separate queues
- Workers registered in one process can't see tasks queued in another

For cross-machine worker pools, agent-handoff would need to run as a persistent HTTP/SSE server with a shared backend (database or message queue). This is **not built yet**.

**What works today:** A single MCP client session where one conversation acts as coordinator and workers operate within the same session, or a single persistent server process with multiple clients connecting via a future HTTP transport.

---

## Authentication

Authentication in agent-handoff has two separate concerns:

### 1. CLI Agent Auth — Environment Variables

CLI agents inherit the shell environment of the agent-handoff server process. This means whatever API keys and tokens are set in your shell are available to spawned agents automatically.

**How it works:**
```
Your shell (ANTHROPIC_API_KEY=sk-ant-...)
  → starts MCP client (Claude Code, Cursor, etc.)
    → starts agent-handoff (inherits env)
      → spawns `claude -p "..."` (inherits env from agent-handoff)
        → claude uses ANTHROPIC_API_KEY automatically
```

**Common environment variables:**

| Agent | Variable | Purpose |
|-------|----------|---------|
| Claude | `ANTHROPIC_API_KEY` | Anthropic API access |
| Codex | `OPENAI_API_KEY` | OpenAI API access |
| Gemini | `GOOGLE_API_KEY` or `GEMINI_API_KEY` | Google API access |
| Copilot | GitHub CLI auth (`gh auth login`) | GitHub authentication |
| OpenCode | Varies by provider config | Provider-specific |

**No configuration needed.** If the API key works when you run the agent directly in your terminal, it works through agent-handoff. The spawned process gets the same environment.

**Security note:** API keys are never logged or stored by agent-handoff. They pass through `process.env` to the child process and that's it. The keys don't appear in job results, JSONL logs, or any stored state.

### 2. A2A Agent Auth — Registered Headers

A2A agents are HTTP endpoints. They may require authentication. agent-handoff supports two patterns:

#### Bearer Token

```
register_agent({
  url: "https://agent.example.com",
  authToken: "your-bearer-token-here"
})
```

This stores `Authorization: Bearer your-bearer-token-here` and sends it with every JSON-RPC request to that endpoint.

#### Custom Headers

For endpoints that use non-standard auth (API keys, custom headers):

```
register_agent({
  url: "https://agent.example.com",
  authHeaders: {
    "X-API-Key": "your-api-key",
    "X-Org-Id": "your-org-id"
  }
})
```

These headers are sent with every request (`message/send`, `tasks/get`, `tasks/cancel`).

#### How Auth Headers Flow

```
register_agent({ url: "...", authToken: "tok_123" })
  → Agent card stored with authHeaders: { Authorization: "Bearer tok_123" }

handoff_task({ agentUrl: "...", prompt: "..." })
  → Resolves auth from registered agent card
  → Creates job with authHeaders attached
  → Every HTTP request includes the headers:
      POST https://agent.example.com
      Content-Type: application/json
      Authorization: Bearer tok_123
      {"jsonrpc":"2.0","method":"message/send",...}
```

#### Auth Persistence

Auth headers are stored **in memory** with the agent registration. They do not persist across server restarts. You must re-register agents with auth on each new session.

If you need persistent auth, consider:
- Setting auth tokens as environment variables and reading them at registration time
- Using a startup script that registers agents automatically

#### Auth for Agent Card Fetch

Currently, `register_agent` fetches `/.well-known/agent.json` **without** auth headers. If the agent card itself requires authentication, this will fail. The auth headers are only applied to subsequent `message/send` and `tasks/get` calls.

If you need authenticated agent card fetch, open an issue — it's a straightforward addition.

### 3. Worker Pool Auth — None

The worker pool has no authentication mechanism. Any code that can call the MCP tools can register as a worker, pull tasks, and submit results. This is acceptable because:

- The pool is in-memory within a single process
- MCP stdio transport means only the client that started the server can access it
- There's no network exposure

If/when the pool moves to HTTP transport, authentication will be required.

---

## Cross-Machine Scenarios

### Scenario 1: Delegate to a Remote A2A Agent

Machine A runs Claude Code with agent-handoff. Machine B runs an A2A-compliant agent service.

```
Machine A (your workstation):
  Claude Code → agent-handoff → HTTP POST → Machine B

Machine B (remote server):
  A2A agent listening on https://agent.internal:8080
```

Setup on Machine A:
```
register_agent({
  url: "https://agent.internal:8080",
  authToken: "secret-token"
})

handoff_task({
  agentUrl: "https://agent.internal:8080",
  prompt: "Analyze the performance metrics for Q4"
})
```

Requirements:
- Machine B must be network-reachable from Machine A
- The A2A endpoint must serve `/.well-known/agent.json`
- Auth token must be valid for the endpoint

### Scenario 2: Tailscale Network Delegation

If both machines are on a Tailscale network, use Tailscale hostnames:

```
register_agent({
  url: "http://dev-server:8080",
  authToken: "internal-token"
})
```

Tailscale handles the networking. No public internet exposure needed.

### Scenario 3: Can't Do — Cross-Machine CLI

This does **not** work:
```
handoff_task({
  agent: "claude",  // ← This spawns a LOCAL process
  prompt: "...",
  // There's no "remoteHost" parameter
})
```

If you need to run a CLI agent on a remote machine, wrap it in an A2A endpoint:

```python
# Simple A2A wrapper (Python/FastAPI example concept)
@app.post("/")
async def handle_rpc(request: Request):
    body = await request.json()
    if body["method"] == "message/send":
        prompt = body["params"]["message"]["parts"][0]["text"]
        result = subprocess.run(["claude", "-p", prompt], capture_output=True)
        return {"jsonrpc": "2.0", "id": body["id"], "result": {...}}
```

Then register it as an A2A agent from your local machine.

### Scenario 4: Can't Do — Cross-Machine Worker Pool

This does **not** work with the current architecture:

```
Machine A: register_worker (connects to its own agent-handoff process)
Machine B: handoff_task with pool=true (connects to its own agent-handoff process)
→ Different processes, different queues. Worker on A never sees tasks from B.
```

Future: HTTP/SSE transport for agent-handoff + shared state backend would enable this.

---

## Summary Table

| Question | Answer |
|----------|--------|
| Can I delegate to an agent on another machine? | **Yes**, via A2A mode (HTTP endpoint) |
| Can I use CLI push across machines? | **No**, CLI spawns a local process |
| Can workers on different machines share a pool? | **No**, pool is in-memory per process |
| How do CLI agents get API keys? | Inherited from shell environment automatically |
| How do A2A agents get authenticated? | Bearer token or custom headers at registration |
| Are API keys stored or logged? | **No**, they pass through env and are never persisted |
| Does auth persist across restarts? | **No**, A2A registrations are in-memory |
| Can the agent card fetch be authenticated? | Not yet — only subsequent requests use auth |
