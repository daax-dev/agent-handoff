# Demo: Delegating to Non-Claude Agents

These examples show agent-handoff handing off work to agents other than Claude — Copilot, Aider with cloud models (minimax, OpenRouter), and Aider with local models (Ollama).

## Prerequisites

- agent-handoff installed and registered in your MCP client
- The target CLI agent installed and on PATH
- Relevant API keys set in your shell environment

---

## Demo 1: Delegate to GitHub Copilot

Copilot CLI (`gh copilot` or standalone `copilot`) returns plain text (no structured JSON).

### Setup

```bash
# Verify copilot is available
which copilot
# or via gh extension
gh copilot --version
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

Copilot supports model selection:

```
handoff_task({
  agent: "copilot",
  prompt: "Review src/auth.ts for security issues",
  model: "gpt-4o"
})
```

---

## Demo 2: Delegate to Aider with MiniMax (Cloud Model via OpenRouter)

Aider supports any model available through OpenRouter, including MiniMax-01. This lets you delegate work to models that aren't directly available through any single vendor's CLI.

### Setup

```bash
# Install aider
pip install aider-chat

# Verify it's on PATH
which aider

# Set OpenRouter API key
export OPENROUTER_API_KEY="sk-or-v1-..."
```

### Usage: MiniMax via OpenRouter

```
You: Ask aider to use minimax to refactor the database layer. Use the minimax-01 model through OpenRouter.

Claude: *calls handoff_task({
  agent: "aider",
  prompt: "Refactor src/db/queries.ts to use parameterized queries instead of string concatenation. Update all callers.",
  model: "openrouter/minimax/minimax-01",
  workingDirectory: "/path/to/project"
})*
Claude: Job hnd_mm01xyz created.
```

The `model` parameter is passed directly to aider's `--model` flag. Aider resolves the provider from the model string:
- `openrouter/minimax/minimax-01` → uses OpenRouter API with MiniMax-01
- `openrouter/google/gemini-2.5-pro` → uses OpenRouter API with Gemini
- `anthropic/claude-sonnet-4-5-20250929` → uses Anthropic API directly

### Check results

```
You: Get the result of the minimax job.

Claude: *calls get_result({ jobId: "hnd_mm01xyz" })*
Claude: Completed. Aider modified 3 files:
  - src/db/queries.ts (refactored to parameterized queries)
  - src/api/users.ts (updated caller)
  - src/api/reports.ts (updated caller)
  Git diff: 3 files changed, 28 insertions(+), 15 deletions(-)
```

---

## Demo 3: Delegate to Aider with a Local Model (Ollama)

Aider can use locally running models via Ollama. No API keys needed — everything runs on your machine.

### Setup

```bash
# Install ollama
brew install ollama

# Pull a model
ollama pull qwen2.5-coder:32b

# Start ollama server (if not already running)
ollama serve

# Verify aider is installed
which aider
```

### Usage: Local Ollama Model

```
You: Use aider with the local qwen2.5-coder model to write tests for src/utils/

Claude: *calls handoff_task({
  agent: "aider",
  prompt: "Write unit tests for all exported functions in src/utils/. Use vitest. Aim for >90% branch coverage.",
  model: "ollama/qwen2.5-coder:32b",
  workingDirectory: "/path/to/project"
})*
Claude: Job hnd_ol32abc created.
```

**Key points:**
- No API key needed — Ollama runs locally on port 11434
- Aider handles the Ollama connection automatically
- Larger models (32b+) give better results for code generation
- Slower than cloud models but completely private

### With tmux for visibility

Since local models can be slower, you might want to watch progress:

```
handoff_task({
  agent: "aider",
  prompt: "Add input validation to all API endpoints in src/routes/",
  model: "ollama/qwen2.5-coder:32b",
  spawnMode: "tmux"
})
```

Now you can `Ctrl+b` → switch to the `daax-aider` tmux window and watch it work.

---

## Demo 4: Cross-Agent Comparison

Use agent-handoff to get multiple perspectives on the same task from different agents/models:

```
You: I want three different agents to review src/auth/session.ts for security issues.
Hand off to claude, copilot, and aider with minimax. Then compare their findings.

Claude: *calls handoff_task three times:*

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

3. handoff_task({
     agent: "aider",
     prompt: "Security review of src/auth/session.ts. List vulnerabilities with severity, line number, and fix.",
     model: "openrouter/minimax/minimax-01"
   })
   → Job hnd_mm_review
```

All three run in parallel as separate child processes. Check results individually or wait for all to complete:

```
You: Are all three reviews done?

Claude: *calls check_status for each*
  hnd_cl_review: completed (45s)
  hnd_cp_review: completed (30s)
  hnd_mm_review: running (60s elapsed)...

[wait]

Claude: *calls get_result for each, compares findings*
Claude: Cross-agent comparison:
  - All three found the session fixation issue on line 42
  - Claude and MiniMax found the missing CSRF check on line 78
  - Only Copilot flagged the session timeout being too long (line 15)
  - Only Claude flagged the httpOnly cookie flag missing (line 93)
```

---

## Model String Reference for Aider

Aider's `--model` flag accepts model strings for many providers:

| Provider | Model String Example | API Key Variable |
|----------|---------------------|-----------------|
| OpenRouter (any model) | `openrouter/minimax/minimax-01` | `OPENROUTER_API_KEY` |
| OpenRouter (Google) | `openrouter/google/gemini-2.5-pro` | `OPENROUTER_API_KEY` |
| OpenRouter (Meta) | `openrouter/meta-llama/llama-3.1-405b` | `OPENROUTER_API_KEY` |
| Ollama (local) | `ollama/qwen2.5-coder:32b` | None (local) |
| Ollama (local) | `ollama/deepseek-coder-v2:latest` | None (local) |
| Anthropic | `anthropic/claude-sonnet-4-5-20250929` | `ANTHROPIC_API_KEY` |
| OpenAI | `openai/gpt-4o` | `OPENAI_API_KEY` |
| Deepseek | `deepseek/deepseek-chat` | `DEEPSEEK_API_KEY` |

The model string is passed through to aider unchanged — agent-handoff doesn't validate or modify it.

---

## Troubleshooting

### "Agent 'aider' is not available on PATH"

```bash
# Check if aider is installed
which aider

# If using pipx
pipx install aider-chat

# If using pip
pip install aider-chat

# Verify
aider --version
```

### "Agent 'copilot' is not available on PATH"

```bash
# Standalone copilot
npm install -g @githubnext/github-copilot-cli

# Or via gh extension
gh extension install github/gh-copilot
```

### Aider OpenRouter errors

```bash
# Verify API key is set
echo $OPENROUTER_API_KEY

# Test directly
aider --model openrouter/minimax/minimax-01 --message "hello" --yes-always --no-git
```

### Ollama connection refused

```bash
# Is ollama running?
curl http://localhost:11434/api/tags

# Start it
ollama serve

# Is the model pulled?
ollama list
```
