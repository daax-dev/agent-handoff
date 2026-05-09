# Sub-PRD: Agent Handoff & Communication Protocol
**Status:** Draft v0.5
**Author:** JP + Jarvis
**Date:** 2026-03-29
**Parent:** [2nd Brain PRD](2nd-brain-prd.md)

**Existing foundations:**
- [jpoley/claude-peers-mcp](https://github.com/jpoley/claude-peers-mcp) — peer discovery + lateral messaging. **⚠️ Name and current implementation assumes Claude Code — must be made model-agnostic. The protocol never assumes a specific model.**
- [daax-dev/agent-handoff](https://github.com/daax-dev/agent-handoff) — MCP server for task delegation (CLI, A2A, pool modes; 11 tools; Claude/Codex/Gemini/Copilot/OpenCode adapters)
- [jpoley/flowspec](https://github.com/jpoley/flowspec) — where work lands (backlog + spec-driven dev)
- GitHub Issues — where work lands (task tracking)

---

## Current Implementation Status

The following components from this PRD are already shipped in `agent-handoff`:

| Feature | Status | Notes |
|---------|--------|-------|
| Bearer token auth | ✅ Shipped | `API_TOKEN` env var; loopback bypass for Vite dev |
| OpenClaw skill | ✅ Shipped | `examples/openclaw-skill/` — REST endpoints wired to OpenClaw |
| A2A handshake protocol | ✅ Shipped | Two-phase DoD handshake in `src/a2a/` |
| SPIFFE identity verification | ✅ Shipped | `src/auth/spiffe.ts` — SVID validation |
| Merkle chain provenance | ✅ Shipped | Content-addressed check runs; `verify-provenance` script |
| Session pool (warm pool) | ✅ Shipped | `src/orchestrator/pre-warm.ts` |
| Structured handoff context | ✅ Shipped | `src/handoff-context.ts`; `./handoff-context` subpath export |
| REST API + CLI | ✅ Shipped | `agent-handoff-server` bin; `agent-handoff` / `localsdlc` CLI |
| HITL approval gates | ✅ Shipped | Approval routes; FSM-driven gate model |
| Structured JSONL audit log | ✅ Shipped | Daily files; Merkle-chained; tamper-evident |

**Not yet built:** full broker registry, cross-machine agent discovery, pluggable HITL policy engine (OPA/Cedar), goal decomposition orchestrator, and `claude-peers-mcp` absorption.

---

## The Agent Broker

All agent communication flows through a single resilient broker — not peer-to-peer, not two separate servers. One server that every agent connects to.

**Broker responsibilities:**
- **Registry** — who is available, what are their capabilities (not their model)
- **Routing** — all handoffs (tasks, ideas, goals, messages) flow through the broker
- **State** — single source of truth for what's in flight, blocked, complete, failed
- **Spawn control** — no agent spawns without broker knowledge; enforces limits, detects conflicts
- **Resilience** — broker state is persisted; if a machine goes down, agents reconnect and resume from last known state
- **JP visibility** — full audit trail of everything flowing through the broker at all times

**What this replaces:**
- `claude-peers-mcp` (lateral peer discovery + messaging) → absorbed into broker
- `agent-handoff` (task delegation + lifecycle) → absorbed into broker

One server. One protocol. Not two repos doing overlapping jobs.

**The broker is the nervous system of the agent network.** Agents don't find each other — they talk to the broker, and the broker routes.

---

## Core Principle: Open Standards & CNCF Alignment

The broker is built principles-first, on open protocols. Every layer uses a standard where one exists. No proprietary wire formats. No vendor assumptions. Designed for open governance from day one — including potential CNCF donation if adoption warrants it.

**Standards consumed, not invented:**
- **Identity** — SPIFFE/SPIRE (SVIDs), JWT, OIDC, Entra Agent ID — broker consumes, never issues
- **Messaging** — CloudEvents for event envelope format
- **Agent-to-agent** — A2A protocol (Google open standard)
- **Tool invocation** — MCP
- **Observability** — OpenTelemetry (traces, metrics, logs on every handoff)
- **Authorization policy** — OPA/Cedar for policy-as-code enforcement

**The broker does NOT:**
- Issue identities
- Manage credentials
- Own the PKI

**The broker DOES:**
- Accept standard identity tokens (JWT, SPIFFE SVID, etc.) and validate them
- Enforce authorization policy based on verified identity
- Pass identity context through the full handoff chain
- Reject or revoke access when identity is invalid or expired

Clean separation: identity is the identity layer's problem. The broker consumes and enforces. Never conflates the two.

**Org note:** When ready for open release, this should live under a vendor-neutral org — not `daax-dev` or `jpoley`. Open governance signals intent from day one.

---

## Core Principle: Model Agnosticism

**The handoff protocol never assumes a specific model or vendor.** Agents are identified by ID and capability — not by which LLM powers them. Claude, Codex, Gemini, Copilot, OpenCode, or any future model must be interchangeable at the protocol layer. Model is an implementation detail of the agent, invisible to the handoff contract.

This applies to: peer discovery, lateral messaging, task delegation, verification, and all transport layers.

---

## Problem Statement

Agents need to hand off work to each other — tasks, ideas, and goals — in a way that is:
- Unambiguous (clear requirements + acceptance criteria)
- Traceable (every handoff logged, every decision recorded)
- Safe (JP always in the loop, no runaway spawns)
- Flexible (different situations need different protocols)
- Verifiable (done means done, not "I think I'm done")

No single protocol fits all situations. The handoff layer must be deliberate about which protocol applies when.

---

## Handoff Object Types

Three distinct types of things that can be handed off:

### 1. Task
Concrete, bounded work with a clear done state.
- Has: requirements, acceptance criteria, owner, deadline, dependencies
- Acceptance criteria: **must be testable** — not "make it good", but "all tests pass + X returns Y"
- Can be delegated, parallelized, pipelined
- Completion is verifiable by a third party

### 2. Idea / Hypothesis
Exploratory, open-ended — not yet a task.
- Has: hypothesis statement, context, what we're trying to learn
- Handed off for exploration, research, or refinement — not execution
- May result in: a task, a goal change, a decision to abandon, or more questions
- Requires discussion, not just execution — agents can push back

### 3. Goal
High-level outcome, may span many tasks and agents.
- Has: desired outcome, measurable success criteria, timeline, priority
- Can be decomposed into tasks by the receiving agent
- Requires orchestrator involvement for cross-channel goals
- JP signs off on goal creation and completion

---

## Handoff Situations & Protocols

Different situations call for different protocols. Deliberate mapping:

### Situation 1: Simple Task Delegation
*"Do X, report back when done."*
- **When:** Well-defined task, single agent, no ambiguity
- **Protocol:** MCP tool call via `agent-handoff` (handoff_task)
- **Format:** Structured JSON — requirements + acceptance criteria schema
- **Sync/Async:** Async — fire and poll
- **JP loop:** Notified on completion or failure, not mid-task
- **Verification:** Requesting agent checks acceptance criteria

### Situation 2: Task with Explicit Verification
*"Do X, then a second agent verifies it meets criteria Y before we accept."*
- **When:** High-stakes task, security-sensitive, or prior failure history
- **Protocol:** MCP handoff_task + separate verify_task call to a third agent
- **Format:** Structured JSON — requirements + acceptance criteria + verification checklist
- **Sync/Async:** Async with explicit verify gate before completion
- **JP loop:** Notified at verify gate — can approve or reject
- **Verification:** Dedicated verifier agent (not the executor)

### Situation 3: Collaborative Exploration (Discussion)
*"Agent A and Agent B discuss an idea/hypothesis, with JP in the conversation."*
- **When:** Idea or hypothesis needs exploration, no clear answer yet
- **Protocol:** claude-peers-mcp lateral messaging + JP channel
- **Format:** Natural language — structured prompts, not schema
- **Sync/Async:** Synchronous — real conversation, not fire-and-forget
- **JP loop:** JP is in the conversation, not just notified
- **Verification:** N/A — output is a decision, a refined hypothesis, or a new task
- **Negotiation allowed:** Agents can disagree, challenge, propose alternatives

### Situation 4: Goal Decomposition
*"Here's a goal — break it into tasks and assign them."*
- **When:** High-level goal needs to be turned into executable work
- **Protocol:** Orchestrator → Channel Agent → task decomposition
- **Format:** Hybrid — goal in natural language, decomposed tasks in structured JSON
- **Sync/Async:** Async — orchestrator delegates, channel agent reports back with task list
- **JP loop:** JP reviews and approves task breakdown before execution starts
- **Verification:** JP sign-off on decomposition

### Situation 5: Dependency Negotiation
*"Agent A needs Agent B to complete X before A can proceed."*
- **When:** Tasks have cross-agent dependencies
- **Protocol:** A2A protocol — agent-to-agent dependency declaration
- **Format:** Structured — dependency graph, blocking conditions
- **Sync/Async:** Async — A blocks and waits, B executes, A resumes on completion signal
- **JP loop:** Notified if dependency causes deadline risk
- **Verification:** Dependency satisfied = blocking condition met

### Situation 6: Escalation
*"Agent can't complete task — needs help or a decision."*
- **When:** Agent hits ambiguity, conflict, resource limit, or ethical boundary
- **Protocol:** Escalate to orchestrator; orchestrator escalates to JP if needed
- **Format:** Natural language — explain the blocker clearly
- **Sync/Async:** Synchronous — work stops until resolved
- **JP loop:** Always — JP resolves escalations, not agents
- **Verification:** JP explicitly unblocks

### Situation 7: Parallel Execution
*"Split this work across multiple agents simultaneously."*
- **When:** Work is parallelizable with no shared state conflicts
- **Protocol:** Orchestrator fans out via `agent-handoff` pool mode
- **Format:** Structured JSON — each agent gets its own scoped task + acceptance criteria
- **Sync/Async:** Async fan-out, sync fan-in (orchestrator waits for all)
- **JP loop:** Notified on completion of the full parallel batch
- **Verification:** Orchestrator aggregates and validates all results before reporting

### Situation 8: Sequential Pipeline
*"Agent A → Agent B → Agent C, each building on the previous output."*
- **When:** Work has ordered dependencies, each step produces input for the next
- **Protocol:** agent-handoff with output chaining — each agent's result is the next agent's input
- **Format:** Structured JSON — typed output schema per step
- **Sync/Async:** Async pipeline — each step completes before next starts
- **JP loop:** Checkpoint option at each stage (configurable per pipeline)
- **Verification:** Each stage verifies its input before proceeding

---

## Handoff Contract Schema

Every handoff — regardless of protocol — MUST include:

```json
{
  "handoff_id": "uuid",
  "type": "task | idea | goal",
  "situation": "simple | verified | exploratory | decomposition | dependency | escalation | parallel | pipeline",
  "from_agent": "agent_id",
  "to_agent": "agent_id | orchestrator | jp",
  "created_at": "ISO8601",
  "deadline": "ISO8601 | null",

  "payload": {
    "title": "human-readable title",
    "description": "natural language description",
    "requirements": ["structured requirement 1", "structured requirement 2"],
    "acceptance_criteria": ["testable criterion 1", "testable criterion 2"],
    "context": "what the receiving agent needs to know",
    "dependencies": ["handoff_id_1", "handoff_id_2"]
  },

  "jp_loop": {
    "notify_on": ["start | complete | fail | escalate | checkpoint"],
    "approval_required": true,
    "approval_gate": "start | complete | both | none"
  },

  "verification": {
    "required": true,
    "verifier": "agent_id | jp | none",
    "method": "acceptance_criteria | jp_review | automated_test"
  },

  "provenance": {
    "parent_goal": "goal_id | null",
    "parent_task": "handoff_id | null",
    "channel": "daax | finance | cyber | ...",
    "citations": ["source_url_1", "source_url_2"]
  },

  "status": "pending | active | blocked | complete | failed | cancelled",
  "result": null,
  "log": []
}
```

---

## Format Rules: Structured vs Natural Language

| Situation | Requirements | Acceptance Criteria | Communication |
|-----------|-------------|--------------------|-|
| Simple task | Structured JSON | Structured, testable | N/A |
| Verified task | Structured JSON | Structured, testable | N/A |
| Exploration | Natural language | N/A (output is a decision) | Natural language |
| Goal decomposition | Natural language (goal) + JSON (tasks) | Structured per task | JP review in natural language |
| Dependency negotiation | Structured JSON | Structured | N/A |
| Escalation | Natural language | N/A | Natural language to JP |
| Parallel | Structured JSON per agent | Structured, testable | N/A |
| Pipeline | Structured JSON + typed output schema | Structured per step | Optional checkpoint in natural language |

**Rule:** Acceptance criteria are ALWAYS structured and testable, never natural language. Requirements can be natural language at the goal level but must be structured by the time they reach an executing agent.

---

## Transport Protocol Selection

| Transport | Use When |
|-----------|---------|
| **MCP tool call** | Agent-to-agent within same runtime (agent-handoff server) |
| **A2A (HTTP JSON-RPC)** | Agent-to-agent across machines or runtimes |
| **peers-mcp** (model-agnostic rename of claude-peers-mcp) | Lateral ad-hoc discussion between **any** agents regardless of model |
| **Message queue** | Async fire-and-forget, pool mode, high-volume |
| **Direct API** | Orchestrator → channel agent (trusted, low-latency) |

---

## Human-in-Loop Policy Engine

When to involve a human is **never hardcoded**. It is driven by pluggable policy, configured per deployment based on risk appetite and task context.

### Plugin Contract (go-plugin pattern)
Inspired by [hashicorp/go-plugin](https://github.com/hashicorp/go-plugin) — the broker defines a gRPC plugin contract. Any conforming implementation can be dropped in. The broker never cares which policy engine is behind it.

**Contract interface — what the broker asks:**
```protobuf
service HumanLoopPolicy {
  rpc Evaluate(HandoffContext) returns (PolicyDecision);
}

message HandoffContext {
  string handoff_id = 1;
  string type = 2;           // task | idea | goal
  string situation = 3;      // simple | verified | exploratory | ...
  string from_agent = 4;
  string to_agent = 5;
  string channel = 6;        // daax | finance | cyber | ...
  string sensitivity = 7;    // low | medium | high | critical
  repeated string tags = 8;
  map<string, string> metadata = 9;
}

message PolicyDecision {
  bool require_approval = 1;       // block until human approves
  bool notify_on_start = 2;
  bool notify_on_complete = 3;
  bool notify_on_failure = 4;
  string approval_gate = 5;        // start | complete | both | none
  string escalation_path = 6;      // who to escalate to if policy engine unavailable
  string rationale = 7;            // human-readable reason for this decision
}
```

**Policy engine is unavailable → fail-safe:** default to require human approval. Never fail open.

### Reference Implementations (broker ships these)
| Implementation | Use Case |
|----------------|---------|
| **Config-based** | Simple YAML/JSON rules — low friction, good for most deployments |
| **OPA (Rego)** | Policy-as-code, audit trail, complex rules, enterprise |
| **Cedar** | AWS-native, attribute-based, structured policy language |
| **Custom Go plugin** | Any org can implement the gRPC contract and plug in |

### Policy Inputs (full handoff context passed to every evaluation)
- Handoff type + situation
- Agent identities (verified, from identity layer)
- Channel + topic sensitivity
- Task/goal/idea metadata
- Deadline and urgency
- Prior escalation history for this agent/task type
- Org-level risk appetite config

### The broker never decides alone
If the policy engine says "require approval" — the broker blocks, notifies, and waits. It does not proceed on timeout. It escalates.

---

## JP In The Loop — Non-Negotiable Rules

1. **JP is never removed from the loop** — agents can negotiate with each other but cannot make final decisions on goals or high-stakes tasks without JP
2. **Escalations always reach JP** — no escalation is resolved agent-to-agent only
3. **Goal creation and completion require JP sign-off** — always
4. **High-stakes tasks have an approval gate** — defined at handoff creation time
5. **JP can interrupt any handoff at any time** — agents must support a cancel/pause signal
6. **All agent conversations with JP available for review** — nothing is private between agents

---

## Verification Protocol

Done ≠ agent says done. Done = acceptance criteria verified.

**Three verification modes:**
1. **Self-verify** — requesting agent checks the criteria (low-stakes tasks)
2. **Peer-verify** — third agent runs the verification (high-stakes tasks)
3. **JP-verify** — JP reviews and signs off (goals, critical decisions)

Verification result logged to handoff record. Disputes escalate to orchestrator then JP.

---

## Relationship to Existing Repos

| Repo | Role going forward |
|------|-----------------------|
| `daax-dev/agent-handoff` | **Becomes the broker** — extend to absorb peer messaging, add resilience, persistence, registry, spawn control |
| `jpoley/claude-peers-mcp` | **Absorbed into broker** — lateral messaging becomes a broker routing mode, not a separate server. Model-agnostic rewrite. |
| `jpoley/flowspec` | Where decomposed tasks land for spec-driven execution |
| GitHub Issues | Where tasks land for tracking and PR association |

---

## Open Questions

1. How does the orchestrator discover available agents? (registry? heartbeat? static config?)
2. What's the timeout/retry policy for async handoffs?
3. How are conflicting acceptance criteria resolved? (two agents disagree on "done")
4. What's the canonical store for handoff records? (part of brain backend decision)
5. How does JP interrupt a running handoff from mobile/voice?
6. What's the versioning model for the handoff contract schema?
7. How do we handle partial completion? (agent completes 3/5 subtasks before failing)
