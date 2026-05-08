# Demo: Delegating to Non-Claude Agents

These examples show agent-handoff handing off work to agents other than Claude — Codex, Gemini, Copilot, and OpenCode.

## Prerequisites

- agent-handoff installed and registered in your MCP client
- The target CLI agent installed and on PATH
- Relevant API keys set in your shell environment

---

## Demo 1: Delegate to GitHub Copilot

Copilot CLI (`gh copilot` or standalone `copilot`) returns plain text (no structured JSON).

### Setup

```bash
# Via gh extension (recommended)
gh extension install github/gh-copilot

# Or standalone
npm install -g @githubnext/github-copilot-cli

# Verify
which copilot
```

### Usage

```
You: Ask copilot to explain the error handling patterns in src/api/

Claude: *calls list_agents()*
Claude: Copilot is available. Handing off...
Claude: *calls handoff_task({
  agent: "copilot",
  prompt: "Explain the error handling patterns used across all files in src/api/. List each pattern, which files use it, and whether it's consistent.",
  workingDirectory: "/path/to/project"
})*
Claude: Job hnd_cp01abc created. Checking...
```

Check the result:
```
You: What did copilot say?

Claude: *calls get_result({ jobId: "hnd_cp01abc" })*
Claude: Copilot found 3 error handling patterns:
  1. Try/catch with custom error classes (src/api/users.ts, src/api/auth.ts)
  2. Express error middleware (src/api/middleware/error.ts)
  3. Raw throw without wrapping (src/api/legacy/reports.ts) ← inconsistent
```

### With model override

```
handoff_task({
  agent: "copilot",
  prompt: "Review src/auth.ts for security issues",
  model: "gpt-4o"
})
```

---

## Demo 2: Delegate to Codex

Codex receives the prompt via stdin and returns JSONL output.

### Setup

```bash
# Install via npm
npm install -g @openai/codex

# Set API key
export OPENAI_API_KEY="sk-..."

# Verify
which codex
```

### Usage

```
You: Have codex optimize the database queries in src/db/

Claude: *calls handoff_task({
  agent: "codex",
  prompt: "Optimize all SQL queries in src/db/queries.ts. Use parameterized queries, add indexes where missing, and reduce N+1 patterns.",
  workingDirectory: "/path/to/project",
  model: "o3"
})*
→ { jobId: "hnd_cx01abc", status: "queued", transport: "cli" }
```

---

## Demo 3: Delegate to Gemini

Gemini CLI returns structured JSON and supports model overrides.

### Setup

```bash
# Install via npm
npm install -g @google/gemini-cli

# Authenticate
gemini auth login

# Verify
which gemini
```

### Usage

```
You: Have gemini with flash model add unit tests for the auth module

Claude: *calls handoff_task({
  agent: "gemini",
  prompt: "Write unit tests for src/auth.ts covering login, logout, and token refresh",
  workingDirectory: "/path/to/project",
  model: "gemini-2.5-flash"
})*
→ { jobId: "hnd_gm01abc", status: "queued", transport: "cli" }
```

---

## Demo 4: Cross-Agent Parallel Review

Use agent-handoff to get multiple perspectives on the same task from different agents. All jobs run simultaneously as separate child processes.

```
You: I want two agents to review src/auth/session.ts for security issues.
Hand off to claude and copilot, then compare their findings.

Claude: *calls handoff_task twice in parallel:*

1. handoff_task({
     agent: "claude",
     prompt: "Security review of src/auth/session.ts. List vulnerabilities with severity, line number, and fix.",
     model: "opus"
   })
   → Job hnd_cl_review

2. handoff_task({
     agent: "copilot",
     prompt: "Security review of src/auth/session.ts. List vulnerabilities with severity, line number, and fix."
   })
   → Job hnd_cp_review
```

Check results:

```
You: Are both reviews done?

Claude: *calls check_status for each*
  hnd_cl_review: completed (45s)
  hnd_cp_review: completed (30s)

Claude: *calls get_result for each, compares findings*
Claude: Cross-agent comparison:
  - Both found the session fixation issue on line 42
  - Claude additionally flagged the missing httpOnly cookie flag (line 93)
  - Copilot additionally flagged the session timeout being too long (line 15)
```

---

## Troubleshooting

### "Agent 'copilot' is not available on PATH"

```bash
# Via gh extension
gh extension install github/gh-copilot

# Or standalone
npm install -g @githubnext/github-copilot-cli
```

### "Agent 'codex' is not available on PATH"

```bash
npm install -g @openai/codex
export OPENAI_API_KEY="sk-..."
```

### "Agent 'gemini' is not available on PATH"

```bash
npm install -g @google/gemini-cli
gemini auth login
```
