# AI SDLC Document Analysis: Three-Round Deep Review

**Sources:**
- `docs/aisdlc/ai-sdlc-gemini.md` — "Architecting Local-First Agentic SDLCs" (Gemini Research Synthesis)
- `docs/aisdlc/openai.md` — "Local PR-Like Multi-Agent AI SDLC" (OpenAI / PatchBoard Architecture)
- `docs/aisdlc/local-sdlc-claude.md` — "Local PR-Style Multi-Agent AI SDLC" (Claude Architecture)

---

## Round 1: Surface-Level Alignment and Structural Differences

### What All Three Documents Agree On

**1. Git worktrees are the foundational isolation primitive.**
All three treat `git worktree` as the non-negotiable core. One task = one branch = one worktree = one isolated agent workspace. There is no disagreement here. The Gemini doc goes furthest by describing per-worktree IP address assignment (127.0.0.2, 127.0.0.3) for dev server isolation. The OpenAI doc treats it as table stakes. The Claude doc cites existing tools (Tutti, Crystal, Pochi) as validation that this pattern is already deployed.

**2. MCP is the right interface layer for agents.**
All three position MCP as the "tool plane" — the standard interface through which agents read resources and invoke actions. No document proposes a custom RPC layer as a primary interface. All three note that Claude Code, Codex, and most modern agent runtimes speak MCP natively, making it the lowest-friction choice.

**3. SQLite for local state, JSONL for audit trail.**
All three converge on SQLite as the state store and JSONL as the append-only audit format. The Gemini doc extends this with vector indexing and CRDT sync; the others treat plain SQLite as sufficient. No document proposes Postgres as the primary store for the local-first use case.

**4. A "PR-like object" is the domain primitive.**
Every architecture defines a named entity that plays the role of a GitHub PR: `ChangeRequest` (OpenAI doc), `ChangeSet` (Claude doc), or unnamed but structurally equivalent "handoffs" (Gemini doc). All agree this object must carry: source branch, target branch, status, diff, review comments, check results, approval state, and audit trail.

**5. A state machine governs the review lifecycle.**
All three describe a workflow with discrete states that a change object moves through. The exact states differ, but the arc is: draft → implementing → reviewing → changes_requested | approved → merged. All acknowledge the recursive loop: rejected work routes back to the implementer.

**6. Human-in-the-loop is non-negotiable before merge.**
Every document explicitly calls out that agents should not merge without human approval. The Gemini doc calls these "HITL checkpoints." The OpenAI doc warns: "Agents can implement and review, but merge authority should remain human-owned." The Claude doc recommends defaulting to "human interrupt at security → merge."

**7. Specialized agent roles.**
All three propose a similar set: Planner, Implementer, Reviewer(s), Fixer, and at minimum a security-focused reviewer. The Gemini doc uses business analyst framing. The OpenAI doc gives the most complete set: Planner, Implementer, Test Agent, Security Reviewer, Architecture Reviewer, Fixer, Summarizer.

**8. Visualization is required, not optional.**
All three treat the "view your work" requirement as first-class. A visualization layer showing handoff state, agent activity, diffs, and review comments is not a nice-to-have — it is how humans exercise oversight.

---

### Where They Diverge (Round 1 Inventory)

| Dimension | Gemini | OpenAI | Claude |
|-----------|--------|--------|--------|
| Orchestration framework | LangGraph preferred, CrewAI/AutoGen mentioned | Plain FastAPI/REST, no framework preference | LangGraph strongly recommended |
| Visualization stack | Streamlit + streamlit-flow | React/Vite SPA | Browser SPA (React implied) |
| A2A protocol | Strong proponent | Optional, skip unless multi-framework | Optional, skip unless multi-framework |
| PR object name | Unnamed / "handoffs" | ChangeRequest (CR-XXXXXX) | ChangeSet (chg_abc123) |
| Backend language | Python (FastAPI) | TypeScript or Go | Python or TypeScript |
| Gitea/local forge | Mentioned as an option | Not mentioned | Mentioned as "path B" shortcut |
| Existing tools cited | Minimal | Minimal | Tutti, Crystal, RepoReviewer, auditlm |
| MVP scope | Not defined | 4 explicit MVP increments | Rough roadmap with time estimates |
| Token optimization | Explicit (compact handoffs, 90%+ reduction) | Not addressed | Not addressed |
| Security depth | Layered guardrails, MintMCP gateway | Tool poisoning, sandbox, merge agent constraints | Tool poisoning, containerized sandboxing, merge constraints |

---

## Round 2: Deep Technical Analysis

### Orchestration Framework: The Real Stakes

The biggest practical difference is whether to use LangGraph (Claude + Gemini docs) or plain REST/FSM (OpenAI doc). This is not a style preference — it determines the entire implementation architecture.

**LangGraph case (Claude + Gemini docs):**
LangGraph provides: stateful checkpointing, native HITL interrupts, cycle support (rejection → re-implement → re-review), and observability via LangSmith. It maps naturally to the SDLC workflow because the workflow *is* a graph with cycles. The state machine is implicit in the graph topology; you define nodes and edges, not states and transitions.

Weaknesses: Python-centric (though TypeScript port exists), steep learning curve (~10-14 days), opinionated about how state flows through the graph, adds a major external dependency. LangSmith for observability is cloud-dependent.

**Plain REST/FSM case (OpenAI doc):**
A hand-rolled FSM in FastAPI or TypeScript is more portable, easier to debug, requires no framework knowledge, and gives full control over state transitions. The state machine is explicit (states enumerated, transitions defined), making it easier to reason about. No crash recovery comes for free, but for a local single-user system that rarely runs for >20 minutes, this is acceptable.

**Synthesis:** For the existing TypeScript codebase (Bun + MCP SDK), a LangGraph dependency would mean either (a) a Python sidecar service or (b) using the TypeScript port (`@langchain/langgraph`). The TypeScript LangGraph port exists but is less mature than the Python version. A hand-rolled FSM in TypeScript is more consistent with the existing stack.

However, the *concepts* from LangGraph — checkpointing, conditional edges, HITL interrupts — are worth implementing natively even if LangGraph itself is not used.

---

### Visualization: Streamlit vs. React SPA

**Gemini doc (Streamlit):** Rapid prototyping, Python-native, renders markdown and diffs easily. Core limitation: not designed for real-time collaborative UI. Streamlit rerenders on state change, which works for a single-user dashboard but struggles with sub-second streaming events. The `streamlit-flow` component is suitable for graph visualization but is a community component with uncertain maintenance.

**OpenAI + Claude docs (React SPA):** Proper application architecture. Full control over layout, diff rendering (Monaco), WebSocket/SSE event handling. More code to write, but the result is a real application rather than a data dashboard. React + Vite is the most common pairing for local tooling frontends. Can use existing libraries for diff rendering (`diff2html`, Monaco editor).

**Synthesis:** The existing project is TypeScript/Bun. A React frontend is consistent with the stack and the more maintainable long-term choice. Streamlit would introduce a Python dependency and create a language boundary. That said, the OpenAI doc's MVP advice holds: the diff viewer and review panel are more important than the kanban board — start there.

---

### A2A Protocol: Worth It?

**Gemini doc** is the strongest A2A proponent, describing Agent Cards, JSON-RPC 2.0 over HTTP, async push notifications. It frames MCP + A2A as the "TCP/IP moment" for agents.

**OpenAI + Claude docs** both say: use A2A only when you have heterogeneous agents from different frameworks. For a single-stack (all Claude Code, all TypeScript), A2A adds overhead without benefit.

**Reality check:** The existing `agent-handoff` codebase already implements A2A client support (`src/a2a/`). The A2A pattern is already there. The question is whether the SDLC's internal agent communication should use A2A or a simpler internal API. The answer: internal agent communication should use the MCP tool plane (already established). A2A remains for external/remote agents.

---

### The Domain Object Naming War

This is cosmetically different but semantically meaningful. The name matters because it shapes how users think about the system.

- **ChangeRequest (OpenAI):** Formal, enterprise-appropriate. Implies request-for-change semantics. Maps to CR- prefix.
- **ChangeSet (Claude):** Developer-friendly, maps to the concept of "a set of changes." Maps to chg_ prefix.
- **PR / Pull Request (avoided in Claude doc):** Explicitly rejected — using GitHub terminology invites GitHub mental model.

**Synthesis:** "ChangeSet" is the better name for this system. It is neutral (doesn't imply approval semantics), familiar to developers, and avoids the GitHub-PR connotation. The Claude doc's deliberate UI vocabulary ("Change", "Handoff", "Stage", "Owner") is also right — a fresh vocabulary reduces confusion when the semantics differ from GitHub PRs.

---

### Token Efficiency: The Ghost in the Room

Only the Gemini doc explicitly addresses token efficiency — the observation that a naive handoff passing the full repository context can be 30,000 tokens, which a compact "claim" system can reduce to 400 tokens (90%+ reduction, cited source: r/codex).

The OpenAI and Claude docs don't address this. For a local single-user system this might seem unimportant, but it matters for:
1. Speed (agents respond faster with less context)
2. Cost (even local LLMs have practical context limits)
3. Quality (agents hallucinate less with focused context)

**Synthesis:** The context minimization pattern — passing only file diffs + task description + acceptance criteria rather than full repo state — should be a design constraint on all handoff payloads.

---

### MVP Scope: Who Has the Most Actionable Roadmap?

**Gemini doc:** No explicit MVP. Describes a complete architecture without staging.

**OpenAI doc:** Four clear MVPs:
1. Local PR Core (no MCP)
2. MCP Agent Interface
3. Multi-Agent Review
4. Full Review Dashboard

**Claude doc:** Rough roadmap with time estimates (1 week for MCP server, 2 days for worktree manager, etc.)

**Synthesis:** The OpenAI doc's four-MVP structure is the most actionable. The Claude doc's time estimates are useful sanity checks. The Gemini doc's comprehensive coverage is useful for ensuring nothing is missed.

---

### Existing Codebase Context (Not in Any Document)

All three documents assume building from scratch. The actual context is different: there is an existing `agent-handoff` MCP server in TypeScript/Bun that already provides:

- Multi-agent dispatch (CLI + A2A + worker pool)
- Job lifecycle (queued → running → completed/failed/timed_out)
- Git diff tracking (before/after HEAD snapshot)
- JSONL logging
- Worker pool with heartbeat-based liveness
- A2A protocol client

This foundation changes the plan. The gaps are:
1. No ChangeSet domain model (PR-like object)
2. No git worktree lifecycle management
3. No state machine for review workflow
4. No review comment / check run system
5. No REST API (only MCP stdio)
6. No SSE event streaming
7. No UI
8. No agent role definitions (planner, security reviewer, etc.)
9. No HITL gates
10. No per-task decision log

---

## Round 3: Synthesis and Remaining Blind Spots

### What the Documents Get Right Together

The three documents collectively describe a sound system. Their convergence on worktrees + MCP + SQLite + JSONL + review state machine + HITL merge gates represents a well-validated pattern. No single document is wrong; each is strong in different areas:

- Gemini: Best on protocol theory (MCP/A2A interplay), token efficiency, framework tradeoffs
- OpenAI: Best on domain model (concrete schemas), REST API design, MVP staging, UI spec
- Claude: Best on architectural decomposition (four primitives), LangGraph HITL, existing tool landscape

### Critical Gaps Across All Three

**Gap 1: How does the outer loop connect?**
The user requirement specifies this system should work "in combination with an outer loop GitHub-type AI SDLC via PRs." None of the three documents address the inner↔outer loop bridge. This is the most important gap. The system needs: (a) a way to export a completed local ChangeSet as a GitHub PR, and (b) a way to import a GitHub issue as a local task. This is an interface contract between the two loops, not just a GitHub Actions hook.

**Gap 2: Agent identity and model routing.**
All docs assume "an agent" without specifying how to select model/provider per agent role. For security reviewers you might want a different model than for implementers. The existing codebase supports model overrides but has no policy layer that says "security review uses claude-opus-4-7, implementer uses claude-sonnet-4-6."

**Gap 3: Conflict resolution between parallel changes.**
Only the Claude doc raises this (Section 8: "Open questions"). If two agents work on changes touching the same files, the system needs a queuing policy or explicit rebase agent. None of the three docs propose a concrete solution.

**Gap 4: Spec persistence.**
Where does the planner's spec live? The OpenAI doc mentions `plan.md` and `acceptance-criteria.md` in `.work/tasks/TSK-XXXXXX/`. The Claude doc says "the spec should be part of the ChangeSet, not just chat history." The Gemini doc calls this `SPEC.md` and `PLAN.md` at the repository root. These are the same thing named differently and stored in different places. The system needs a single spec location per task, version-controlled alongside the code.

**Gap 5: "Watch the agents" — the live observability requirement.**
The user explicitly requires the ability to "watch the agents somehow" as issues go through phases. This implies not just a dashboard but a live streaming view of agent thoughts/output. The Gemini doc mentions "inner monologue" display. The Claude doc mentions per-agent transcripts. The OpenAI doc mentions agent timeline. None fully specifies what this looks like for a tmux-spawned Claude Code session where output is streamed to a terminal. The existing codebase handles tmux spawning — the question is how to pipe that output to the UI.

---

### Self-Review: Round 1 — Initial Harsh Assessment

**What's missing:** This analysis is too descriptive. It inventories differences without sufficiently evaluating *which* position is correct. The "synthesis" sections hedge too much. Strong positions should be taken where evidence supports them.

**Correction:** LangGraph is NOT the right choice for this TypeScript codebase. The TypeScript port is less mature, adds a large Python-ecosystem dependency, and the existing codebase has no Python components. A hand-rolled FSM in TypeScript is the right call. This should be stated as a conclusion, not a "synthesis."

**What's also missing:** The analysis doesn't engage with the *existing code* as a constraint. All three documents are greenfield designs. The plan must BUILD ON the existing MCP server, not replace it.

---

### Self-Review: Round 2 — Sharper Critique

**Problem with Round 1 self-review:** It added the TypeScript FSM conclusion but still didn't adequately address the most important user requirement: **"watch the agents somehow."** This is the hardest engineering problem in the stack. Piping tmux session output to a WebSocket/SSE stream while an agent is running requires:
1. The MCP server to open a persistent SSE channel per job
2. A background process to tail the tmux pane output
3. The UI to subscribe and render the stream

None of the three documents fully address this. The analysis should have called this out as the primary novel engineering challenge, not as a "gap" buried in a list.

**Also missing:** The analysis never questions whether Streamlit is actually fast enough for real-time output streaming. It is not (Streamlit is not designed for sub-second event streams). React + SSE is the correct choice, and this should have been stated definitively rather than as a "more maintainable" preference.

---

### Self-Review: Round 3 — Final Assessment

**Remaining issues after Round 2:**
1. The analysis still doesn't clearly rank the three documents by quality/usability. The OpenAI doc has the most actionable concrete specs; the Claude doc has the best architectural decomposition; the Gemini doc has the best theoretical foundation but is weakest on practical implementation. This ranking matters for the plan.
2. The "outer loop" connection was identified as Gap 1 but not explored. It deserves a concrete interface spec, not just an acknowledgment.
3. The analysis doesn't state clearly enough: the existing `agent-handoff` codebase is already MVP-1 (roughly). It has job dispatch, A2A, worker pool, JSONL logging, git tracking. The work is MVP-2 and beyond: ChangeSet domain model, worktree manager, review system, UI.

**Final verdicts:**
- **Best architectural decomposition:** Claude doc (4 primitives)
- **Best concrete specification:** OpenAI doc (domain model, REST API, UI spec)
- **Best theoretical foundation:** Gemini doc (protocol stack, token efficiency)
- **Correct stack for this project:** TypeScript (aligned with existing code), hand-rolled FSM, React SPA, SQLite, JSONL, native git CLI
- **Do not use:** Streamlit (wrong for real-time), LangGraph TypeScript port (immature), Gitea (unnecessary dependency), A2A for internal agent communication (overkill for single-stack)
- **Do use from existing code:** MCP server infrastructure, A2A client (for external agents only), job store pattern, JSONL logger, tmux spawner
