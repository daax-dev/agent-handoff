# Local PR-Style Multi-Agent AI SDLC

A research write-up on building a GitHub-PR-feeling, multi-agent code review and handoff workflow that runs entirely locally — no GitHub, no cloud forge — using local HTTPS / REST or MCP as the inter-agent transport, with a visualization layer that surfaces the handoffs as something other than literal pull requests.

---

## 1. The problem in one paragraph

The PR workflow on GitHub is doing four things at once: (1) **isolating** changes in a branch/worktree, (2) **packaging** a diff plus metadata into a reviewable unit, (3) **routing** that unit through a chain of reviewers/checks with explicit accept/reject/request-changes states, and (4) **visualizing** the whole thing in a UI everyone already knows. To replicate this locally with multiple AI agents, you need to rebuild each of those four primitives without the GitHub-shaped wrapper, then expose them through a transport (MCP or REST) the agents can speak. The "PR" disappears from the UI; what remains is a **change object** moving across a **state machine**, with each stage owned by an agent.

---

## 2. Reference architecture (recommended)

```
┌─────────────────────────────────────────────────────────────────────┐
│                      Visualization (browser SPA)                    │
│   Kanban / graph view: Draft → Review → Test → Security → Merged    │
│                  WebSocket stream of state changes                  │
└───────────────────────────────────┬─────────────────────────────────┘
                                    │ SSE / WS
┌───────────────────────────────────┴─────────────────────────────────┐
│                  Orchestrator (LangGraph state machine)             │
│      Nodes = agents; edges = approve / reject / request_changes     │
│              Checkpointed state (SQLite / Postgres)                 │
└──┬──────────────┬──────────────┬──────────────┬──────────────┬──────┘
   │              │              │              │              │
   ▼              ▼              ▼              ▼              ▼
┌──────┐      ┌──────┐      ┌──────┐      ┌──────┐      ┌──────┐
│ Plan │      │ Code │      │ Test │      │ Sec  │      │Merge │
│Agent │      │Agent │      │Agent │      │Agent │      │Agent │
└──┬───┘      └──┬───┘      └──┬───┘      └──┬───┘      └──┬───┘
   │             │             │             │             │
   └─────────────┴─────────────┴─────────────┴─────────────┘
                              │
                ┌─────────────┴──────────────┐
                ▼                            ▼
        ┌──────────────┐              ┌────────────────┐
        │ Local MCP    │              │ Git worktrees  │
        │ "ChangeSet"  │              │ one per change │
        │ server (REST │              │ (isolated FS)  │
        │  + stdio/HTTP│              └────────────────┘
        │  transports) │
        └──────────────┘
```

Five moving parts:

1. **Git worktrees** — physical workspace isolation per in-flight change.
2. **A local "ChangeSet" service** (the PR-shaped object) exposed as both an MCP server and a REST API.
3. **An orchestrator** (LangGraph) that models the review pipeline as a state machine with checkpointing and human-in-the-loop interrupts.
4. **Specialized agents** (planner, coder, tester, security, merger) that read/write the ChangeSet via MCP tools.
5. **A visualization SPA** that subscribes to state-change events and renders a kanban/graph — not "PR #42", but "Change abc123 → currently with Security Agent".

---

## 3. The four primitives, broken down

### 3.1 Workspace isolation: git worktrees

This is the only piece you don't have to build. `git worktree` lets multiple branches be checked out simultaneously in separate directories that share the same `.git` object database. Each agent gets its own desk; the file system can no longer cause two agents to collide.

```bash
git worktree add .agents/change-abc123 -b agent/coder/abc123
git worktree add .agents/change-def456 -b agent/coder/def456
```

This pattern is now the de facto standard for parallel AI coding agents. Worktrees only duplicate the files you are actively editing, share the same .git database, and let multiple branches be checked out at once in separate directories. Tools like ccswarm, Crystal, and Pochi already orchestrate multiple Claude Code or Codex sessions in worktree-isolated environments with visual management, so there's a reference for both the mechanics and the UI.

Two operational gotchas to plan around: **port collisions** (every dev server defaults to 3000/5432/8080 — assign per-worktree port offsets) and **dependency duplication** (`node_modules` doesn't carry over — symlink or run setup hooks on worktree creation).

### 3.2 The "ChangeSet" — your PR object, renamed

A PR on GitHub is just a row in a database with: source branch, target branch, diff, title, body, status, comments, reviewers, checks. You replicate it locally as a `ChangeSet` record:

```json
{
  "id": "chg_abc123",
  "title": "Add rate limiting to /api/auth",
  "source_worktree": ".agents/change-abc123",
  "source_branch": "agent/coder/abc123",
  "target_branch": "main",
  "state": "in_review",
  "current_owner": "security-agent",
  "history": [
    {"agent": "planner", "action": "created",  "ts": "..."},
    {"agent": "coder",   "action": "submitted","ts": "..."},
    {"agent": "tester",  "action": "approved", "ts": "...", "notes": "..."}
  ],
  "checks": [
    {"name": "unit-tests", "status": "passed"},
    {"name": "lint",       "status": "passed"},
    {"name": "sast",       "status": "running"}
  ],
  "review_comments": [...]
}
```

Persist these in SQLite (single-file, zero ops, fits the local-first goal) or Postgres if multi-user. The schema is small and stable — the value is the **state machine** wrapped around it, not the storage.

### 3.3 Inter-agent transport: MCP, A2A, or plain REST

This is where the architectural choice actually matters. Three options, with clear trade-offs:

**Option A — MCP (recommended for the inner loop).**
Stand up one local MCP server (`changeset-mcp`) exposing tools like `create_change`, `submit_for_review`, `request_changes`, `approve`, `merge`, `add_comment`, `get_diff`. Every agent — Claude Code, Codex, your custom Python agents — connects as an MCP client over stdio (local) or streamable HTTP (if some agents are remote). MCP defines tool inputs, outputs, and error states in a standard format that any compliant model reads correctly, and supports one agent invoking another as a tool, which is what makes multi-agent architecture viable at the protocol level rather than requiring a custom message bus on top. This is your fastest path because Claude Code, Cursor, and most agent runtimes already speak MCP natively.

**Option B — A2A (use only if you have heterogeneous agents).**
A2A is positioned to complement MCP — the official guidance is to use MCP for tools and A2A for agents. A2A includes built-in support for agent discovery, JSON-RPC 2.0 transport, and SSE streaming, with AgentCards describing capabilities. It's the right answer if you have, say, a LangGraph agent talking to a Google ADK agent talking to a Claude agent — discovery and capability negotiation matter. For an all-Claude or all-one-framework stack, A2A is overkill; MCP is enough.

**Option C — Plain REST + SSE/WebSockets.**
Skip both protocols and just expose `POST /changes/{id}/approve` etc. Cheapest to build, no framework lock-in, but you lose the schema discipline and the ecosystem (no Claude Code slash commands, no MCP marketplace).

**Recommendation:** MCP for agent-to-orchestrator and agent-to-ChangeSet operations; SSE/WebSockets for orchestrator-to-UI streaming. Skip A2A unless you're crossing framework boundaries.

### 3.4 Orchestration: LangGraph state machine

The state machine *is* the workflow. LangGraph is the right primitive here because it represents workflows as graphs where nodes are functions and edges define transitions, and critically, it has **first-class human-in-the-loop interrupts** that map directly to "request changes" semantics:

```python
# pseudo-code
graph = StateGraph(ChangeSetState)
graph.add_node("plan",     plan_agent)
graph.add_node("code",     code_agent)
graph.add_node("test",     test_agent)
graph.add_node("security", security_agent)
graph.add_node("merge",    merge_agent)

graph.add_conditional_edges("test",
    lambda s: "security" if s.tests_passed else "code")  # fail → back to coder
graph.add_conditional_edges("security",
    lambda s: "merge" if s.sec_approved else "code")
```

LangGraph's interrupt primitive pauses execution and surfaces state to your UI with actions like approve / reject / modify, then resumes with the human's decision — this is the same primitive you use for "agent requests human review" without changing the architecture. LangGraph's stateful graph model with native checkpointing is the primary reason it dominates enterprise production deployments; you get crash recovery and replay for free, which matters when an agent run takes 20 minutes.

The handoff itself — "code agent → test agent" — happens implicitly when a node returns and the graph routes to the next node. Each agent only needs to know its own job and write its result into the typed state; the graph does the routing.

Alternatives:
- **CrewAI** — faster prototype, role-based metaphor (Coder, Reviewer, Tester), but CrewAI technically supports cycles but the debugging experience is painful. Fine for linear pipelines, weak for "rejected → back to coder → re-review" loops.
- **OpenAI Agents SDK** — clean handoff primitive, but ties you to OpenAI tooling.
- **Custom asyncio loop** — possible, but you'll rebuild checkpointing, retries, and HITL yourself.

### 3.5 Visualization: don't draw PRs, draw the pipeline

Two views, both fed by the same WebSocket/SSE stream from the orchestrator:

1. **Kanban (default).** Columns = states (Draft, Coding, Testing, Security, Merged). Cards = ChangeSets. Card shows current owner agent, time-in-state, last comment. Click → diff viewer + agent transcript.
2. **Live graph.** Render the LangGraph as a directed graph; pulse the active node; show edge traversals as animations. This is the "feels like watching the assembly line" view.

For the diff itself, embed Monaco editor + a server-side `git diff` call. For agent transcripts, render the message stream — same component you'd use for a chat. There are existing precedents to crib from: Tutti's web dashboard shows every agent's status in real time, with a factory-floor view of agents working simultaneously and work-item dots flowing through the pipeline, and Pochi binds each worktree to its own agent state and surfaces each agent as a separate tab where you can diff, commit, discard, or merge worktrees independently.

The deliberate UX choice: **never use the word "Pull Request" in the UI.** Use "Change", "Handoff", "Stage", "Owner". This frees users from GitHub's mental model — review can be parallel, an agent can claim a change, a change can be queued behind another, none of which map cleanly to a PR.

---

## 4. Existing tools to look at (don't rebuild what's done)

| Tool | What it gives you | Gap to fill yourself |
|------|---|---|
| **Tutti** (Rust CLI) | Multi-agent orchestration over tmux + worktrees, web dashboard, dispatch panel. Spawns multiple AI coding agents in tmux sessions, gives each one its own git worktree, and orchestrates them through configurable workflows — plan, implement, test, review, ship. | Tied to GitHub issues for the work-item primitive; you'd swap that for a local ChangeSet store. |
| **Crystal / Pochi / ccswarm** | Per-agent worktree UIs in VS Code or desktop apps. | Single-developer focused; no formal review state machine. |
| **auditlm** (Forgejo + local LLM) | A self-hosted code review bot that monitors a Forgejo instance for PRs, sets up isolated container environments, and uses local LLMs to post reviews. | Still uses Forgejo as the PR substrate — fine if you're OK running a local forge; not "no GitHub-like thing at all". |
| **opencode-review-gitea** | AI-powered code review for Gitea/Forgejo PRs with line-level comments, approve/request-changes/comment decisions, and incremental review of new changes since last review. | Same — assumes a Gitea forge exists. |
| **RepoReviewer** | Local-first multi-agent code review with stages for cloning, context, file-level review, prioritization, and reporting; backend in FastAPI + LangGraph + LiteLLM, frontend in Next.js, artifacts written to disk. | Read-only review pipeline; no write/handoff back to coder. Closest reference architecture in the literature. |
| **LangGraph** | The state machine + HITL interrupts + checkpointing. | Doesn't define your domain model (ChangeSet) or UI. |

**Two viable paths:**

- **A. Pure local, no forge.** Build the ChangeSet MCP server + LangGraph orchestrator + SPA from scratch. Most freedom, most code. RepoReviewer is the closest open-source starting point.
- **B. Local forge as the data plane.** Run Forgejo or Gitea on `localhost`, let it own the PR object and the diff viewer, and put your agents on top via auditlm-style polling or a Forgejo-MCP server. Less code, but the UI says "Pull Request" — you'd need a custom skin to hide that.

If "feels like GitHub PRs but doesn't show up as PRs" is the hard constraint, path A is the right answer. Path B is the 80%-there shortcut.

---

## 5. Concrete handoff flow (end-to-end example)

Goal: implement rate limiting on `/api/auth`.

1. **Human → Planner agent**: "Add rate limiting to auth endpoints, 10 req/min per IP."
2. **Planner** drafts a spec, calls `changeset.create({title, spec, target_branch: "main"})` via MCP. Orchestrator creates ChangeSet `chg_abc`, state = `planned`, allocates worktree `.agents/chg_abc`.
3. **Orchestrator** routes to **Coder agent** (Claude Code instance bound to that worktree). Coder edits files, commits to `agent/coder/abc`, calls `changeset.submit_for_review(chg_abc)`. State → `in_test`.
4. **Test agent** runs the test suite in the worktree (isolated env). Writes results to `chg_abc.checks`. If pass → `changeset.approve(chg_abc, role="test")`, state → `in_security`. If fail → `changeset.request_changes(chg_abc, role="test", notes=...)`, state → `coding`, routes back to Coder with the failure log.
5. **Security agent** runs SAST + reviews the diff for auth-specific concerns. Approves or requests changes the same way.
6. **Merge agent** (or human): `changeset.merge(chg_abc)` → fast-forward `agent/coder/abc` into `main`, tear down worktree.
7. **UI** shows the card moving through columns in real time, with the agent transcripts viewable on click.

Notice: no PR was ever opened. The same review semantics — approve, request_changes, comment, check status — exist as MCP tool calls and as columns in a UI, never as a "PR #N" anywhere.

---

## 6. Security considerations (don't skip)

Multi-agent local SDLC is high-trust by default, which is exactly the wrong default. Three threat surfaces to design for:

- **Tool poisoning via the ChangeSet MCP server.** Industry-leading LLMs may be coerced to use MCP tools and compromise an AI developer's system through attacks like malicious code execution, remote access control, and credential theft. Treat the MCP server as untrusted input from the agents; validate every argument, scope tokens narrowly, and log every call.
- **Sandbox escape from the worktree.** Each Test/Security agent runs code from the diff. Run those agents in a container or VM, not bare on the host. Practical controls include containerized sandboxing with input/output checks, inline policy enforcement with DLP and anomaly detection, and centralized governance using private registries or gateway layers. The worktree directory should be the only writable mount.
- **Privilege of the Merge agent.** This is the only agent that touches `main`. Make it the most constrained: it should only be invokable when the state machine is in `approved` state, and ideally require a human approval interrupt before the actual merge.

For audit, the orchestrator's checkpoint store doubles as your audit log — every state transition, every agent that touched a change, every tool call. Don't gc it.

---

## 7. Build order (rough roadmap)

1. **ChangeSet MCP server** (Python or TS, ~1 week). SQLite-backed, tools for CRUD + state transitions. Test by hand with `mcp inspect`.
2. **Worktree manager** (~2 days). Thin wrapper over `git worktree` with port allocation and setup hooks.
3. **LangGraph orchestrator with 2 agents** (Coder + Tester only, ~1 week). Prove the state machine + interrupts work end-to-end on a toy repo.
4. **SPA + WebSocket bridge** (~1 week). Kanban view first; graph view second.
5. **Add Security + Merge agents, sandboxing, audit log** (~2 weeks). This is where it becomes production-ish.
6. **Optional: A2A bridge** if you need to plug in agents from other frameworks.

Total: a working prototype in 2–3 weeks for one developer, a hardened version in 6–8 weeks.

---

## 8. Open questions worth thinking about

- **Conflict resolution between parallel changes.** Two agents working on changes that touch the same files. The PR model just lets the second one rebase; you'll need an explicit "rebase agent" or a queueing policy.
- **Where does the spec live?** If the planner writes a spec and the coder implements it, the spec should be part of the ChangeSet, not just chat history — otherwise the security agent has nothing to check intent against.
- **Human-in-the-loop placement.** Easy to over-pause and lose the throughput benefit, easy to under-pause and let bad code merge. Default to a human interrupt at security → merge, then tune.
- **Replay and determinism.** LangGraph checkpoints help, but LLM nondeterminism doesn't. Consider seeding + temperature=0 for the security/test agents specifically.

---

## Sources

Multi-agent SDLC orchestration: Tutti, V7 Labs, Salesforce, RepoReviewer (arXiv 2603.16107), gurusup.com.
MCP and A2A: Anthropic MCP docs, Cloudflare Agents, OpenAI Agents SDK, A2A protocol spec, Apono, Salesforce.
Git worktrees for AI: Upsun devcenter, Towards Data Science, Nick Mitchinson, DataCamp, Pochi.
Local forge + AI review: auditlm, opencode-review-gitea, Forgejo MCP server.
Frameworks and HITL: LangGraph docs, LangChain HITL middleware, CrewAI/LangGraph/AutoGen comparisons.
Security: MCP Safety Audit (arXiv 2504.03767), Securing the Model Context Protocol (arXiv 2511.20920).
