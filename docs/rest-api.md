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
- Requests from localhost UI origins (ports 5173–5182) are always exempt

### Curl examples — with auth

Add `-H "Authorization: Bearer $API_TOKEN"` to every request:

```bash
curl -s http://localhost:4000/api/health
# {"ok":true,"ts":"..."}  — health is always exempt

curl -s -X POST http://localhost:4000/api/change-sets \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $API_TOKEN" \
  -d '{"title":"Add rate limiting","taskId":"TSK_000001","targetBranch":"main"}'
```

### Curl examples — without auth (API_TOKEN unset)

```bash
curl -s http://localhost:4000/api/health

curl -s -X POST http://localhost:4000/api/change-sets \
  -H "Content-Type: application/json" \
  -d '{"title":"Add rate limiting","taskId":"TSK_000001","targetBranch":"main"}'
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

#### `POST /api/change-sets`

Create a new ChangeSet. Spawns a git worktree on the target branch.

**Request body:**
```json
{
  "title": "string (required)",
  "taskId": "TSK_NNNNNN (required)",
  "targetBranch": "string (default: main)",
  "specContent": "string (optional — task specification markdown)"
}
```

**Response:** `201 Created`
```json
{
  "id": "chg_000001",
  "task_id": "TSK_000001",
  "title": "Add rate limiting",
  "status": "draft",
  "worktree_path": ".work/worktrees/TSK_000001",
  "branch": "feat/TSK_000001",
  "created_at": "2026-05-08T14:00:00.000Z"
}
```

```bash
curl -s -X POST http://localhost:4000/api/change-sets \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $API_TOKEN" \
  -d '{
    "title": "Add rate limiting to POST /api/users",
    "taskId": "TSK_000001",
    "targetBranch": "main"
  }'
```

#### `GET /api/change-sets`

List all ChangeSets. Optionally filter by status.

```bash
# All ChangeSets
curl -s http://localhost:4000/api/change-sets \
  -H "Authorization: Bearer $API_TOKEN"

# Only reviewing
curl -s "http://localhost:4000/api/change-sets?status=reviewing" \
  -H "Authorization: Bearer $API_TOKEN"
```

#### `GET /api/change-sets/:id`

Get a single ChangeSet by ID.

```bash
curl -s http://localhost:4000/api/change-sets/chg_000001 \
  -H "Authorization: Bearer $API_TOKEN"
```

#### `PATCH /api/change-sets/:id/status`

Advance the ChangeSet FSM via a named trigger. Returns the updated ChangeSet, or `202 Accepted` with an `approvalId` when the transition hits a HITL gate.

**Request body (FSM trigger — preferred):**
```json
{ "trigger": "start_implementation" }
```

Available triggers depend on the current FSM state. Common ones:

| Trigger | From state | To state |
|---------|-----------|---------|
| `start_implementation` | `draft` | `implementing` |
| `submit_for_review` | `implementing` | `reviewing` |
| `request_changes` | `reviewing` | `changes_requested` |
| `approve` | `reviewing` | `approved` (HITL gate — returns 202) |
| `merge` | `approved` | `merged` (HITL gate) |

```bash
# Submit for review
curl -s -X PATCH http://localhost:4000/api/change-sets/chg_000001/status \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $API_TOKEN" \
  -d '{"trigger":"submit_for_review"}'

# Approve (HITL — returns 202 + approvalId)
curl -s -X PATCH http://localhost:4000/api/change-sets/chg_000001/status \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $API_TOKEN" \
  -d '{"trigger":"approve"}'
# Response: {"status":"awaiting_human_approval","approvalId":"<uuid>"}
```

---

### Tasks

A **Task** is a unit of queued work dispatched to an agent session.

#### `POST /api/tasks`

Queue a task for an agent to pick up.

**Request body:**
```json
{
  "changeSetId": "chg_000001 (required)",
  "role": "implementer (required)",
  "prompt": "Implement the feature as specified (optional)"
}
```

**Response:** `201 Created`
```json
{
  "id": "TSK_000001",
  "change_set_id": "chg_000001",
  "role": "implementer",
  "status": "queued",
  "created_at": "2026-05-08T14:00:00.000Z"
}
```

```bash
curl -s -X POST http://localhost:4000/api/tasks \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $API_TOKEN" \
  -d '{
    "changeSetId": "chg_000001",
    "role": "implementer"
  }'
```

#### `GET /api/tasks/:id`

Poll the status of a task. Use this to check whether an agent has completed work.

**Response:**
```json
{
  "id": "TSK_000001",
  "change_set_id": "chg_000001",
  "role": "implementer",
  "status": "completed",
  "created_at": "2026-05-08T14:00:00.000Z",
  "completed_at": "2026-05-08T14:05:00.000Z"
}
```

Status values: `queued`, `running`, `completed`, `failed`

```bash
# Poll until completed
curl -s http://localhost:4000/api/tasks/TSK_000001 \
  -H "Authorization: Bearer $API_TOKEN"
```

---

### HITL Approvals

When a FSM transition hits a HITL gate, the response includes an `approvalId`. Use this to approve or reject the gate.

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

```bash
curl -s -X POST "http://localhost:4000/api/approvals/$APPROVAL_ID/reject" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $API_TOKEN" \
  -d '{"reason":"Not ready for merge","decided_by":"openclaw-skill"}'
```

---

## Typical OpenClaw skill workflow

```bash
# 1. Create a ChangeSet
CS=$(curl -s -X POST http://localhost:4000/api/change-sets \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $API_TOKEN" \
  -d '{"title":"Add feature X","taskId":"TSK_000042","targetBranch":"main"}' \
  | jq -r '.id')

# 2. Queue a task
TASK=$(curl -s -X POST http://localhost:4000/api/tasks \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $API_TOKEN" \
  -d "{\"changeSetId\":\"$CS\",\"role\":\"implementer\"}" \
  | jq -r '.id')

# 3. Poll until completed
while true; do
  STATUS=$(curl -s "http://localhost:4000/api/tasks/$TASK" \
    -H "Authorization: Bearer $API_TOKEN" | jq -r '.status')
  [ "$STATUS" = "completed" ] && break
  [ "$STATUS" = "failed" ] && echo "Task failed" && exit 1
  sleep 5
done

# 4. Submit for review
curl -s -X PATCH "http://localhost:4000/api/change-sets/$CS/status" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $API_TOKEN" \
  -d '{"trigger":"submit_for_review"}'
```

---

## Server-Sent Events

For real-time updates instead of polling, subscribe to the SSE stream:

```bash
curl -s -N http://localhost:4000/api/events \
  -H "Authorization: Bearer $API_TOKEN"
```

Events emitted: `task_created`, `task_updated`, `change_set_created`, `change_set_updated`, `approval_created`, `approval_decided`.
