# Demo: Push Mode — CLI Handoff

This walkthrough demonstrates agent-handoff's push mode, where you hand off a task to another AI coding agent and get results back.

## Prerequisites

- agent-handoff installed and registered in your MCP client (see [installation guide](../docs/installation-guide.md))
- At least one CLI agent on PATH (`claude`, `codex`, `gemini`, `copilot`, or `opencode`)
- A project directory to work in

## Scenario: Cross-Agent Code Review

You're working in Claude Code and want Gemini to review your auth module while you continue working on something else.

### Step 1: Check available agents

Ask your agent:

```
What agents are available? Use list_agents.
```

Expected output:
```json
{
  "cli": [
    { "name": "claude", "available": true },
    { "name": "gemini", "available": true },
    { "name": "codex", "available": false },
    { "name": "copilot", "available": false },
    { "name": "opencode", "available": false }
  ],
  "a2a": [],
  "tmuxAvailable": true
}
```

### Step 2: Hand off the review task

```
Use handoff_task to ask gemini to review the auth module in src/auth/ for security issues.
Use the tmux spawn mode so I can watch it work.
```

Your agent calls:
```json
{
  "tool": "handoff_task",
  "args": {
    "agent": "gemini",
    "prompt": "Review all files in src/auth/ for security vulnerabilities. Check for: SQL injection, XSS, insecure session handling, missing input validation, hardcoded secrets. Provide a detailed report with file, line, severity, and fix recommendation for each finding.",
    "workingDirectory": "/path/to/your/project",
    "spawnMode": "tmux"
  }
}
```

Response:
```json
{
  "jobId": "hnd_r4v7w2x9k3m1",
  "status": "queued",
  "transport": "cli",
  "agent": "gemini",
  "spawnMode": "tmux"
}
```

You can now switch to your tmux session and watch Gemini work in the `daax-gemini` window.

### Step 3: Check progress

While continuing your own work, periodically ask:

```
Check status of job hnd_r4v7w2x9k3m1
```

```json
{
  "jobId": "hnd_r4v7w2x9k3m1",
  "status": "running",
  "transport": "cli",
  "agent": "gemini",
  "durationMs": 32000
}
```

### Step 4: Get the result

When the status shows `completed`:

```
Get the result of job hnd_r4v7w2x9k3m1
```

```json
{
  "jobId": "hnd_r4v7w2x9k3m1",
  "status": "completed",
  "transport": "cli",
  "exitCode": 0,
  "stdout": "## Security Review: src/auth/\n\n### Critical\n1. **SQL Injection** in login.ts:42...",
  "filesChanged": [],
  "diffSummary": ""
}
```

No files changed because we asked for a review (read-only), not a fix. The output contains the full security report.

### Step 5: Act on the findings

You can now ask your primary agent to fix the issues Gemini found:

```
Based on the security review from Gemini, fix the SQL injection issue in src/auth/login.ts:42
```

---

## Variations

### Headless mode (default)

Same as above but without `spawnMode: "tmux"`. The agent runs as a background process — no tmux window opens. Use `check_status` to poll.

### With model override

```
Use handoff_task to ask claude to write tests for src/api/users.ts, using the opus model.
```

```json
{
  "agent": "claude",
  "prompt": "Write comprehensive unit tests for src/api/users.ts",
  "model": "opus"
}
```

### Multi-agent parallel work

Hand off multiple tasks to different agents simultaneously:

```
1. Use handoff_task to ask gemini to write API documentation for src/api/
2. Use handoff_task to ask claude to add error handling to src/services/payment.ts
3. Use handoff_task to ask codex to optimize the database queries in src/db/queries.ts
```

Each returns a separate job ID. Poll them independently with `check_status`.

### Cancel a task

If a task is taking too long or you changed your mind:

```
Cancel job hnd_r4v7w2x9k3m1
```

```json
{
  "jobId": "hnd_r4v7w2x9k3m1",
  "success": true,
  "status": "cancelled"
}
```
