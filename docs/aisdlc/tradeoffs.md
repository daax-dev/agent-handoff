# AI SDLC Trade-off Analysis: Differences Between Source Documents

**Purpose:** Deep analysis of every significant point of disagreement between the three source documents. For each difference, identify the right answer for *this specific context* (TypeScript/Bun codebase, single developer, local-first, inner/outer loop combination).

---

## Trade-off 1: Orchestration Framework — LangGraph vs. Hand-Rolled FSM

**Disagreement:**
- Gemini + Claude docs: LangGraph for state machine, HITL interrupts, checkpointing
- OpenAI doc: Plain FastAPI/REST, no framework dependency, explicit FSM

### Arguments For LangGraph
1. First-class HITL interrupt support maps directly to "request changes" semantics
2. Crash recovery via checkpointing is free — if an agent run takes 20 minutes and fails halfway, the graph resumes from the last checkpoint
3. Conditional edges and cycles are the natural representation of a review workflow with rejection loops
4. LangSmith provides production-grade observability out of the box

### Arguments Against LangGraph
1. The TypeScript port (`@langchain/langgraph`) is less mature than Python LangGraph; production readiness is unproven at scale
2. Introduces a large dependency tree rooted in the LangChain ecosystem, which has a history of breaking changes
3. The existing codebase is TypeScript/Bun with zero Python; adding LangGraph in Python creates a language boundary requiring a sidecar process
4. For a single-developer local system, crash recovery from SQLite checkpoints is achievable with a hand-rolled approach
5. LangSmith for observability requires a cloud account — contradicts local-first data sovereignty goal
6. A hand-rolled FSM is easier to debug, easier to audit, and doesn't abstract away state transitions that engineers need to reason about

### Decision: Hand-Rolled TypeScript FSM
**Verdict: Hand-rolled FSM wins for this context.** The checkpointing and HITL interrupt patterns from LangGraph are *concepts* worth implementing, not libraries to depend on. A TypeScript enum of states, a transition table, and a SQLite-persisted state record achieve the same result. The HITL interrupt is a `status: "awaiting_human_approval"` row in the database that the UI polls. Crash recovery is a SQLite transaction. These are 50 lines of code, not a framework.

**What to borrow from LangGraph:** The concept of conditional routing (reject → back to implementer vs. approve → next reviewer), checkpoint semantics (save state before each transition), and HITL as a first-class state (not an error condition).

---

## Trade-off 2: Visualization Stack — Streamlit vs. React SPA

**Disagreement:**
- Gemini doc: Streamlit with streamlit-flow for graph visualization
- OpenAI + Claude docs: React/Vite SPA with Kanban + diff viewer + WebSocket/SSE

### Arguments For Streamlit
1. Rapid prototyping — a working dashboard in hours, not days
2. Python-native: natural fit with LangGraph orchestration (if using Python)
3. Handles markdown rendering, dataframes, charts out of the box
4. AGENTS.md pattern provides a mechanism for AI-assisted dashboard development

### Arguments Against Streamlit
1. Not designed for sub-second real-time event streaming — each interaction triggers a full Python script rerun
2. Cannot efficiently stream tmux pane output to the browser (no persistent WebSocket connection in Streamlit's model)
3. Introduces a Python dependency in a TypeScript project
4. The `streamlit-flow` component is a community component with uncertain maintenance
5. Streamlit apps are inherently single-page with limited navigation — a PR-like UI needs page routing (task list → task detail → diff view → review panel)
6. The OpenAI doc explicitly models 8 panels in the change request view; this is a real web application, not a data dashboard

### Decision: React SPA (Vite + TypeScript)
**Verdict: React wins.** The core requirement is streaming agent output and rendering diffs inline — both require a persistent WebSocket/SSE connection that Streamlit cannot provide without significant workarounds. The existing codebase is TypeScript, so a React frontend keeps the entire stack in one language. The "watch the agents" requirement specifically demands a live streaming terminal-like view, which is a React component (`xterm.js` or custom SSE subscriber), not a Streamlit widget.

**What to borrow from Streamlit docs:** The `streamlit-flow` mental model for graph visualization — implement the equivalent in React using `ReactFlow` or a lightweight SVG renderer.

---

## Trade-off 3: A2A Protocol — Core Infrastructure vs. Optional Bridge

**Disagreement:**
- Gemini doc: A2A is essential for agent-to-agent communication, complements MCP
- OpenAI + Claude docs: A2A only when heterogeneous frameworks are involved

### Arguments For A2A as Core Infrastructure
1. A2A provides agent discovery via Agent Cards — useful when the set of agents changes
2. Standardized JSON-RPC 2.0 transport enables any compliant agent to participate regardless of implementation
3. Async push notifications (webhooks) suit long-running review tasks
4. Future-proofs the system for multi-user or remote agent scenarios

### Arguments Against A2A as Core Infrastructure
1. The existing codebase already has an A2A client — adding an A2A server doubles the complexity without immediate benefit
2. For a single-developer local system with all-Claude agents, A2A is discovery overhead with no discovery problem to solve
3. The MCP tool plane already handles "agent reads state and invokes action" — A2A handles "agent calls agent," which is a different pattern
4. A2A is still maturing; the spec has changed and client implementations vary

### Decision: A2A as Optional External Bridge Only
**Verdict: Keep A2A as it is in the existing codebase — as a client for *external* agents, not as the internal communication protocol.** Internal agent-to-agent coordination happens through the MCP tool plane (agent calls `create_handoff`, next agent reads `task://TSK-XXX`). A2A remains available for integrating external agents (e.g., a remote security scanner that exposes A2A endpoints).

---

## Trade-off 4: Domain Object Naming — ChangeRequest vs. ChangeSet vs. Other

**Disagreement:**
- OpenAI doc: ChangeRequest (CR-XXXXXX)
- Claude doc: ChangeSet (chg_abc123)
- Gemini doc: unnamed / "handoffs"

### Analysis
This is cosmetic but matters for developer experience. The name should:
1. Not imply GitHub PR semantics (avoid "PullRequest", "PR")
2. Not imply bureaucratic approval process (avoid "ChangeRequest" — too ITIL)
3. Clearly communicate "a bundle of code changes under review"

**ChangeSet:** Clean. Developer-familiar (used in database migration tools, Liquibase, etc.). Neutral about approval semantics. Plural by nature — correctly implies multiple file changes. Minor issue: "changeset" in some tooling means an ordered set of schema migrations, which could confuse database engineers.

**ChangeRequest (CR):** Enterprise-appropriate but carries ITIL/ITSM baggage ("change request" in ITSM is a formal process artifact). Not ideal for a developer-facing tool.

**Proposal: "Revision" (REV-XXXXXX)** — Not used in any document but worth considering. Neutral, clear, no baggage. Rejected: "revision" often implies document editing rather than code changes.

**Final decision: Keep "ChangeSet" from Claude doc.** It's the freshest term, avoids GitHub and ITIL baggage, and "chg_abc123" prefix is clean. Internally, persist as `change_sets` table in SQLite.

---

## Trade-off 5: Backend Language — TypeScript vs. Python vs. Go

**Disagreement:**
- Gemini doc: Python (FastAPI, LangGraph, Streamlit)
- OpenAI doc: TypeScript or Go ("Go-First for enterprise CLI")
- Claude doc: Python or TypeScript

### Analysis
The existing codebase is TypeScript (Bun). This is the strongest possible constraint.

**TypeScript advantages for this project:**
1. The MCP server is already TypeScript — extending it is trivial
2. React frontend shares types, utilities, schema validation (Zod)
3. Bun provides native SQLite (`bun:sqlite`) — no dependency needed
4. Single language across CLI, API, MCP server, and UI reduces context switching
5. The existing CLI adapters, A2A client, job store are all TypeScript

**Python advantages:**
1. LangGraph, LangChain ecosystem
2. GitPython for richer Git operations
3. Broader AI/ML ecosystem
4. FastAPI is excellent for rapid REST API development

**Go advantages:**
1. Single binary distribution
2. Superior performance for concurrent I/O
3. `go-git` is a production-grade Git library

**Decision: TypeScript (Bun) throughout.**
The existing code is TypeScript. Go would require a rewrite. Python would introduce a language boundary. TypeScript with `bun:sqlite`, `simple-git` (or native git CLI subprocess), and the existing MCP SDK is the right stack. The "Go for enterprise CLI" argument is valid for greenfield projects but not when there's an existing TypeScript base.

---

## Trade-off 6: MVP Staging — OpenAI 4-Step vs. Claude Time-Based vs. No Staging

**Disagreement:**
- Gemini doc: No explicit MVP staging
- OpenAI doc: 4 explicit MVPs (PR Core → MCP Interface → Multi-Agent Review → Full Dashboard)
- Claude doc: Rough 6-step roadmap with time estimates (2-3 weeks prototype, 6-8 weeks hardened)

### Analysis
The OpenAI doc's 4-MVP structure is the most useful. The stages map to separable testable increments. The Claude doc's time estimates are sanity checks, not a plan. The Gemini doc's lack of staging is a weakness — it describes a complete system without a path to get there.

**Adjusted staging for existing codebase:**
- The existing `agent-handoff` is roughly equivalent to MVP-0 (agent dispatch infrastructure)
- MVP-1 should be: ChangeSet domain model + SQLite state store + worktree manager
- MVP-2: REST API + SSE events + basic UI (task list + status)
- MVP-3: MCP tools extension (ChangeSet-aware tools)
- MVP-4: Multi-agent review (planner → implementer → reviewer chain)
- MVP-5: Full review dashboard (diff viewer + inline comments + check runs)
- MVP-6: HITL gates + decision log + merge controls

**Decision: 6-MVP staging** (shifted from OpenAI's 4, because existing MVP-0 exists and the UI work deserves its own stage).

---

## Trade-off 7: Gitea / Local Forge vs. Pure Local

**Disagreement:**
- Gemini doc: Gitea is a valid option (Docker container, REST API)
- Claude doc: "Path B" — Gitea as "80%-there shortcut" but UI says "Pull Request"
- OpenAI doc: Never mentions Gitea; implies pure local

### Analysis
Gitea provides: PR UI, branch protection, webhook triggers, diff rendering — essentially the GitHub UI running locally. The cost: another Docker service to run, the UI says "Pull Request" everywhere, and the domain model is GitHub-shaped (which the Claude doc correctly identifies as the wrong mental model).

**For this use case:** The user explicitly wants "a tighter loop than using GitHub." Running a local GitHub clone is the opposite direction. Gitea adds operational complexity (Docker, credentials, API tokens) and locks into GitHub semantics rather than freeing from them.

**Decision: Pure local, no forge.** Build the ChangeSet MCP server + REST API + SPA. Do not introduce Gitea. The "Path B" shortcut trades immediate PR UI familiarity for long-term coupling to the wrong abstraction.

---

## Trade-off 8: Token Efficiency — Explicit vs. Implicit

**Disagreement:**
- Gemini doc: Explicit token budgeting — compact "claims" reduce 30K-token handoffs to 400 tokens
- OpenAI + Claude docs: Not addressed

### Analysis
This is not really a disagreement — the OpenAI and Claude docs just don't mention it. But the Gemini doc is correct that token efficiency matters.

In the existing codebase, the `prompt` field in a `handoff_task` call is the entire agent context. For a simple "implement this feature" prompt, this is fine. For a multi-round review cycle where an agent receives a full diff + previous review comments + task spec + acceptance criteria, the context window can grow quickly.

**Concrete impact:** If a reviewer agent receives:
- Task spec (2K tokens)
- Diff (5K tokens)
- Previous review comments (3K tokens)
- Acceptance criteria (1K tokens)
- Architecture docs (20K tokens) ← this is where bloat happens

The total hits 31K tokens. A focused handoff should pass only:
- Task spec (2K)
- Diff (5K)
- Acceptance criteria (1K)
- Previous blocking comments (500 tokens)
= 8.5K tokens — 73% reduction

**Decision:** Implement a `HandoffContext` builder that constructs minimal context from structured references (`task://TSK-XXX`, `diff://CR-XXX`) rather than dumping raw content. This is a design constraint on the handoff payload schema, not an external library.

---

## Trade-off 9: "Watch the Agents" — Terminal Stream vs. Log View

**None of the three documents fully address this.**

The user requirement: "watch the agents somehow" as issues go through phases.

Three possible approaches:

**Option A: Tmux-native (already in codebase).** Agents spawn in tmux windows. User opens a terminal and `tmux attach`. Raw, but real-time. No integration with the UI. Currently supported in `agent-handoff` via `spawnMode: "tmux"`.

**Option B: SSE stream from MCP server.** The MCP server opens a persistent SSE endpoint per job. The CLI agent's stdout is piped line-by-line to the SSE channel. The UI subscribes and renders a terminal-like log view. Clean integration, requires OS pipe to SSE bridge.

**Option C: Log file tailing + SSE.** Agent writes stdout to a log file in `.work/`. A backend file watcher (Node `fs.watch` or Bun's equivalent) detects new lines and broadcasts them via SSE. The UI subscribes. Simpler than Option B, tolerates agent crashes without losing output.

**Decision: Option C (log tailing) as the primary stream, tmux as fallback.** This is the most resilient. The log file is the source of truth; the SSE stream is derived from it. If the UI disconnects and reconnects, it can replay from the log file. Tmux mode remains available for developers who prefer a terminal.

---

## Trade-off 10: Inner Loop vs. Outer Loop Integration

**Not addressed in any source document.**

The user requirement: "can be actually done in combination with an outer loop GITHUB type AI SDLC via PRs."

This implies a bridge interface:

**Outer loop → Inner loop (import):**
- A GitHub issue → local task (TSK-XXXXXX)
- Needs: `gh issue view --json` or GitHub MCP server to pull issue data

**Inner loop → Outer loop (export):**
- A local ChangeSet (approved + merged locally) → GitHub PR on a feature branch
- Needs: `git push origin <branch>` + `gh pr create`

**Bridge design:** A CLI command `localsdlc export <CR-XXXXXX> --remote origin` that:
1. Pushes the local feature branch to the remote
2. Opens a GitHub PR with the ChangeSet summary, decision log, and review comments as PR body
3. Records the GitHub PR URL in the local ChangeSet record

And the reverse: `localsdlc import-issue <github-issue-url>` that:
1. Creates a local task from the GitHub issue title/body
2. Pre-populates spec with the issue description
3. Links the local task to the GitHub issue number

**Decision:** Design the bridge interface now; implement it in MVP-6. The domain model must include fields for `github_issue_url`, `github_pr_url`, and `remote_branch` from the start.

---

## Summary: Decisions Made

| Trade-off | Decision |
|-----------|----------|
| Orchestration framework | Hand-rolled TypeScript FSM (concepts from LangGraph, no dependency) |
| Visualization | React SPA (Vite + TypeScript), not Streamlit |
| A2A protocol | External bridge only, not internal communication |
| Domain object name | ChangeSet (chg_XXXXXX) |
| Backend language | TypeScript (Bun) throughout |
| MVP staging | 6 stages (0 = existing, 1-6 = new) |
| Local forge (Gitea) | Rejected — pure local |
| Token efficiency | Explicit HandoffContext builder with structured refs |
| Agent output streaming | Log-file tailing → SSE; tmux as fallback |
| Inner/outer loop bridge | Design now, implement in MVP-6 |
