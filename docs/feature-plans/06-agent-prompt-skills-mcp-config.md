# Feature Plan: Agent Prompt, Skills & MCP Configuration
**PRD:** [PRD-023](../aisdlc/prds/PRD-023-agent-prompt-skills-mcp-config.yml)  
**Status:** Approved for implementation

---

## Decisions (locked 2026-05-07)

| # | Question | Answer |
|---|----------|--------|
| 1 | Skills discovery | Hardcoded list first. Backlog item for auto-discover from `claude` CLI. |
| 2 | NodePanel width | **400px** |
| 3 | Codex MCP | Yes — include `~/.codex/config.toml` servers |
| 4 | Skills wiring | **`localsdlc setup` — runs once, not per spawn.** Critical to be correct and low friction. |

---

## Problem

- **MCPs**: blind text box. No way to know what servers exist.
- **Skills**: concept doesn't exist. No way to say "this Claude Code agent gets `/review`."
- **Prompt**: textarea with no view of the base prompt you're appending to.
- **Layout**: 300px single column — too cramped once we add three new surfaces.

---

## What We're Building

### 1. `localsdlc setup` — the one-time installer

The key architectural decision: skills are **installed once into the tool environment**, not injected per-spawn. After changing assignments, a developer runs one command. Done.

```
localsdlc setup [--dry-run]
```

**What it does:**
1. Fetches all enabled assignments from the running server (`GET /api/agent-assignments`)
2. Groups by tool, aggregates all unique skill names
3. For **Claude Code**: merges skills into `.claude/settings.json` at the project root — only the `"skills"` key, everything else preserved verbatim
4. For all other tools: no-op (skills not supported)
5. Prints a clear summary:

```
✓  claude-code  →  .claude/settings.json  [review, security-review, init]
-  codex        →  (skills not supported)
-  human        →  (skills not supported)
```

**Constraints:**
- Idempotent — safe to run twice, same result
- `--dry-run` shows what would change without touching files
- Aborts with a clear error if `.claude/settings.json` contains invalid JSON — never overwrites a broken file
- If no assignments have explicit skills (all `null`) → prints "No skills configured — nothing to write." and exits cleanly
- If the server isn't running → clear error, not a cryptic network trace
- Targets project root `.claude/` — not per-worktree

**When to run it:** after changing agent assignments in the UI. Not automated. Not per-spawn. Once.

---

### 2. NodePanel — 400px wide, 4 tabs

Replaces the current 300px single-column panel.

**Tab 1 — Config**
- Tool select (clears model if new tool doesn't support current model)
- Model select — now uses `agent-model-map.ts` (fixes the stale list in the current NodePanel)
- Auto-launch toggle
- Enabled checkbox

**Tab 2 — Prompt**
- "Base prompt" — collapsible, default open. Fetches `GET /api/roles/:role/prompt`. Read-only `<pre>` block, max 200px tall, scrollable.
- "Append to base prompt" textarea — same `prompt_override` DB field, clearer label and placeholder

**Tab 3 — MCPs**
- Hidden for Human assignments (replaced with "MCPs not applicable for Human")
- "Override defaults" toggle: off = `mcps: null` (role defaults), on = explicit list
- When on: checkbox list of discovered servers, each with a source badge:
  - `claude-global` — from `~/.claude/settings.json`
  - `claude-local` — from `./.claude/settings.json`
  - `codex` — from `~/.codex/config.toml`
- If no servers discovered: falls back to existing freeform text tags
- Toggle back off → `mcps` resets to `null`

**Tab 4 — Skills**
- Reactive to tool selected on Config tab (updates without save)
- **Claude Code**: "Override defaults" toggle + checkbox list (skill name + description)
- **All other tools**: "Skills not supported by `<tool label>`" — no toggle
- Override toggle: `null` = role defaults / `[]` = explicit none / `[...]` = explicit set

Save button in the footer saves all 4 tabs at once — no per-field auto-save.

---

### 3. AgentsTab — two new read-only columns

After Model: **Skills** and **MCPs** badge columns showing:
- `3` — count of explicit items
- `default` — when field is `null`
- `none` — when field is `[]`

Editing stays in NodePanel.

---

## New API Endpoints

### `GET /api/mcp-servers`
Reads live config files, never throws.

```json
{
  "servers": [
    { "name": "github",  "source": "claude-global" },
    { "name": "backlog", "source": "claude-local" },
    { "name": "my-mcp", "source": "codex" }
  ]
}
```

Sources checked (in order, deduplicated by name):
- `~/.claude/settings.json` → `$.mcpServers` object keys
- `./.claude/settings.json` (cwd-relative)
- `~/.codex/config.toml` → `[mcp]` table keys (parsed with `Bun.TOML`)

### `GET /api/skills?tool=<AgentTool>`
Hardcoded catalogue. Returns `[]` for all tools except `claude-code`.

| Skill | Description |
|-------|-------------|
| `init` | Initialize CLAUDE.md for a codebase |
| `review` | Review a pull request |
| `security-review` | Security review of branch changes |
| `simplify` | Review changed code for quality and reuse |
| `schedule` | Create/manage scheduled remote agents |
| `claude-api` | Build/debug Claude API / Anthropic SDK apps |
| `update-config` | Configure Claude Code harness via settings.json |
| `keybindings-help` | Customize keyboard shortcuts |
| `loop` | Run a prompt/command on a recurring interval |
| `fewer-permission-prompts` | Add allowlist to reduce permission prompts |

### `GET /api/roles/:role/prompt`
Returns content of `src/roles/prompts/<role>.md`. 404 if role unknown.

---

## DB Change

```sql
-- migrations/014_agent_skills.sql
ALTER TABLE agent_assignments ADD COLUMN skills TEXT DEFAULT NULL;
-- NULL = inherit role defaults
-- '[]' = explicitly none
-- '["review","security-review"]' = explicit set
```

---

## File Map

```
migrations/
  014_agent_skills.sql                    ← new

src/
  api/routes/mcp-servers.ts               ← new
  api/routes/skills.ts                    ← new (hardcoded catalogue)
  api/routes/roles.ts                     ← new (serves prompt file content)
  api/server.ts                           ← register 3 new routes
  domain/agent-assignment.ts              ← add skills field + DB read/write
  cli/commands/setup.ts                   ← new: localsdlc setup command
  cli/localsdlc.ts                        ← register setup subcommand
  cli/api-client.ts                       ← add getAssignments()

ui/src/
  hooks/useMcpServers.ts                  ← new
  hooks/useSkills.ts                      ← new
  types.ts                                ← skills: string[] | null on AgentAssignment
  components/workflow-editor/
    NodePanel.tsx                         ← 400px + 4 tabs + fix model list
  components/settings/
    AgentsTab.tsx                         ← Skills + MCPs badge columns
```

---

## Why Setup, Not Per-Spawn?

Per-spawn injection was the first design. Rejected because:

1. **Performance**: writing `settings.json` on every spawn adds latency and file I/O to the critical path
2. **Correctness risk**: concurrent spawns in the same worktree could race on the same file
3. **Transparency**: a developer can't easily inspect what skills an agent will have if they're injected invisibly at runtime
4. **Friction**: a one-time setup that a developer runs explicitly is auditable — you can check `.claude/settings.json` and know exactly what's configured

The tradeoff: you have to remember to run `localsdlc setup` after changing assignments. The `--dry-run` flag and clear summary output make this low friction.

---

## Backlog Item Created

**Title:** Auto-discover Claude Code skills from `claude` CLI at runtime  
**Body:** Replace hardcoded list in `src/api/routes/skills.ts` with output of `claude skills list --json` (or equivalent) when binary on PATH. Fall back to hardcoded on failure. API contract `{ skills: [{name, description}] }` unchanged.

---

## Out of Scope

- Creating/editing MCP server configs from this UI
- Creating/editing skill definitions
- Auto-discovering skills from `claude` CLI (backlog)
- Per-ChangeSet skill/MCP overrides
- Validating MCP servers are reachable
- Resizable NodePanel
- AgentsTab inline editing (click-through to NodePanel)
- Gemini CLI MCP support
- Installing skills into per-worktree `.claude/` (setup targets project root only)
- setup modifying anything other than the `"skills"` key in `.claude/settings.json`
