# Demo: Pull Mode — Worker Pool

This walkthrough demonstrates agent-handoff's pull mode, where agents register as workers, pick up tasks from a shared queue, and submit results back.

## Prerequisites

- agent-handoff installed and registered in your MCP client
- Multiple MCP client sessions connected to the **same** agent-handoff server instance (or one session acting as both coordinator and worker)

## Scenario: Coordinator + Worker Team

You have a coordinator agent that creates tasks and two worker agents that pick them up.

### Understanding the Setup

Pull mode works within a **single MCP server process**. All clients sharing the same agent-handoff instance share the same job queue and worker registry.

```
┌──────────────┐  ┌──────────────┐  ┌──────────────┐
│ Coordinator  │  │  Worker A    │  │  Worker B    │
│ (Claude Code)│  │ (Claude -p)  │  │ (Cursor)     │
└──────┬───────┘  └──────┬───────┘  └──────┬───────┘
       │                 │                 │
       │    stdio        │    stdio        │    stdio
       │                 │                 │
┌──────▼─────────────────▼─────────────────▼───────┐
│                 agent-handoff server                    │
│  ┌─────────────────────────────────────────────┐  │
│  │  Job Queue: [task1, task2, task3]            │  │
│  │  Workers:   [Worker A (idle), Worker B (idle)] │
│  └─────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────┘
```

> **Note:** Each MCP stdio client spawns its own server process. For a shared queue,
> run agent-handoff as a single persistent process and connect via HTTP/SSE transport,
> or use a single client session that acts as both coordinator and worker.

### Step 1: Workers register

**Worker A** (in a Claude Code session):
```
Register me as a worker named "backend-specialist" with capabilities typescript and database.
Use the register_worker tool.
```

```json
{
  "workerId": "wkr_a1b2c3d4e5f6",
  "name": "backend-specialist",
  "status": "idle",
  "capabilities": ["typescript", "database"]
}
```

**Worker B** (in another session):
```
Register me as a worker named "frontend-specialist" with capabilities react and css.
Use the register_worker tool.
```

```json
{
  "workerId": "wkr_g7h8i9j0k1l2",
  "name": "frontend-specialist",
  "status": "idle",
  "capabilities": ["react", "css"]
}
```

### Step 2: Coordinator queues tasks

The coordinator creates tasks with `pool: true`:

```
Queue these tasks for the worker pool:
1. handoff_task with pool=true, agent=claude, prompt="Refactor the user service to use repository pattern"
2. handoff_task with pool=true, agent=claude, prompt="Add dark mode toggle to the settings page"
3. handoff_task with pool=true, agent=claude, prompt="Write integration tests for the payment flow"
```

Each returns a job ID with `transport: "pool"`:
```json
{ "jobId": "hnd_t1a2s3k4_001", "status": "queued", "transport": "pool" }
{ "jobId": "hnd_t1a2s3k4_002", "status": "queued", "transport": "pool" }
{ "jobId": "hnd_t1a2s3k4_003", "status": "queued", "transport": "pool" }
```

### Step 3: Workers pull tasks

**Worker A** pulls:
```
Pull a task from the queue. My worker ID is wkr_a1b2c3d4e5f6.
```

```json
{
  "available": true,
  "jobId": "hnd_t1a2s3k4_001",
  "prompt": "Refactor the user service to use repository pattern",
  "timeoutMs": 300000
}
```

Worker A now works on the task. **Worker B** pulls next:
```
Pull a task. Worker ID: wkr_g7h8i9j0k1l2.
```

```json
{
  "available": true,
  "jobId": "hnd_t1a2s3k4_002",
  "prompt": "Add dark mode toggle to the settings page",
  "timeoutMs": 300000
}
```

### Step 4: Workers send heartbeats

While working, workers should periodically heartbeat to stay alive:

```
Send a heartbeat. Worker ID: wkr_a1b2c3d4e5f6.
```

```json
{
  "workerId": "wkr_a1b2c3d4e5f6",
  "status": "busy",
  "lastHeartbeatAt": "2026-02-14T12:05:00.000Z"
}
```

Workers go offline after 60 seconds without a heartbeat.

### Step 5: Workers submit results

**Worker A** finishes:
```
Submit my result for job hnd_t1a2s3k4_001. Status: completed.
Output: "Refactored UserService to use UserRepository. Created src/repositories/user-repository.ts.
Updated 4 service methods to use repository pattern. All existing tests still pass."
```

```json
{
  "acknowledged": true,
  "jobId": "hnd_t1a2s3k4_001",
  "workerStatus": "idle"
}
```

Worker A is now idle and can `pull_task` again to get task 3.

### Step 6: Coordinator checks progress

```
List all workers and check status of all three jobs.
```

Workers:
```json
{
  "total": 2,
  "idle": 1,
  "busy": 1,
  "workers": [
    { "name": "backend-specialist", "status": "idle" },
    { "name": "frontend-specialist", "status": "busy", "currentJobId": "hnd_t1a2s3k4_002" }
  ]
}
```

Jobs:
```
hnd_t1a2s3k4_001 → completed
hnd_t1a2s3k4_002 → running
hnd_t1a2s3k4_003 → queued (waiting for a worker)
```

---

## Single-Session Pull Mode

You can also use pull mode within a single Claude Code session for structured task processing:

```
1. Queue 5 tasks with pool=true
2. Register yourself as a worker
3. Pull tasks one at a time
4. Do the work
5. Submit the result
6. Pull the next task
7. Repeat until queue is empty
```

This is useful for batch processing where you want structured tracking and logging of each subtask.

## Script-Based Worker (claude -p)

For automated workers, use `claude -p` in a loop:

```bash
#!/bin/bash
# worker-loop.sh — automated pull-mode worker

# Register
WORKER_ID=$(claude -p "Use register_worker with name='auto-worker-1'. Return only the workerId." --output-format json | jq -r '.result')

while true; do
  # Pull
  TASK=$(claude -p "Use pull_task with workerId='$WORKER_ID'. Return the raw JSON." --output-format json)
  AVAILABLE=$(echo "$TASK" | jq -r '.result' | grep -c '"available": true')

  if [ "$AVAILABLE" -eq 0 ]; then
    echo "No tasks available, sleeping 10s..."
    sleep 10
    continue
  fi

  JOB_ID=$(echo "$TASK" | jq -r '.result' | grep -o '"jobId": "[^"]*"' | cut -d'"' -f4)
  PROMPT=$(echo "$TASK" | jq -r '.result' | grep -o '"prompt": "[^"]*"' | cut -d'"' -f4)

  # Do the work
  RESULT=$(claude -p "$PROMPT" --output-format json | jq -r '.result')

  # Escape RESULT to safely embed in double-quoted prompt
  SAFE_RESULT=${RESULT//\\/\\\\}
  SAFE_RESULT=${SAFE_RESULT//\"/\\\"}
  SAFE_RESULT=${SAFE_RESULT//\$/\\$}
  SAFE_RESULT=${SAFE_RESULT//\`/\\\`}

  # Submit
  claude -p "Use submit_result with workerId='$WORKER_ID', jobId='$JOB_ID', status='completed', output=\"$SAFE_RESULT\""

  # Heartbeat
  claude -p "Use worker_heartbeat with workerId='$WORKER_ID'"
done
```

> **Note:** Each `claude -p` call spawns a separate agent-handoff server instance.
> For a shared queue, you'd need agent-handoff running as a persistent HTTP/SSE server
> (planned for a future version).
