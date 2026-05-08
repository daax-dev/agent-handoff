# OpenClaw Skill: agent-handoff

This directory contains an OpenClaw skill plugin that integrates agent-handoff with OpenClaw's multi-agent automation system.

## What this skill does

Allows OpenClaw to create and manage agent-handoff development workflows over HTTP. OpenClaw can:
- Create ChangeSets (one per task, each auto-generates its own git worktree)
- Advance the FSM state machine (plan_accepted, submit_for_review, approve, merge)
- Handle HITL (human-in-the-loop) approval gates
- Poll ChangeSet status until a desired state is reached

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

This example shows OpenClaw coordinating a full feature implementation cycle via FSM state transitions:

```bash
BASE="http://localhost:4000"
TOKEN="your-secret-token"
AUTH=(-H "Authorization: Bearer $TOKEN")

# 1. Create a ChangeSet (auto-generates task ID, branch, worktree path)
RESPONSE=$(curl -s -X POST "$BASE/api/change-sets/quick-create" \
  "${AUTH[@]}" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Add dark mode toggle",
    "description": "Add a dark/light mode toggle to the settings page. Store preference in localStorage."
  }')
CS_ID=$(echo "$RESPONSE" | jq -r '.id')
echo "Created ChangeSet: $CS_ID"

# 2. Advance to planned state (agents pick up work from here)
curl -s -X PATCH "$BASE/api/change-sets/$CS_ID/status" \
  "${AUTH[@]}" \
  -H "Content-Type: application/json" \
  -d '{"trigger":"plan_accepted"}'

# 3. Poll until ChangeSet reaches reviewing state
while true; do
  STATUS=$(curl -s "$BASE/api/change-sets/$CS_ID" "${AUTH[@]}" | jq -r '.status')
  echo "ChangeSet status: $STATUS"
  [ "$STATUS" = "reviewing" ] && break
  [ "$STATUS" = "abandoned" ] && echo "ChangeSet abandoned" && exit 1
  sleep 10
done

# 4. Trigger HITL approval gate (returns 202 + approvalId)
APPROVAL_RESPONSE=$(curl -s -X PATCH "$BASE/api/change-sets/$CS_ID/status" \
  "${AUTH[@]}" \
  -H "Content-Type: application/json" \
  -d '{"trigger":"approve"}')
APPROVAL_ID=$(echo "$APPROVAL_RESPONSE" | jq -r '.approvalId')

echo "Waiting for human approval... approvalId=$APPROVAL_ID"
echo "To approve: curl -s -X POST $BASE/api/approvals/$APPROVAL_ID/approve -H 'Content-Type: application/json' -d '{\"decided_by\":\"human\"}'"

# 5. Approve the gate
curl -s -X POST "$BASE/api/approvals/$APPROVAL_ID/approve" \
  "${AUTH[@]}" \
  -H "Content-Type: application/json" \
  -d '{"decided_by":"openclaw-skill"}'

echo "Approved — ChangeSet is now in approved state, ready for merge."
```

## Skill endpoints

See `skill.json` for the full endpoint schema. Key operations:

| Skill endpoint | HTTP call |
|----------------|-----------|
| `health_check` | `GET /api/health` |
| `create_change_set` | `POST /api/change-sets/quick-create` |
| `get_change_set` | `GET /api/change-sets/{id}` |
| `advance_fsm` | `PATCH /api/change-sets/{id}/status` |
| `approve_hitl_gate` | `POST /api/approvals/{approvalId}/approve` |
| `reject_hitl_gate` | `POST /api/approvals/{approvalId}/reject` |

## Further reading

- Full REST API documentation: [`docs/rest-api.md`](../../docs/rest-api.md)
- agent-handoff FAQ: [`docs/faq.md`](../../docs/faq.md) — Q1 covers OpenClaw integration
- agent-handoff README: [`README.md`](../../README.md)
