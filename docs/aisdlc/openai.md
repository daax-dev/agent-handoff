````markdown
# Local “PR-Like” Multi-Agent AI SDLC: Research + Architecture

## Executive Summary

The idea is solid: replicate the useful parts of GitHub pull requests locally without requiring GitHub, cloud PRs, or even a remote Git server.

The pattern is:

> **Use Git worktrees/branches + structured task state + local agent sessions + review comments + a UI that feels like PR review.**

GitHub is moving toward this officially with Agent HQ, where Copilot, Claude, Codex, and other agents can work inside GitHub/VS Code against issues and PR-style workflows. GitHub says Agent HQ is meant to let developers orchestrate multiple agents in one workflow, and newer GitHub Copilot cloud agent docs describe branch creation, planning, code changes, and eventual PR creation as part of the managed workflow. :contentReference[oaicite:0]{index=0}

For a **local version**, the closest architecture is not “fake GitHub.” It is:

1. **Git remains the source of truth for code changes.**
2. **A local orchestrator owns the workflow state.**
3. **Agents communicate through explicit handoff artifacts.**
4. **MCP exposes state, files, reviews, tests, and decisions as tools/resources.**
5. **A local web UI visualizes tasks like PRs: diff, comments, checks, approvals, agent timeline.**

This is GitHub PR semantics without GitHub PR infrastructure. Basically: “pull requests, but make it localhost.” Slightly cursed, very useful.

---

# 1. Current Market / Tooling Direction

## GitHub Agent HQ Pattern

GitHub’s Agent HQ is the clearest signal of where this is going: GitHub wants to become the orchestration surface for multiple coding agents. GitHub announced Agent HQ as a unified workflow for orchestrating agents, and later added Claude and Codex in public preview for Copilot Pro+ and Enterprise users. :contentReference[oaicite:1]{index=1}

Relevant properties to emulate locally:

| GitHub Agent HQ / PR Concept | Local Equivalent |
|---|---|
| Issue / task | Local task record |
| Agent session | Local agent run |
| Branch | Git branch or worktree |
| PR | Local review bundle |
| PR comments | Structured review comments |
| Checks | Local test/lint/security results |
| Merge | Local fast-forward/squash/rebase into target branch |
| Timeline | Event log / JSONL |
| Agent attribution | Agent metadata per run |
| Human approval | Local approval gate |

GitHub Copilot cloud agent can research a repo, create a plan, make code changes on a branch, and optionally create a pull request later. It also supports multiple custom agents specializing in task types. :contentReference[oaicite:2]{index=2}

That maps almost perfectly to a local system:

```text
Task -> Plan -> Agent Worktree -> Review -> Fixes -> Checks -> Human Approval -> Merge
````

## Codex Local / Desktop Pattern

OpenAI’s Codex CLI is described as a coding agent that runs locally on your computer, and the Codex app is described as a desktop command center for parallel Codex threads with built-in worktree support, automations, and Git functionality. ([GitHub][1])

That matters because it validates the **local multi-thread/worktree model**:

```text
One task = one isolated worktree = one agent session = one reviewable diff
```

## Claude Code Pattern

Claude Code supports subagents, skills, hooks, MCP, GitHub Actions, and programmatic workflows. Anthropic’s docs describe custom subagents for specialized tasks, skills for reusable workflows, and MCP integration for connecting Claude Code to external tools. ([Claude API Docs][2])

Claude Code GitHub Actions already supports the PR/issue automation style through `@claude`, but the same conceptual model can be moved local by replacing GitHub comments/events with:

```text
local event bus + task state + worktree diff + MCP tools
```

## MCP Pattern

MCP is useful here, but it should not be the whole orchestration engine. MCP is best as the standard interface for agents to read resources and invoke tools. The MCP spec defines tools, resources, prompts, and transports, including Streamable HTTP using HTTP POST/GET with optional Server-Sent Events. ([Model Context Protocol][3])

Use MCP for:

| MCP Capability        | Use in Local PR-Like System                                                 |
| --------------------- | --------------------------------------------------------------------------- |
| Resources             | Read task state, diffs, files, test results, architecture docs              |
| Tools                 | Create comments, request changes, approve, run tests, create handoff        |
| Prompts               | Standard reviewer prompts, security review prompts, test generation prompts |
| Streamable HTTP / SSE | Agent/UI event streaming                                                    |
| Auth                  | Local bearer token, mTLS, or dev-only loopback trust                        |

MCP should expose the local SDLC state, not replace Git, SQLite, or the UI.

---

# 2. Core Design Principle

## Do not try to clone GitHub.

Clone the **workflow semantics**, not the product.

GitHub PRs are valuable because they combine:

1. A proposed code delta.
2. Conversation around that delta.
3. Checks and evidence.
4. Ownership and approval.
5. A merge decision.
6. A durable audit trail.

A local agentic SDLC system needs those same six things.

---

# 3. Proposed Architecture

## High-Level Architecture

```text
┌─────────────────────────────────────────────────────────────┐
│                        Local Web UI                         │
│  Tasks | Diffs | Agent Runs | Comments | Checks | Decisions  │
└──────────────────────────────┬──────────────────────────────┘
                               │ REST / WebSocket / SSE
┌──────────────────────────────▼──────────────────────────────┐
│                   Local Orchestrator API                     │
│  Task FSM | Agent Registry | Review Engine | Policy Gates     │
└───────────────┬───────────────────────────────┬──────────────┘
                │                               │
                │                               │
┌───────────────▼──────────────┐     ┌──────────▼─────────────┐
│          Local Git            │     │      State Store        │
│ branches / worktrees / diffs  │     │ SQLite + JSONL + files  │
└───────────────┬──────────────┘     └──────────┬─────────────┘
                │                               │
┌───────────────▼───────────────────────────────▼──────────────┐
│                         MCP Server                            │
│ tools: read_diff, add_comment, approve, request_changes,       │
│        run_tests, create_handoff, summarize_decisions          │
│ resources: task://..., diff://..., checks://..., file://...     │
└───────────────┬───────────────────────────────┬──────────────┘
                │                               │
     ┌──────────▼──────────┐        ┌───────────▼───────────┐
     │ Implementation Agent │        │ Review / Security Agent│
     │ Claude / Codex / etc │        │ Claude / Codex / local  │
     └─────────────────────┘        └────────────────────────┘
```

---

# 4. The “Local PR” Object Model

Call it a **Change Request** or **Local Review Request**.

Avoid overloading “PR” if there is no remote. “Change Request” is cleaner.

## Core Entities

```yaml
Task:
  id: TSK-000123
  title: "Add OAuth token refresh handling"
  description: "Implement retry and refresh behavior for expired tokens"
  status: planned | implementing | reviewing | changes_requested | approved | merged | abandoned
  target_branch: main
  created_by: human
  created_at: timestamp

ChangeRequest:
  id: CR-000123
  task_id: TSK-000123
  source_branch: agent/TSK-000123-implement
  target_branch: main
  worktree_path: .work/worktrees/TSK-000123
  status: draft | open | review_required | changes_requested | approved | merged
  summary: markdown
  risk_level: low | medium | high
  created_by_agent: implementation-agent
  reviewers:
    - security-agent
    - test-agent
    - architecture-agent

AgentRun:
  id: RUN-000456
  task_id: TSK-000123
  agent_name: claude-implementer
  role: implementer | reviewer | fixer | tester | summarizer
  model: claude-sonnet | codex | local-llm
  started_at: timestamp
  completed_at: timestamp
  input_context_refs:
    - task://TSK-000123
    - file://src/auth/token.ts
  output_refs:
    - patch://RUN-000456.diff
    - decisionlog://RUN-000456.jsonl

ReviewComment:
  id: CMT-000789
  change_request_id: CR-000123
  author_agent: security-agent
  file: src/auth/token.ts
  line: 88
  severity: info | warning | blocking
  category: correctness | security | maintainability | test | architecture
  body: markdown
  suggested_patch: optional

CheckRun:
  id: CHK-000321
  change_request_id: CR-000123
  name: unit-tests
  status: queued | running | passed | failed
  command: "npm test"
  output_path: .work/checks/CHK-000321.log
```

---

# 5. Local State Layout

Use a predictable `.work/` directory.

```text
repo/
  .work/
    tasks/
      TSK-000123/
        task.yaml
        plan.md
        acceptance-criteria.md
        decision-log.jsonl
        handoffs.jsonl

    change-requests/
      CR-000123/
        cr.yaml
        summary.md
        diff.patch
        comments.jsonl
        checks.jsonl
        approvals.jsonl
        final-review.md

    agents/
      implementation-agent.yaml
      security-reviewer.yaml
      test-reviewer.yaml
      architecture-reviewer.yaml

    worktrees/
      TSK-000123/
        # actual git worktree

    events/
      events.jsonl

    db/
      state.sqlite
```

## Why both SQLite and JSONL?

Use both.

| Storage     | Why                                                   |
| ----------- | ----------------------------------------------------- |
| SQLite      | Fast UI queries, state transitions, dashboards        |
| JSONL       | Append-only audit trail, agent-readable, git-friendly |
| Markdown    | Human-readable summaries and plans                    |
| Patch files | Portable diffs                                        |
| Git         | Real code history                                     |

This fits your “`.work` is human and agent readable” principle.

---

# 6. Git Worktree Strategy

Each task gets its own branch and worktree.

```bash
git fetch --all --prune

git worktree add \
  .work/worktrees/TSK-000123 \
  -b agent/TSK-000123-implement \
  main
```

Agent works inside:

```text
.work/worktrees/TSK-000123
```

Generate review diff:

```bash
git -C .work/worktrees/TSK-000123 diff main...HEAD > .work/change-requests/CR-000123/diff.patch
```

Merge options:

```bash
# squash merge
git checkout main
git merge --squash agent/TSK-000123-implement
git commit -m "TSK-000123: Add OAuth token refresh handling"

# or normal merge
git merge --no-ff agent/TSK-000123-implement
```

This gives you GitHub-like branch isolation without GitHub.

---

# 7. Agent Roles

## Minimum Useful Agent Set

| Agent                 | Responsibility                                       | Blocking?                          |
| --------------------- | ---------------------------------------------------- | ---------------------------------- |
| Planner               | Turns task into implementation plan                  | Yes                                |
| Implementer           | Makes code changes                                   | Yes                                |
| Test Agent            | Adds or validates tests                              | Yes                                |
| Security Reviewer     | Looks for auth, input, secrets, injection, unsafe IO | Yes for security-sensitive changes |
| Architecture Reviewer | Checks boundaries, coupling, maintainability         | Usually                            |
| Fixer                 | Applies requested changes                            | Conditional                        |
| Summarizer            | Produces final human-readable review summary         | No                                 |

## Example Role Definitions

```yaml
name: security-reviewer
role: reviewer
description: >
  Reviews local change requests for security risks, especially auth,
  secrets, input validation, injection, unsafe deserialization, SSRF,
  filesystem access, dependency risk, and logging of sensitive data.
blocking: true
tools:
  - read_diff
  - read_file
  - add_review_comment
  - request_changes
  - approve_review
  - run_check
```

```yaml
name: test-reviewer
role: reviewer
description: >
  Reviews whether the change includes adequate unit, integration, and
  regression tests. Can request changes if acceptance criteria are not covered.
blocking: true
tools:
  - read_diff
  - read_file
  - run_tests
  - add_review_comment
  - request_changes
  - approve_review
```

---

# 8. State Machine

```text
draft
  ↓
planned
  ↓
implementing
  ↓
implementation_complete
  ↓
reviewing
  ├── changes_requested → fixing → reviewing
  ├── rejected → abandoned
  └── approved
        ↓
ready_to_merge
        ↓
merged
```

## Required Gates

```yaml
required_gates:
  - plan_exists
  - diff_exists
  - tests_pass
  - no_blocking_review_comments
  - security_review_approved
  - human_approval_required
  - decision_log_complete
```

For regulated enterprise use, do **not** let agents silently merge. Agents can recommend; humans approve. Otherwise you have invented “production roulette with YAML.”

---

# 9. Local API Design

## REST API

```http
POST /tasks
GET  /tasks
GET  /tasks/{taskId}

POST /tasks/{taskId}/plan
POST /tasks/{taskId}/start-agent
POST /tasks/{taskId}/handoff

POST /change-requests
GET  /change-requests
GET  /change-requests/{crId}
GET  /change-requests/{crId}/diff
GET  /change-requests/{crId}/comments
POST /change-requests/{crId}/comments
POST /change-requests/{crId}/request-changes
POST /change-requests/{crId}/approve
POST /change-requests/{crId}/checks/run
POST /change-requests/{crId}/merge

GET /events/stream
```

## Event Stream

Use SSE or WebSocket.

```json
{
  "event_id": "EVT-000001",
  "timestamp": "2026-05-06T21:12:00Z",
  "type": "review.comment.created",
  "task_id": "TSK-000123",
  "change_request_id": "CR-000123",
  "actor": "security-reviewer",
  "payload": {
    "comment_id": "CMT-000789",
    "severity": "blocking",
    "file": "src/auth/token.ts",
    "line": 88
  }
}
```

---

# 10. MCP Server Design

The local orchestrator should also expose an MCP server.

MCP is a good fit because it standardizes how coding agents access tools and resources. The MCP specification describes resources as contextual data exposed by servers, and tools as callable actions exposed to language models. ([Model Context Protocol][4])

## MCP Resources

```text
task://TSK-000123
change-request://CR-000123
diff://CR-000123
comments://CR-000123
checks://CR-000123
decision-log://TSK-000123
file://src/auth/token.ts
```

## MCP Tools

```yaml
tools:
  - name: create_task
  - name: create_plan
  - name: create_worktree
  - name: read_diff
  - name: add_review_comment
  - name: request_changes
  - name: approve_change_request
  - name: run_check
  - name: create_handoff
  - name: summarize_change_request
  - name: merge_change_request
```

## Example MCP Tool Schema

```json
{
  "name": "add_review_comment",
  "description": "Add a structured review comment to a local change request.",
  "inputSchema": {
    "type": "object",
    "required": ["change_request_id", "file", "line", "severity", "category", "body"],
    "properties": {
      "change_request_id": { "type": "string" },
      "file": { "type": "string" },
      "line": { "type": "integer" },
      "severity": {
        "type": "string",
        "enum": ["info", "warning", "blocking"]
      },
      "category": {
        "type": "string",
        "enum": ["correctness", "security", "maintainability", "test", "architecture"]
      },
      "body": { "type": "string" },
      "suggested_patch": { "type": "string" }
    }
  }
}
```

---

# 11. Local UI Requirements

The UI should feel like a PR dashboard.

## Pages

```text
/tasks
/change-requests
/change-requests/:id
/agents
/runs
/checks
/settings
```

## Change Request View

Required panels:

1. **Summary**
2. **Diff viewer**
3. **Inline comments**
4. **Agent timeline**
5. **Checks**
6. **Approvals**
7. **Decision log**
8. **Handoff chain**
9. **Merge button**

## UI Layout

```text
┌─────────────────────────────────────────────────────────────┐
│ CR-000123: Add OAuth token refresh handling                  │
│ Status: Changes Requested | Risk: Medium | Target: main      │
├─────────────────────────────────────────────────────────────┤
│ Summary | Files Changed | Checks | Reviews | Timeline        │
├─────────────────────────────────────────────────────────────┤
│ File Diff                                                    │
│ src/auth/token.ts                                            │
│   + new refreshToken() logic                                 │
│   ⚠ security-reviewer: blocking comment on line 88           │
├─────────────────────────────────────────────────────────────┤
│ Reviews                                                      │
│ ✅ test-reviewer approved                                    │
│ ❌ security-reviewer requested changes                       │
│ ⏳ architecture-reviewer pending                             │
├─────────────────────────────────────────────────────────────┤
│ Actions: Run Checks | Ask Fixer Agent | Approve | Merge      │
└─────────────────────────────────────────────────────────────┘
```

---

# 12. Handoff Model

Agent handoffs should be explicit, structured, and append-only.

```json
{
  "handoff_id": "HND-000001",
  "from_agent": "planner",
  "to_agent": "implementation-agent",
  "task_id": "TSK-000123",
  "change_request_id": null,
  "timestamp": "2026-05-06T21:30:00Z",
  "summary": "Implement OAuth token refresh retry behavior.",
  "context_refs": [
    "task://TSK-000123",
    "plan://TSK-000123",
    "file://src/auth/token.ts"
  ],
  "acceptance_criteria": [
    "Expired access tokens trigger refresh once",
    "Refresh failures are logged without leaking tokens",
    "Unit tests cover expired token and failed refresh paths"
  ],
  "constraints": [
    "Do not change public API signatures",
    "Do not log token values"
  ]
}
```

This is the local equivalent of “assigning a PR comment to another agent.”

---

# 13. Review Comment Model

```json
{
  "comment_id": "CMT-000789",
  "change_request_id": "CR-000123",
  "author": "security-reviewer",
  "created_at": "2026-05-06T22:00:00Z",
  "file": "src/auth/token.ts",
  "line": 88,
  "severity": "blocking",
  "category": "security",
  "body": "The refresh failure path logs the full exception object. Confirm this cannot include token material. Prefer structured error code logging.",
  "suggested_patch": null,
  "status": "open"
}
```

---

# 14. Agent Workflow Example

## Step 1: Human Creates Task

```bash
localsdlc task create \
  --title "Add OAuth token refresh handling" \
  --description ./task.md \
  --target main
```

## Step 2: Planner Agent Creates Plan

```bash
localsdlc agent run planner --task TSK-000123
```

## Step 3: Implementer Gets Worktree

```bash
localsdlc cr create --task TSK-000123
localsdlc agent run implementer --cr CR-000123
```

## Step 4: Review Agents Run

```bash
localsdlc agent run test-reviewer --cr CR-000123
localsdlc agent run security-reviewer --cr CR-000123
localsdlc agent run architecture-reviewer --cr CR-000123
```

## Step 5: Fixer Handles Comments

```bash
localsdlc agent run fixer --cr CR-000123 --only-open-blocking-comments
```

## Step 6: Human Reviews UI

```bash
localsdlc ui
```

## Step 7: Merge

```bash
localsdlc cr merge CR-000123 --squash
```

---

# 15. Checks and Evidence

Checks should be first-class.

```yaml
checks:
  - name: unit-tests
    command: npm test
    required: true

  - name: lint
    command: npm run lint
    required: true

  - name: typecheck
    command: npm run typecheck
    required: true

  - name: secrets-scan
    command: gitleaks detect --source .
    required: true

  - name: sbom
    command: syft . -o spdx-json=.work/checks/sbom.spdx.json
    required: false

  - name: vuln-scan
    command: grype .
    required: false
```

For enterprise use, the review screen should show:

| Evidence           | Required?  |
| ------------------ | ---------- |
| Diff summary       | Yes        |
| Test output        | Yes        |
| Security review    | Yes        |
| Agent decision log | Yes        |
| Dependency changes | Yes        |
| SBOM delta         | Preferably |
| Human approval     | Yes        |
| Merge commit       | Yes        |

---

# 16. Decision Log

Every meaningful agent decision should be JSONL.

```json
{"ts":"2026-05-06T21:40:00Z","actor":"planner","type":"decision","summary":"Use existing AuthClient rather than adding new dependency","reason":"Avoids dependency expansion and preserves current API boundary","refs":["file://src/auth/client.ts"]}
{"ts":"2026-05-06T21:52:00Z","actor":"implementer","type":"code_change","summary":"Added refresh retry on 401 response","refs":["file://src/auth/token.ts"]}
{"ts":"2026-05-06T22:03:00Z","actor":"security-reviewer","type":"review_comment","summary":"Requested safer logging on refresh failure","refs":["comment://CMT-000789"]}
```

This is critical. Without the decision log, multi-agent workflows become a seance with stack traces.

---

# 17. REST vs MCP vs Message Bus

## Recommended Answer

Use all three, but with different responsibilities.

| Mechanism           | Purpose                                |
| ------------------- | -------------------------------------- |
| REST API            | UI and simple automation               |
| SSE/WebSocket       | Live UI updates                        |
| MCP                 | Agent-facing tools/resources           |
| SQLite              | Queryable state                        |
| JSONL               | Audit trail                            |
| Git                 | Source code truth                      |
| Optional NATS/Redis | Later, for multi-process orchestration |

## Do Not Start With Kafka

For local-first agentic SDLC, Kafka is overkill unless you enjoy installing distributed regret.

Start simple:

```text
FastAPI / Node API
SQLite
JSONL
Git worktrees
MCP server
React UI
```

---

# 18. Implementation Stack Options

## Option A: Python-First

```text
FastAPI
SQLite / SQLModel
Typer CLI
GitPython or subprocess git
MCP Python SDK
React / Vite UI
SSE for events
```

Best for fast prototyping.

## Option B: TypeScript-First

```text
Node / Fastify
SQLite / Drizzle
Commander CLI
simple-git
MCP TypeScript SDK
React / Vite UI
WebSocket or SSE
```

Best if you want one language across UI and backend.

## Option C: Go-First

```text
Go HTTP API
SQLite
cobra CLI
go-git or shell git
MCP server implementation
HTMX or React UI
```

Best for durable enterprise CLI/tooling.

## My Recommendation

For your use case:

```text
Backend: Go or TypeScript
UI: React/Vite
State: SQLite + JSONL
Agent interface: MCP + CLI adapters
Git: native git CLI
```

Use native `git` commands rather than abstracting too much. Git is already the database of code truth; don’t wrap it until it squeaks.

---

# 19. MVP Scope

## MVP 1: Local PR Core

Build:

1. CLI creates task.
2. CLI creates worktree.
3. Agent modifies code.
4. System creates diff.
5. UI displays diff.
6. Review comments can be added.
7. Checks can run.
8. Human can approve.
9. System can squash merge.

No MCP yet.

## MVP 2: MCP Agent Interface

Add MCP tools:

```text
read_task
read_diff
add_review_comment
request_changes
approve
run_check
create_handoff
```

## MVP 3: Multi-Agent Review

Add agent roles:

```text
planner
implementer
test-reviewer
security-reviewer
fixer
summarizer
```

## MVP 4: Full Review Dashboard

Add:

```text
timeline
agent run logs
checks tab
decision log
risk score
approval policy
```

---

# 20. Opinionated Design Choices

## Use branches/worktrees, not patch-only workflows

Patch-only looks clean until agents need to iterate. Worktrees give isolation, testability, and real Git history.

## Use explicit handoffs, not hidden chat history

Agents should not depend on opaque context windows. Each handoff should be written down as structured data.

## Use blocking comments

A review system without blocking comments is just vibes with a scrollbar.

## Keep human approval mandatory

Especially in regulated environments. Agents can implement and review, but merge authority should remain human-owned.

## Treat MCP as a tool plane, not the workflow brain

MCP gives agents access. Your orchestrator owns policy, state, and lifecycle.

---

# 21. Suggested Repository Structure

```text
local-agent-sdlc/
  cmd/
    localsdlc/
  internal/
    api/
    git/
    mcp/
    agents/
    checks/
    state/
    events/
    policy/
  ui/
    src/
  schemas/
    task.schema.json
    change-request.schema.json
    review-comment.schema.json
    handoff.schema.json
  examples/
    simple-node-app/
  docs/
    architecture.md
    agent-contracts.md
    mcp-tools.md
```

---

# 22. Product Name Ideas

| Name             | Notes                                   |
| ---------------- | --------------------------------------- |
| LocalReview      | Boring but clear                        |
| ChangeDeck       | Nice UI metaphor                        |
| AgentPR          | Direct, maybe too GitHub-ish            |
| Handoff          | Good for agent workflows                |
| Workbench Review | Enterprise-friendly                     |
| ForgeLoop        | Good if tied to inner/middle/outer loop |
| PatchBoard       | Probably the best simple name           |
| ReviewMesh       | Good for multi-agent review             |

Best pick: **PatchBoard**.

---

# 23. Final Recommended Architecture

```text
PatchBoard
Local PR-like review system for multi-agent SDLC

Core:
  - Git branches and worktrees
  - Local Change Request objects
  - SQLite state
  - JSONL audit trail
  - Markdown plans/summaries
  - Patch files for diffs

Interfaces:
  - CLI for developers and scripts
  - REST API for UI
  - SSE/WebSocket for live events
  - MCP server for agents

Agents:
  - Planner
  - Implementer
  - Test Reviewer
  - Security Reviewer
  - Architecture Reviewer
  - Fixer
  - Summarizer

Controls:
  - Required checks
  - Blocking review comments
  - Human approval
  - Decision log
  - Merge policy

UI:
  - Task board
  - Local PR/change request view
  - Diff viewer
  - Inline comments
  - Agent timeline
  - Checks
  - Approval and merge controls
```

---

# 24. Bottom Line

This is absolutely buildable.

The winning design is:

> **Local GitHub PR semantics over Git worktrees, backed by SQLite/JSONL, exposed to agents through MCP, and visualized through a local review UI.**

Do **not** make the agents talk to each other through vague chat messages. Make them communicate through structured handoffs, comments, checks, and decisions.

That is the key move.

GitHub Agent HQ shows the cloud-hosted version of this pattern. Codex local/worktree support shows the desktop/local version is viable. Claude Code subagents, skills, hooks, and MCP show how specialized agent roles can be wired into a programmable engineering workflow. ([The GitHub Blog][5])

The local system should not try to be GitHub.

It should be a **local agentic review control plane**.

```
::contentReference[oaicite:8]{index=8}
```

[1]: https://github.com/openai/codex?utm_source=chatgpt.com "openai/codex: Lightweight coding agent that runs in your ..."
[2]: https://docs.anthropic.com/en/docs/claude-code/sub-agents?utm_source=chatgpt.com "Create custom subagents - Claude Code Docs"
[3]: https://modelcontextprotocol.io/specification/2025-11-25?utm_source=chatgpt.com "Specification"
[4]: https://modelcontextprotocol.io/specification/2025-06-18/server/resources?utm_source=chatgpt.com "Resources"
[5]: https://github.blog/news-insights/company-news/welcome-home-agents/?utm_source=chatgpt.com "Introducing Agent HQ: Any agent, any way you work"

