# OpenClaw Skill: agent-handoff

This directory contains an OpenClaw skill plugin that integrates agent-handoff with OpenClaw's multi-agent automation system.

## What this skill does

Allows OpenClaw to create and manage agent-handoff development workflows over HTTP. OpenClaw can:
- Create ChangeSets (one per task, each gets its own git worktree)
- Queue tasks for AI agent sessions (implementer, reviewer, planner, etc.)
- Poll task status until completion
- Advance the FSM state machine (submit for review, request changes, approve)
- Handle HITL (human-in-the-loop) approval gates

## Prerequisites

- agent-handoff running locally (`bun run src/api/server.ts`)
- OpenClaw with skill plugin support
- `jq` (for the example shell commands)

## Setup

### 1. Start agent-handoff with a token

```bash
export API_TOKEN=your-secret-token
bun run src/api/server.ts
```

### 2. Register the skill in OpenClaw

In OpenClaw's skill settings, add a new skill from file and point it to `skill.json` in this directory. Set the bearer token:

```
Skill name: agent-handoff
Token (AGENT_HANDOFF_TOKEN): your-secret-token
```

OpenClaw will send `Authorization: Bearer your-secret-token` on every request.

### 3. (Optional) Run without auth for local development

If `API_TOKEN` is not set, agent-handoff accepts all requests without auth:

```bash
bun run src/api/server.ts
```

Remove the `auth` block from `skill.json` or leave the token blank in OpenClaw's skill settings.

## Example: Full implementation workflow

This example shows OpenClaw coordinating a full feature implementation cycle:

```bash
BASE="http://localhost:4000"
TOKEN="your-secret-token"
AUTH=(-H "Authorization: Bearer $TOKEN")

# 1. Create a ChangeSet
RESPONSE=$(curl -s -X POST "$BASE/api/change-sets" \
  "${AUTH[@]}" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Add dark mode toggle",
    "taskId": "TSK_000099",
    "targetBranch": "main",
    "specContent": "Add a dark/light mode toggle to the settings page. Store preference in localStorage."
  }')
CS_ID=$(echo "$RESPONSE" | jq -r '.id')
echo "Created ChangeSet: $CS_ID"

# 2. Queue the implementer
TASK_RESPONSE=$(curl -s -X POST "$BASE/api/tasks" \
  "${AUTH[@]}" \
  -H "Content-Type: application/json" \
  -d "{\"changeSetId\":\"$CS_ID\",\"role\":\"implementer\"}")
TASK_ID=$(echo "$TASK_RESPONSE" | jq -r '.id')
echo "Queued task: $TASK_ID"

# 3. Poll until the implementer finishes
while true; do
  STATUS=$(curl -s "$BASE/api/tasks/$TASK_ID" "${AUTH[@]}" | jq -r '.status')
  echo "Task status: $STATUS"
  [ "$STATUS" = "completed" ] && break
  [ "$STATUS" = "failed" ] && echo "Implementation failed" && exit 1
  sleep 10
done

# 4. Submit for review
curl -s -X PATCH "$BASE/api/change-sets/$CS_ID/status" \
  "${AUTH[@]}" \
  -H "Content-Type: application/json" \
  -d '{"trigger":"submit_for_review"}'

# 5. Queue the reviewer
REVIEW_TASK=$(curl -s -X POST "$BASE/api/tasks" \
  "${AUTH[@]}" \
  -H "Content-Type: application/json" \
  -d "{\"changeSetId\":\"$CS_ID\",\"role\":\"reviewer\"}" | jq -r '.id')

# Poll reviewer
while true; do
  STATUS=$(curl -s "$BASE/api/tasks/$REVIEW_TASK" "${AUTH[@]}" | jq -r '.status')
  [ "$STATUS" = "completed" ] && break
  [ "$STATUS" = "failed" ] && exit 1
  sleep 10
done

# 6. Trigger HITL approval gate (requires human decision)
APPROVAL_RESPONSE=$(curl -s -X PATCH "$BASE/api/change-sets/$CS_ID/status" \
  "${AUTH[@]}" \
  -H "Content-Type: application/json" \
  -d '{"trigger":"approve"}')
APPROVAL_ID=$(echo "$APPROVAL_RESPONSE" | jq -r '.approvalId')

echo "Waiting for human approval... approvalId=$APPROVAL_ID"
echo "To approve: curl -s -X POST $BASE/api/approvals/$APPROVAL_ID/approve -H 'Content-Type: application/json' -d '{\"decided_by\":\"human\"}'"
```

## Skill endpoints

See `skill.json` for the full endpoint schema. Key operations:

| Skill endpoint | HTTP call |
|----------------|-----------|
| `health_check` | `GET /api/health` |
| `create_change_set` | `POST /api/change-sets` |
| `queue_task` | `POST /api/tasks` |
| `poll_task` | `GET /api/tasks/{id}` |
| `transition_change_set` | `PATCH /api/change-sets/{id}/status` |
| `approve_hitl_gate` | `POST /api/approvals/{approvalId}/approve` |

## Further reading

- Full REST API documentation: [`docs/rest-api.md`](../../docs/rest-api.md)
- agent-handoff FAQ: [`docs/faq.md`](../../docs/faq.md) — Q1 covers OpenClaw integration
- agent-handoff README: [`README.md`](../../README.md)
