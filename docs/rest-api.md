# agent-handoff REST API

The agent-handoff server exposes a REST API at `http://localhost:4000` (default port). This is the integration surface for non-MCP orchestrators such as OpenClaw, custom scripts, or any HTTP client.

## Authentication

By default the API requires **no auth** — it is designed for local use by the UI and MCP tools. To secure the API for external callers, set the `API_TOKEN` environment variable.

### Setup

```bash
export API_TOKEN=your-secret-token
bun run src/api/server.ts
```

When `API_TOKEN` is set:
- All requests must include `Authorization: Bearer <token>`
- Requests missing the header or with a wrong token receive `401 Unauthorized`
- `GET /api/health` is always exempt
- Requests from the Vite UI dev-server (localhost ports 5173–5182) are always exempt

> **Note:** Origin-based exemption is bypassable by non-browser clients that can send arbitrary `Origin` headers. This is a known trade-off for a local dev tool — for production use, require the token on all callers.

### Curl examples — with auth

Add `-H "Authorization: Bearer $API_TOKEN"` to every request:

```bash
curl -s http://localhost:4000/api/health
# {"ok":true,"ts":"..."}  — health is always exempt

curl -s http://localhost:4000/api/change-sets \
  -H "Authorization: Bearer $API_TOKEN"
```

### Curl examples — without auth (API_TOKEN unset)

```bash
curl -s http://localhost:4000/api/health

curl -s http://localhost:4000/api/change-sets
```

---

## Endpoints

### Health

#### `GET /api/health`

Always returns 200. No auth required.

```bash
curl -s http://localhost:4000/api/health
# {"ok":true,"ts":"2026-05-08T14:00:00.000Z"}
```

---

### ChangeSets

A **ChangeSet** is the unit of work — one task, one git worktree, one FSM lifecycle.

#### `POST /api/change-sets/quick-create`

Create a new ChangeSet with auto-generated IDs, branch name, and worktree path. This is the recommended endpoint for external orchestrators — you only need to supply a title.

**Request body:**
```json
{
  "title": "string (required)",
  "description": "string (optional)"
}
```

**Response:** `201 Created`
```json
{
  "id": "chg_000001",
  "task_id": "TSK_000001",
  "title": "Add rate limiting",
  "description": "",
  "status": "draft",
  "source_branch": "feat/tsk-000001",
  "target_branch": "main",
  "worktree_path": ".work/worktrees/TSK_000001",
  "created_at": "2026-05-08T14:00:00.000Z"
}
```

```bash
curl -s -X POST http://localhost:4000/api/change-sets/quick-create \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $API_TOKEN" \
  -d '{"title":"Add rate limiting to POST /api/users"}'
```

#### `GET /api/change-sets`

List all ChangeSets.

```bash
curl -s http://localhost:4000/api/change-sets \
  -H "Authorization: Bearer $API_TOKEN"
```

#### `GET /api/change-sets/:id`

Get a single ChangeSet by ID. Use this to poll for FSM state changes.

```bash
curl -s http://localhost:4000/api/change-sets/chg_000001 \
  -H "Authorization: Bearer $API_TOKEN"
```

#### `PATCH /api/change-sets/:id/status`

Advance the ChangeSet FSM via a named trigger. Returns the updated ChangeSet, or `202 Accepted` with an `approvalId` when the transition hits a HITL gate.

**Request body:**
```json
{ "trigger": "plan_accepted" }
```

All FSM triggers:

| Trigger | From state | To state |
|---------|-----------|---------|
| `plan_accepted` | `draft` | `planned` |
| `assign_implementer` | `planned` | `implementing` |
| `submit_for_review` | `implementing` | `reviewing` |
| `request_changes` | `reviewing` | `changes_requested` |
| `approve` | `reviewing` | `approved` (HITL gate — returns 202) |
| `pick_up_revision` | `changes_requested` | `implementing` |
| `merge` | `approved` | `merged` (HITL gate) |
| `merge_conflict_detected` | `approved` | `conflict_detected` |
| `conflict_reopen` | `conflict_detected` | `implementing` |
| `conflict_resolved` | `conflict_detected` | `reviewing` |
| `abandon` | any | `abandoned` |

```bash
# Advance to planned
curl -s -X PATCH http://localhost:4000/api/change-sets/chg_000001/status \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $API_TOKEN" \
  -d '{"trigger":"plan_accepted"}'

# Approve (HITL — returns 202 + approvalId)
curl -s -X PATCH http://localhost:4000/api/change-sets/chg_000001/status \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $API_TOKEN" \
  -d '{"trigger":"approve"}'
# Response: {"status":"awaiting_human_approval","approvalId":"<uuid>"}
```

---

### Tasks

A **Task** is a DB record representing a unit of structured work within a ChangeSet. Tasks have required filesystem paths (spec file, acceptance criteria file) and are typically created by the internal SDLC flow. External orchestrators should drive work via FSM transitions on the ChangeSet rather than creating tasks directly.

#### `POST /api/tasks`

Create a task record. All path fields must refer to files that already exist in the worktree.

**Request body:**
```json
{
  "change_set_id": "chg_000001",
  "title": "Implement rate limiting",
  "spec_path": ".work/tasks/TSK_000001/spec.md",
  "acceptance_path": ".work/tasks/TSK_000001/acceptance.md",
  "plan_path": ".work/tasks/TSK_000001/plan.md",
  "assigned_agent": "claude-code",
  "agent_role": "implementer"
}
```

**Required fields:** `change_set_id`, `title`, `spec_path`, `acceptance_path`
**Optional:** `plan_path`, `assigned_agent`, `agent_role`

**Response:** `201 Created` — Task record with status `backlog`.

#### `GET /api/tasks/:id`

Get a task by ID. Task statuses: `backlog`, `in_progress`, `done`, `blocked`.

```bash
curl -s http://localhost:4000/api/tasks/TSK_000001 \
  -H "Authorization: Bearer $API_TOKEN"
```

---

### HITL Approvals

When a FSM transition hits a HITL gate, the `PATCH /api/change-sets/:id/status` response includes an `approvalId`. Use this to approve or reject the gate.

#### `POST /api/approvals/:approvalId/approve`

Approve a pending HITL gate.

```bash
# First, trigger the approve transition to get approvalId
APPROVAL_ID=$(curl -s -X PATCH http://localhost:4000/api/change-sets/chg_000001/status \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $API_TOKEN" \
  -d '{"trigger":"approve"}' | jq -r '.approvalId')

# Then approve it
curl -s -X POST "http://localhost:4000/api/approvals/$APPROVAL_ID/approve" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $API_TOKEN" \
  -d '{"decided_by":"openclaw-skill"}'
# Response: {"approvalId":"<uuid>","decision":"approved","newStatus":"approved"}
```

#### `POST /api/approvals/:approvalId/reject`

Reject a pending HITL gate.

**Request body:**
```json
{
  "reason": "string (required)",
  "decided_by": "string (optional)"
}
```

> **Note:** `reason` is required. The server returns `400 Bad Request` if it is omitted.

```bash
curl -s -X POST "http://localhost:4000/api/approvals/$APPROVAL_ID/reject" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $API_TOKEN" \
  -d '{"reason":"Not ready for merge","decided_by":"openclaw-skill"}'
```

---

## Typical external orchestrator workflow

```bash
# 1. Create a ChangeSet (auto-generates task ID, branch, worktree path)
CS=$(curl -s -X POST http://localhost:4000/api/change-sets/quick-create \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $API_TOKEN" \
  -d '{"title":"Add feature X"}' \
  | jq -r '.id')

# 2. Advance through FSM states
curl -s -X PATCH "http://localhost:4000/api/change-sets/$CS/status" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $API_TOKEN" \
  -d '{"trigger":"plan_accepted"}'

# 3. Poll state until work is complete
while true; do
  STATUS=$(curl -s "http://localhost:4000/api/change-sets/$CS" \
    -H "Authorization: Bearer $API_TOKEN" | jq -r '.status')
  [ "$STATUS" = "reviewing" ] && break
  [ "$STATUS" = "abandoned" ] && echo "Abandoned" && exit 1
  sleep 5
done

# 4. Trigger approve (HITL gate — returns approvalId)
APPROVAL_ID=$(curl -s -X PATCH "http://localhost:4000/api/change-sets/$CS/status" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $API_TOKEN" \
  -d '{"trigger":"approve"}' | jq -r '.approvalId')

# 5. Approve it
curl -s -X POST "http://localhost:4000/api/approvals/$APPROVAL_ID/approve" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $API_TOKEN" \
  -d '{"decided_by":"openclaw-skill"}'
```

---

## Server-Sent Events

For real-time updates instead of polling, subscribe to the SSE stream:

```bash
curl -s -N http://localhost:4000/events/stream \
  -H "Authorization: Bearer $API_TOKEN"
```

Events emitted: `task_created`, `task_updated`, `change_set_created`, `change_set_updated`, `approval_created`, `approval_decided`.
