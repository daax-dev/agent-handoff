# agent-handoff — Engineering FAQ

> For each question: **Today's answer** (what works right now), **Harsh verdict** (honest DX assessment), and **PRD needed?** (is there a gap worth building against?).

---

## 1. How do I set this up with OpenClaw as my orchestrator?

**Today's answer**

OpenClaw ([openclaw.ai](https://openclaw.ai)) is a local-first personal AI assistant with multi-agent support, browser control, and a skill plugin system. It does **not** currently support MCP (Model Context Protocol). That means there is no drop-in integration path — you cannot register agent-handoff as an MCP server inside OpenClaw the way you would with Claude Code, Cursor, or Windsurf.

Two workarounds exist today:

**Option A — A2A bridge** (lower effort): Wrap agent-handoff's REST API in an OpenClaw skill plugin. Your OpenClaw skill would:
1. Call `POST /api/change-sets` to create a ChangeSet
2. Call `POST /api/tasks` to queue work
3. Poll `GET /api/jobs/:id` for results

OpenClaw's skill system can make HTTP calls, so this is implementable with a custom plugin.

**Option B — Use Claude Code as the thin orchestrator layer**: Run Claude Code with agent-handoff registered as an MCP server (`claude mcp add agent-handoff -- bun run <path>/src/index.ts`). Point OpenClaw's automation at the Claude Code session as the decision-maker. OpenClaw triggers intent; Claude Code + agent-handoff do the SDLC coordination.

Neither option is a first-class integration today. There is no `openclaw` entry in `src/cli/registry.ts` and no A2A adapter for OpenClaw's skill protocol.

**Harsh verdict**

The developer experience here is **poor**. OpenClaw users get zero documentation, zero examples, and no supported path. They hit a dead end immediately. The REST API exists but is undocumented as a public interface and has no auth story for external callers.

**PRD needed? Yes — "OpenClaw Integration"**
- Publish the REST API as a documented external interface with optional bearer token auth
- Write an OpenClaw skill plugin (JSON descriptor + HTTP calls to agent-handoff)
- Example workflow: OpenClaw receives "build feature X" via Discord → skill creates ChangeSet → agent-handoff runs the FSM → OpenClaw reports results back to Discord

---

## 2. Does agent-handoff avoid creating/destroying agent instances when consecutive steps use the same model?

**Today's answer**

Yes — but **only if you explicitly pre-register persistent sessions**. The mechanism is real; it just isn't automatic.

The orchestrator (`src/orchestrator/index.ts`) uses two modes:

- **Mode B (preferred): dispatch to a pre-spawned session.** `findWaitingSession()` searches the `agent_sessions` table for an idle session matching the required `tool` and `role`. If found, the orchestrator assigns the ChangeSet to that session (marks it `busy`) without spawning anything. When the step finishes, the session returns to `waiting` and is available for the next step — even if that next step is a different ChangeSet or the same one at a later FSM state.

- **Mode A (fallback): on-demand spawn.** If no waiting session exists, `spawnAgent()` runs `claude -p "..."` as a new child process. This process exits when the prompt completes. The next step will spawn another process.

The session lifecycle in Mode B:
```
register_session (claude-code, roles=[implementer]) → status: waiting
orchestrator picks it up → status: busy
step finishes → markWaiting() → status: waiting  ← same process, reused
orchestrator picks it up again → status: busy
...
```

What does **not** exist: any lookahead planner that inspects the workflow graph, sees that steps 3 → 4 → 5 all use `claude-sonnet`, and automatically keeps one session alive. If you use on-demand spawning (Mode A), every step pays the full process create/destroy cost and a fresh `claude -p` context.

Sessions are created via the Sessions tab in the web UI or via `register_worker`. They must be registered before the FSM transitions reach them to benefit from reuse.

**Harsh verdict**

The capability exists but the UX is opt-in manual labor. A developer picking up this system for the first time will hit Mode A by default — spawning and killing a new `claude -p` process for every FSM step. They won't discover session pre-registration until they read the docs or profile their workflow. For a multi-step pipeline (planner → implementer → reviewer → fixer), that's 4 separate process launches with separate cold contexts, when it could be one persistent session threaded through all four.

**PRD needed? Yes — "Auto-warm session pool for consecutive same-tool steps"**
- At workflow startup (or ChangeSet creation), inspect the FSM transitions and pre-launch one session per distinct `tool` used in the graph
- Sessions auto-register themselves; orchestrator dispatches to them immediately
- Add a `session_pool_size` config per tool so users can tune concurrency
- Add UI indicator: "2 sessions pre-warmed for claude-code"

---

## 3. How is context and memory passed between steps?

**Today's answer**

Context is **stateless and document-based**, not conversational. When a step completes and the next agent picks up the ChangeSet, it doesn't inherit a chat history. Instead, `get_handoff_context` calls `HandoffContextBuilder` which assembles a structured prompt from five named slots:

| Slot | Source | Max Tokens |
|------|--------|------------|
| `taskSpec` | `.work/tasks/{id}/spec.md` | Configurable per slot |
| `diff` | `git diff <target>...HEAD` in the worktree | Configurable |
| `acceptanceCriteria` | `.work/tasks/{id}/acceptance.md` | Configurable |
| `blockingComments` | SQLite `review_comments` WHERE `severity='blocking' AND resolved=0` | Configurable |
| `architectureContext` | `.work/tasks/{id}/plan.md` | Configurable |

Each slot has a token budget. If a slot exceeds its budget, it's truncated at the character boundary and the slot name is added to `truncatedSlots` so the receiving agent knows to check the full file. The combined context is injected into the role's system prompt via `{{handoff_context}}`.

A reviewer picking up after an implementer sees:
- The original task spec (what was asked)
- The actual git diff (what was done)
- Acceptance criteria (what done means)
- Any blocking review comments from a prior review cycle
- The architecture plan (design constraints)

All of this is regenerated fresh at each handoff from the source-of-truth files and database. There is no message passing between agent processes.

**Harsh verdict**

This is the strongest part of the system. The stateless document model is the right architecture — it survives agent crashes, process restarts, and model swaps without losing state. The token-budgeted slot system is thoughtful. The only gap is that `truncatedSlots` feedback requires the receiving agent to proactively fetch the full file, which depends on the agent model doing the right thing unprompted.

**PRD needed? No** — optionally, add a `full_context_url` field to the handoff payload pointing to the REST endpoint for each truncated slot so the agent can self-heal without guessing paths.

---

## 4. How many parallel streams of work can you have? Will each ticket use its own git worktree?

**Today's answer**

**Yes, each ChangeSet gets its own isolated git worktree.** When you call `create_change_set`, `WorktreeManager` runs:

```bash
git worktree add -b feat/TSK-NNNNNN .work/worktrees/TSK-NNNNNN <targetBranch>
```

This is a real, independent working directory on disk. Agents working on TSK-000001 never touch the files of TSK-000002 — they're in separate directories on separate branches.

**There is no hardcoded cap on parallel ChangeSets.** You can have N active ChangeSets simultaneously, each with:
- Its own git worktree and branch (`feat/TSK-NNNNNN`)
- Its own FSM state (draft → planned → implementing → reviewing → approved → merged)
- Its own check runs, decisions log, review comments
- Its own agent session assignment (or shared sessions across ChangeSets if capacity allows)

Practical limits in the current implementation:
- **Disk**: each worktree is a full copy of the working tree
- **Git**: `git worktree list` shows overhead at hundreds of worktrees; practical sweet spot is 10–30 concurrent
- **Agent processes**: if you rely on Mode A (on-demand spawn), N active implementing steps = N simultaneous `claude -p` processes = N parallel API calls → watch rate limits
- **SQLite**: single-writer; high concurrency of FSM transitions will queue. Fine for 10–20 parallel streams; a concern at 100+

**Harsh verdict**

The worktree-per-ticket model is excellent and well-implemented. The path traversal guard in `WorktreeManager` (validating `TSK_NNNNNN` format and relative path) is a nice safety detail. The missing piece is a "max concurrent worktrees" config with a queue — today if you create 50 ChangeSets simultaneously you get 50 git worktrees created immediately with no backpressure.

**PRD needed? No** (for core functionality) — optionally add a `max_concurrent_worktrees` config with a ready queue.

---

## 5. Is the branch/git worktree how work gets handed off between steps? Can you show a working example?

**Today's answer**

Yes. The worktree **is** the shared workspace between steps. Each agent working on a ChangeSet checks out and commits to the same `feat/TSK-NNNNNN` branch in `.work/worktrees/TSK-NNNNNN`. The handoff context includes the live git diff from that branch, so the next agent picks up exactly where the last one left off.

**Working example: `draft → implementing → reviewing → approved`**

```
# Step 1: Create a ChangeSet (spawns worktree + branch)
create_change_set({
  title: "Add rate limiting to POST /api/users",
  taskId: "TSK-000001",
  targetBranch: "main"
})
→ {
    changeSetId: "CS-000001",
    worktreePath: ".work/worktrees/TSK-000001",
    branch: "feat/TSK-000001",
    state: "draft"
  }

# Step 2: Implementer claims the task and does the work
# (agent-handoff reads get_handoff_context, sees spec + empty diff)
# Agent writes code in .work/worktrees/TSK-000001/
# Agent commits: "feat(TSK-000001): add rate-limit middleware"

# Step 3: Submit for review
submit_for_review({ changeSetId: "CS-000001" })
→ { state: "reviewing" }

# Step 4: Reviewer picks it up
get_handoff_context({ changeSetId: "CS-000001", role: "reviewer" })
→ {
    taskSpec: "Add rate limiting to POST /api/users...",
    diff: "diff --git a/src/middleware/rate-limit.ts ...\n+++ 47 lines added",
    acceptanceCriteria: "- 429 returned after 10 req/min\n- Header X-RateLimit-Remaining present",
    blockingComments: "[no blocking comments]",
    architectureContext: "Use in-memory sliding window. Redis optional..."
  }

# Reviewer finds an issue
add_review_comment({
  changeSetId: "CS-000001",
  body: "Sliding window state is not reset on server restart — use Redis or document the limitation",
  filePath: "src/middleware/rate-limit.ts",
  lineNumber: 23,
  severity: "blocking"
})
request_changes({ changeSetId: "CS-000001" })
→ { state: "changes_requested" }

# Step 5: Fixer picks it up — sees the blocking comment in handoff context
get_handoff_context({ changeSetId: "CS-000001", role: "fixer" })
→ {
    blockingComments: "- [blocking src/middleware/rate-limit.ts:23] Sliding window state not reset on restart...",
    diff: "... (includes implementer's work)"
  }
# Fixer commits fix to same branch feat/TSK-000001

# Step 6: Re-review passes, HITL approval gate
submit_for_review({ changeSetId: "CS-000001" })
approve_change_set({ changeSetId: "CS-000001" })   # requires human (HITL gate)
→ { state: "approved" }

# Step 7: Merge (HITL gate)
# After merge: worktree at .work/worktrees/TSK-000001 can be torn down
```

The key: every step operates on the same `.work/worktrees/TSK-000001` directory. The diff grows as agents commit. Each handoff context shows the cumulative diff, so later agents see full history of changes — not just the last commit.

**Harsh verdict**

This is the best-designed part of the system. The git worktree model gives you true isolation, commit history per ticket, and a natural handoff mechanism. The example above works today. One rough edge: `merge` is a manual step — there's no auto-merge into main after approval, you do it yourself.

**PRD needed? No** — this works well.

---

## 6. How does this provide auditability? Is there signed proof of test results and build provenance?

**Today's answer**

**What exists today — a real audit trail, but not cryptographically verified:**

| Artifact | Location | What it records |
|----------|----------|----------------|
| Decision log | `.work/tasks/{id}/decisions.jsonl` | Every `log_decision` call: topic, options considered, choice, rationale, `author_agent`, timestamp |
| Check runs | SQLite `check_runs` table | Per-ChangeSet: typecheck / lint / test / security — status, exit code, full output, timestamps |
| Handoff event log | `.logs/handoffs/{date}.jsonl` | Every handoff: agent, job ID, status, exit code, files changed, diff summary |
| HITL gates | Enforced by FSM | `approve` and `merge` transitions require a human to call the tool explicitly — cannot be bypassed by automation |
| FSM transition log | SQLite `change_sets` table | State history: who called what trigger at what time |
| Review comments | SQLite `review_comments` table | Every blocking/advisory/nit comment attached to a ChangeSet |

**Example decisions.jsonl entry:**
```jsonl
{"id":"DEC-000042","task_id":"TSK-000001","change_set_id":"CS-000001","topic":"Rate limit storage backend","options_considered":["in-memory","Redis","Valkey"],"choice":"in-memory","rationale":"Redis not available in dev; documented limitation acceptable for MVP","sources_cited":null,"author_agent":"claude-code","ts":"2026-05-08T14:32:11.000Z"}
```

**What exists today — content-addressed check runs and a Merkle-chained handoff log (Phase 1 + Phase 3):**

| Artifact | Location | Tamper detection |
|----------|----------|-----------------|
| Check run hashes | SQLite `check_runs.output_sha256` | SHA-256 of output, recomputable from stored data |
| Check run commit | SQLite `check_runs.subject_commit` | git HEAD SHA at time of run |
| Handoff Merkle chain | `.logs/handoffs/{date}.jsonl` | Each entry hashes its predecessor; tampering with any entry (except the current tail) is detectable immediately. Tail-entry edits become detectable when the next entry is written. |
| Decision log | `.work/tasks/{id}/decisions.jsonl` | Append-only by convention |
| HITL gates | Enforced by FSM | `approve` and `merge` require explicit human call |

**Verifying the audit trail:**

```bash
# Verify everything (all check run hashes + all handoff log chains)
bun run verify-provenance

# Verify all provenance for task TSK-000001 check runs (full handoff chain is always verified)
bun run verify-provenance TSK-000001
```

Note: when a task ID is supplied, check run verification is scoped to that task, but the full handoff Merkle chain is always verified in its entirety.

Output example:
```
=== Check Runs ===
✓ chk_000001  typecheck  passed  sha256:e3b0c44298fc... matches
✓ chk_000002  lint       passed  sha256:abc12345678... matches

=== Handoff Merkle Chain (2026-05-08.jsonl) ===
✓ line-1  <uuid>  chain start (no prev)
✓ line-2  <uuid>  chain valid
✓ line-3  <uuid>  chain valid

RESULT: PASS
```

If any entry in a handoff log file is edited (except possibly the current tail, which has no successor yet), `verify-provenance` will detect the chain break and exit 1. Tail-entry edits become detectable when the next entry is written.

**Note:** Verification is most reliable on rotated daily log files (previous days). Today's active file is still being written to, so the tail may be incomplete while a write is in progress. Writes are serialized per log path via an in-process mutex, so both sequential and concurrent production writes produce a valid chain. If you run `verify-provenance` on today's file mid-write you may see one incomplete tail entry, which is normal — re-run after the write completes and the chain will be intact.

**What does NOT exist:**
- No cryptographic signing of any artifact (ed25519 signatures are deferred to Phase 2)
- No SLSA attestation (no in-toto link metadata, no provenance predicate)
- No SBOM generation
- The audit trail is append-only by **convention**, not by enforcement — a sufficiently privileged process can edit `.jsonl` files or the SQLite database
- No signed document you could hand to a compliance officer as tamper-evident proof

**Harsh verdict**

The content-addressing and Merkle chain provide tamper-detection: any in-place edit to a log file or check run output will be caught by `bun run verify-provenance` — *unless* the attacker also has write access to the SQLite DB and recomputes the affected hashes. For tamper-evidence against a local-write attacker, ed25519 signing (Phase 2, deferred) is required. But this is not a cryptographic proof — a sophisticated attacker with write access to both the log files and the SQLite DB could regenerate consistent hashes. The next step is ed25519 signing of each entry (Phase 2, deferred) and optionally Sigstore Rekor upload (Phase 7, deferred).

**PRD needed? Partially addressed — remaining gaps:**

1. **Ed25519 signing** (Phase 2, deferred): Sign each check run attestation and handoff entry with a local key pair so tampering cannot regenerate valid signatures even with DB access.
2. **ChangeSet provenance bundle** (Phase 4, deferred): At merge time, collect all check run attestations + decisions.jsonl + HITL approval record into a signed bundle.
3. **Export to GitHub** (Phase 6/7, deferred): Attach provenance bundle as a GitHub release asset or push to Sigstore's Rekor transparency log.
