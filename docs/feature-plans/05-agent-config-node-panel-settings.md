# Feature Plan 05: Agent Config — Node Panel + Settings Page

## Status: Ready to build

## Acceptance criteria

1. Click any FSM state node → side panel opens showing all roles assigned to that state,
   with inline edits for tool, model, prompt override, and MCPs.
2. Toggle mode (Changeset ↔ GSD) → node-click flow works identically for GSD states.
3. Settings page (daax-style, tabbed) gives a full-page overview and edit surface for all
   agent assignments, with the active mode scoping which state rows are shown.
4. Each assignment row carries enough config for the runtime to spawn the right agent
   automatically when the FSM enters that state.

---

## Dependency order

```
Phase 1 — Schema + seed
Phase 2 — API
Phase 3 — Node panel (FSMNode click)
Phase 4 — Settings page redesign
```

Each phase is independently deployable and testable.

---

## Phase 1 — Schema extension + GSD seed

### 1a. Migration: extend agent_assignments

New file: `migrations/012_agent_config_extended.sql`

```sql
ALTER TABLE agent_assignments ADD COLUMN model       TEXT;
ALTER TABLE agent_assignments ADD COLUMN prompt_override TEXT;
ALTER TABLE agent_assignments ADD COLUMN mcps        TEXT;        -- JSON array of MCP names
ALTER TABLE agent_assignments ADD COLUMN auto_launch INTEGER NOT NULL DEFAULT 0;
```

- `model`: provider:model string (e.g. `"anthropic:claude-sonnet-4-6"`). NULL = use role default from agent-roles.yaml.
- `prompt_override`: freeform text appended to the role's base prompt template at spawn time. NULL = no override.
- `mcps`: JSON string array of MCP server names to activate for this agent (e.g. `["github", "serena"]`). NULL = defaults.
- `auto_launch`: boolean. 1 = runtime spawns a new agent of this tool when FSM enters this state. 0 = manual only.

### 1b. Migration: seed GSD state assignments

Migration 007 seeded only changeset states. GSD mode states have no rows.

```sql
INSERT OR IGNORE INTO agent_assignments (id, fsm_state, role, tool, enabled, updated_at) VALUES
  ('aa_project_init_researcher',     'project_init',       'researcher',     'claude-code', 1, datetime('now')),
  ('aa_project_init_pm_planner',     'project_init',       'pm_planner',     'claude-code', 1, datetime('now')),
  ('aa_discussing_pm_planner',       'discussing',         'pm_planner',     'claude-code', 1, datetime('now')),
  ('aa_planning_researcher',         'planning',           'researcher',     'claude-code', 1, datetime('now')),
  ('aa_planning_planner',            'planning',           'planner',        'claude-code', 1, datetime('now')),
  ('aa_planning_plan_verifier',      'planning',           'plan_verifier',  'claude-code', 1, datetime('now')),
  ('aa_executing_implementer',       'executing',          'implementer',    'claude-code', 1, datetime('now')),
  ('aa_verifying_verifier',          'verifying',          'verifier',       'claude-code', 1, datetime('now')),
  ('aa_verifying_qa_agent',          'verifying',          'qa_agent',       'claude-code', 1, datetime('now')),
  ('aa_gap_fixing_fixer',            'gap_fixing',         'fixer',          'claude-code', 1, datetime('now')),
  ('aa_shipping_summarizer',         'shipping',           'summarizer',     'claude-code', 1, datetime('now')),
  ('aa_shipping_pr_builder',         'shipping',           'pr_builder',     'claude-code', 1, datetime('now'));
```

---

## Phase 2 — API

### 2a. Domain type update (`src/domain/agent-assignment.ts`)

Add fields to `AgentAssignment`:

```ts
model?:          string | null;
prompt_override?: string | null;
mcps?:           string[] | null;   // parsed from JSON column
auto_launch:     boolean;
```

`listAssignments` and `getAssignment` must parse `mcps` from JSON string → `string[] | null`.
`upsertAssignment` must accept the new fields and serialize `mcps` back to JSON.

### 2b. Route update (`src/api/routes/agent-assignments.ts`)

Extend PUT body to accept optional `model`, `prompt_override`, `mcps`, `auto_launch`.
Validation:
- `model` if present: must be a non-empty string or null
- `mcps` if present: must be an array of strings or null
- `auto_launch` if present: boolean

New endpoint: `GET /api/agent-assignments/by-mode/:mode`

Returns assignments filtered to the states that belong to the given mode.
Uses `GSD_STATE_META` / `CS_STATE_META` key sets (import from fsm module) to filter.

---

## Phase 3 — Node panel (FSM diagram click)

### What opens

Clicking a state node opens a `NodePanel` (right side panel, mirrors `TransitionPanel`).
It shows all `agent_assignments` rows where `fsm_state === node.id`.

### NodePanel fields per assignment row

| Field | UI element | Notes |
|---|---|---|
| Role | read-only label | e.g. `implementer` |
| Tool | dropdown | same AgentTool list as today |
| Model | dropdown | grouped by provider (see model catalogue below) |
| Auto-launch | toggle | fires spawn on FSM enter |
| Prompt override | expandable textarea | appended to base template |
| MCPs | tag input | free-form MCP server names |
| Enabled | checkbox | |

**Save**: saves all rows for this state in one PUT-per-row batch on click.

### Model catalogue (hardcoded in frontend, same pattern as daax)

```ts
const MODEL_OPTIONS = [
  { group: "Anthropic", options: [
    { value: "anthropic:claude-opus-4-7",    label: "Claude Opus 4.7"  },
    { value: "anthropic:claude-sonnet-4-6",  label: "Claude Sonnet 4.6" },
    { value: "anthropic:claude-haiku-4-5",   label: "Claude Haiku 4.5"  },
  ]},
  { group: "OpenAI", options: [
    { value: "openai:gpt-4o",     label: "GPT-4o"     },
    { value: "openai:o3",         label: "o3"          },
    { value: "openai:o4-mini",    label: "o4-mini"     },
  ]},
  { group: "Google", options: [
    { value: "google:gemini-2.5-pro",   label: "Gemini 2.5 Pro"   },
    { value: "google:gemini-2.5-flash", label: "Gemini 2.5 Flash" },
  ]},
];
```

### Wiring into FlowDiagram.tsx

- `onNodeClick` handler: sets `selectedNodeId` (new state var)
- If `selectedEdgeId` is set and node is clicked: clear edge selection, open node panel
- Both panels cannot be open simultaneously (mutual exclusion)
- `NodePanel` receives `fsmState: string`, loads its own assignments via a new
  `useStateAssignments(fsmState)` hook

### New hook: `ui/src/hooks/useStateAssignments.ts`

```ts
// Fetches assignments for one FSM state. Deps on fsmState prop.
export function useStateAssignments(fsmState: string | null)
export function useUpdateStateAssignments()  // batch update for all rows in a state
```

---

## Phase 4 — Settings page redesign (daax-style)

### Tab structure

```
Workflow | Agents | Sessions
```

| Tab | Content |
|---|---|
| **Workflow** | Mode toggle (Changeset / GSD) with description of each; HITL gates list with on/off toggles per trigger; circuit-breaker threshold display |
| **Agents** | Full `agent_assignments` table scoped to active mode's states; inline tool + model + auto-launch edits; link "Click a node in the diagram to configure prompts and MCPs" |
| **Sessions** | Live agent sessions (existing `SessionStatus` component, unchanged) |

### Component structure

```
ui/src/pages/Settings.tsx            — rewrite to tabbed layout
ui/src/components/settings/
  WorkflowTab.tsx                    — mode toggle card + HITL card
  AgentsTab.tsx                      — assignments table, mode-scoped
  SessionsTab.tsx                    — thin wrapper around SessionStatus
```

### WorkflowTab

Two cards:

**Card 1: Workflow Mode**
- `[ Changeset | GSD ]` pill toggle (same `ModeToggle` component from `FlowDiagram.tsx`)
- Description paragraph per mode explaining what it does
- "Changes take effect immediately and update the FSM diagram."

**Card 2: HITL Gates**
- List of all triggers in `hitlGatedTriggers` for the active mode
- Toggle per trigger (on = HITL gate active, off = auto-advance)
- Saves to `PUT /api/fsm/workflow` on each toggle

### AgentsTab

- `mode`-scoped: only show rows where `fsm_state` is in the active mode's state set
- Columns: State | Role | Tool | Model | Auto-launch | Enabled
- Inline dropdowns (tool, model) with save-on-change (no separate Save button)
- Row with no assignment yet shows "+ Add role" placeholder
- Note at bottom: "Click a state node in the FSM diagram to configure prompt overrides and MCP settings."

---

## Files created / modified

### New
```
migrations/012_agent_config_extended.sql
migrations/013_gsd_default_assignments.sql
ui/src/hooks/useStateAssignments.ts
ui/src/components/workflow-editor/NodePanel.tsx
ui/src/components/settings/WorkflowTab.tsx
ui/src/components/settings/AgentsTab.tsx
ui/src/components/settings/SessionsTab.tsx
```

### Modified
```
src/domain/agent-assignment.ts        — add new fields
src/api/routes/agent-assignments.ts   — extend PUT + add by-mode GET
ui/src/hooks/useAgentAssignments.ts   — include new fields in type
ui/src/pages/FlowDiagram.tsx          — onNodeClick → NodePanel
ui/src/pages/Settings.tsx             — rewrite to tabbed daax-style
```

---

## Deferred (out of scope for this build)

- MCP server registry (names are free-form text blobs; a typed registry is a future feature)
- Prompt template editor (override is appended text; full template editing is future)
- Per-role launch-config system (auto_launch boolean is the v1; full spawn config is future)
- Multi-instance / project-scoped assignments
