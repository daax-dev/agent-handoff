import { useState } from "react";
import { Trash2, Plus } from "lucide-react";
import {
  useAgentAssignments,
  useUpdateAssignment,
  useDeleteAssignment,
  useCreateAssignment,
} from "@/hooks/useAgentAssignments";
import { useAgentSessions } from "@/hooks/useAgentSessions";
import { TOOL_LABELS, type AgentAssignment, type AgentTool } from "@/types";
import { AGENT_MODEL_MAP } from "@/lib/agent-model-map";
import { AssignmentDrawer } from "./AssignmentDrawer";

// Mode classification — must match backend GSD_STATES / CS_STATES sets
const GSD_STATES = new Set([
  "project_init", "roadmap_ready", "discussing", "planning", "plan_ready",
  "executing", "verifying", "gap_fixing", "shipping", "phase_done",
  "milestone_complete", "escalated",
]);
const CS_STATES = new Set([
  "draft", "planned", "implementing", "reviewing", "changes_requested",
  "approved", "conflict_detected", "merged", "abandoned",
]);

function classifyMode(fsmState: string): "gsd" | "changeset" | "other" {
  if (GSD_STATES.has(fsmState)) return "gsd";
  if (CS_STATES.has(fsmState)) return "changeset";
  return "other";
}

type ModeFilter = "all" | "gsd" | "changeset";

const TOOLS = Object.keys(TOOL_LABELS) as AgentTool[];

const ALL_MODEL_OPTIONS = [
  { group: "Anthropic", options: [
    { value: "anthropic:claude-opus-4-7",           label: "Claude Opus 4.7"   },
    { value: "anthropic:claude-sonnet-4-6",         label: "Claude Sonnet 4.6" },
    { value: "anthropic:claude-haiku-4-5-20251001", label: "Claude Haiku 4.5"  },
  ]},
  { group: "OpenAI", options: [
    { value: "openai:gpt-5.5",       label: "GPT-5.5"       },
    { value: "openai:gpt-5.4",       label: "GPT-5.4"       },
    { value: "openai:gpt-5.4-mini",  label: "GPT-5.4 Mini"  },
    { value: "openai:gpt-5.3-codex", label: "GPT-5.3 Codex" },
    { value: "openai:gpt-5.2",       label: "GPT-5.2"       },
  ]},
  { group: "Google", options: [
    { value: "google:gemini-3-pro-preview",   label: "Gemini 3 Pro (preview)"   },
    { value: "google:gemini-3-flash-preview", label: "Gemini 3 Flash (preview)" },
    { value: "google:gemini-2.5-pro",         label: "Gemini 2.5 Pro"           },
    { value: "google:gemini-2.5-flash",       label: "Gemini 2.5 Flash"         },
    { value: "google:gemini-2.5-flash-lite",  label: "Gemini 2.5 Flash Lite"    },
  ]},
];

function modelOptionsForTool(tool: AgentTool) {
  const entry = AGENT_MODEL_MAP[tool];
  if (entry.modelSelection === "not_applicable") return [];
  const valid = new Set(entry.models);
  return ALL_MODEL_OPTIONS
    .map((g) => ({ ...g, options: g.options.filter((o) => valid.has(o.value)) }))
    .filter((g) => g.options.length > 0);
}

// ── Badge ─────────────────────────────────────────────────────────────────────

function Badge({ value }: { value: string[] | null }) {
  if (value === null)     return <span className="inline-block px-2 py-0.5 rounded text-xs font-mono bg-muted/40 text-muted-foreground">default</span>;
  if (value.length === 0) return <span className="inline-block px-2 py-0.5 rounded text-xs font-mono bg-muted/40 text-muted-foreground">none</span>;
  return <span className="inline-block px-2 py-0.5 rounded text-xs font-mono bg-muted/40 text-foreground font-medium">{value.length}</span>;
}

// ── AssignmentRow ─────────────────────────────────────────────────────────────

interface RowProps {
  assignment: AgentAssignment;
  onOpen: () => void;
}

function AssignmentRow({ assignment: a, onOpen }: RowProps) {
  const update = useUpdateAssignment();
  const del = useDeleteAssignment();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  function flash(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 2000);
  }

  function mutate(patch: Partial<{ tool: AgentTool; model: string | null; auto_launch: boolean; enabled: boolean }>) {
    update.mutate(
      {
        fsmState: a.fsm_state,
        role: a.role,
        tool: patch.tool ?? a.tool,
        enabled: patch.enabled ?? a.enabled,
        model: patch.model !== undefined ? patch.model : a.model,
        prompt_override: a.prompt_override,
        mcps: a.mcps,
        auto_launch: patch.auto_launch ?? a.auto_launch,
        skills: a.skills,
      },
      { onSuccess: () => flash("Saved"), onError: () => flash("Error") }
    );
  }

  function handleDelete() {
    if (!confirmDelete) { setConfirmDelete(true); setTimeout(() => setConfirmDelete(false), 3000); return; }
    del.mutate({ fsmState: a.fsm_state, role: a.role }, { onError: () => flash("Delete failed") });
  }

  return (
    <tr className="border-b hover:bg-accent/20 transition-colors group">
      <td
        className="py-2 px-3 font-mono text-xs text-amber-600 dark:text-amber-400 cursor-pointer"
        onClick={onOpen}
      >
        {a.fsm_state}
      </td>
      <td
        className="py-2 px-3 font-mono text-xs text-muted-foreground cursor-pointer hover:text-foreground hover:underline underline-offset-2"
        onClick={onOpen}
      >
        {a.role}
      </td>
      <td className="py-2 px-3">
        <select
          value={a.tool}
          onChange={(e) => {
            const newTool = e.target.value as AgentTool;
            const isStillValid = AGENT_MODEL_MAP[newTool].models.includes(a.model ?? "");
            mutate({ tool: newTool, model: isStillValid ? a.model : null });
          }}
          disabled={update.isPending}
          className="bg-background border border-border rounded px-2 py-1 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-50"
        >
          {TOOLS.map((t) => (
            <option key={t} value={t}>{TOOL_LABELS[t]}</option>
          ))}
        </select>
      </td>
      <td className="py-2 px-3">
        {AGENT_MODEL_MAP[a.tool].modelSelection === "not_applicable" ? (
          <span className="text-xs text-muted-foreground italic">N/A</span>
        ) : (
          <select
            value={a.model ?? ""}
            onChange={(e) => mutate({ model: e.target.value || null })}
            disabled={update.isPending}
            className="bg-background border border-border rounded px-2 py-1 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-50"
          >
            <option value="">Role default</option>
            {modelOptionsForTool(a.tool).map((g) => (
              <optgroup key={g.group} label={g.group}>
                {g.options.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </optgroup>
            ))}
          </select>
        )}
      </td>
      <td className="py-2 px-3"><Badge value={a.skills} /></td>
      <td className="py-2 px-3"><Badge value={a.mcps} /></td>
      <td className="py-2 px-3 text-center">
        <button
          role="switch"
          aria-checked={a.auto_launch}
          onClick={() => mutate({ auto_launch: !a.auto_launch })}
          disabled={update.isPending}
          className={`relative inline-flex h-4.5 w-8 items-center rounded-full transition-colors focus:outline-none disabled:opacity-50 ${
            a.auto_launch ? "bg-blue-600" : "bg-muted"
          }`}
        >
          <span className={`inline-block h-3 w-3 transform rounded-full bg-white shadow transition-transform ${a.auto_launch ? "translate-x-4.5" : "translate-x-0.5"}`} />
        </button>
      </td>
      <td className="py-2 px-3 text-center">
        <input
          type="checkbox"
          checked={a.enabled}
          onChange={(e) => mutate({ enabled: e.target.checked })}
          disabled={update.isPending}
          className="w-4 h-4 accent-primary cursor-pointer disabled:opacity-50"
        />
      </td>
      <td className="py-2 px-3 text-xs">
        <div className="flex items-center gap-1.5">
          {toast && <span className="text-green-600 dark:text-green-400">{toast}</span>}
          {update.isPending && <span className="text-muted-foreground">…</span>}
          <button
            onClick={handleDelete}
            disabled={del.isPending}
            title={confirmDelete ? "Click again to confirm" : "Delete"}
            className={`p-1 rounded transition-colors disabled:opacity-40 ${
              confirmDelete
                ? "text-red-500 bg-red-500/10 hover:bg-red-500/20"
                : "text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-red-500 hover:bg-red-500/10"
            }`}
          >
            <Trash2 size={12} />
          </button>
        </div>
      </td>
    </tr>
  );
}

// ── Section header row ────────────────────────────────────────────────────────

function SectionHeader({ label, count }: { label: string; count: number }) {
  return (
    <tr className="bg-muted/20">
      <td colSpan={9} className="py-1.5 px-3 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
        {label} <span className="font-normal">({count})</span>
      </td>
    </tr>
  );
}

// ── AddAssignmentModal ────────────────────────────────────────────────────────

interface AddModalProps {
  existingAssignments: AgentAssignment[];
  onDone: (created: AgentAssignment) => void;
  onClose: () => void;
}

function AddAssignmentModal({ existingAssignments, onDone, onClose }: AddModalProps) {
  const create = useCreateAssignment();
  const [fsmState, setFsmState] = useState("");
  const [role, setRole] = useState("");
  const [tool, setTool] = useState<AgentTool>("claude-code");
  const [error, setError] = useState<string | null>(null);

  const existingStates = [...new Set(existingAssignments.map((a) => a.fsm_state))].sort();
  const existingRoles  = [...new Set(existingAssignments.map((a) => a.role))].sort();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const state = fsmState.trim();
    const r = role.trim();
    if (!state) { setError("State is required"); return; }
    if (!r)     { setError("Role is required"); return; }
    const already = existingAssignments.find((a) => a.fsm_state === state && a.role === r);
    if (already) { setError(`${state}/${r} already exists — click its row to edit`); return; }
    setError(null);
    try {
      const created = await create.mutateAsync({ fsmState: state, role: r, tool });
      onDone(created);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create");
    }
  }

  return (
    <>
      <div onClick={onClose} className="fixed inset-0 bg-black/40 z-40" />
      <div className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[400px] bg-background border border-border rounded-xl shadow-2xl z-50 p-6">
        <h3 className="text-sm font-semibold mb-4">New Assignment</h3>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className="block text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1">FSM State</label>
            <input
              list="state-suggestions"
              value={fsmState}
              onChange={(e) => setFsmState(e.target.value)}
              placeholder="e.g. implementing"
              autoFocus
              className="w-full bg-background border border-border rounded-md px-3 py-1.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
            />
            <datalist id="state-suggestions">
              {existingStates.map((s) => <option key={s} value={s} />)}
              {[...GSD_STATES, ...CS_STATES].filter((s) => !existingStates.includes(s)).map((s) => <option key={s} value={s} />)}
            </datalist>
          </div>
          <div>
            <label className="block text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1">Role</label>
            <input
              list="role-suggestions"
              value={role}
              onChange={(e) => setRole(e.target.value)}
              placeholder="e.g. reviewer"
              className="w-full bg-background border border-border rounded-md px-3 py-1.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
            />
            <datalist id="role-suggestions">
              {existingRoles.map((r) => <option key={r} value={r} />)}
            </datalist>
          </div>
          <div>
            <label className="block text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1">Tool</label>
            <select
              value={tool}
              onChange={(e) => setTool(e.target.value as AgentTool)}
              className="w-full bg-background border border-border rounded-md px-3 py-1.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
            >
              {TOOLS.map((t) => <option key={t} value={t}>{TOOL_LABELS[t]}</option>)}
            </select>
          </div>
          {error && <p className="text-xs text-red-500">{error}</p>}
          <div className="flex gap-2 pt-1">
            <button
              type="submit"
              disabled={create.isPending}
              className="flex-1 bg-amber-500 hover:bg-amber-400 text-black text-sm font-semibold py-1.5 rounded-md transition-colors disabled:opacity-60"
            >
              {create.isPending ? "Creating…" : "Create"}
            </button>
            <button type="button" onClick={onClose} className="flex-1 bg-muted hover:bg-muted/80 text-foreground text-sm py-1.5 rounded-md transition-colors">
              Cancel
            </button>
          </div>
        </form>
      </div>
    </>
  );
}

// ── PoolIndicatorStrip ────────────────────────────────────────────────────────
// Shows warm (waiting) and busy session counts per tool.
// Data comes from the existing /api/agent-sessions endpoint polled every 3s.

interface PoolCounts {
  waiting: number;
  busy: number;
}

function PoolIndicatorStrip({ tools }: { tools: AgentTool[] }) {
  const { data: sessions = [] } = useAgentSessions();

  // Aggregate session counts per tool (only non-disconnected sessions)
  const counts = new Map<string, PoolCounts>();
  for (const s of sessions) {
    if (s.status === "disconnected" || s.status === "done") continue;
    const c = counts.get(s.tool) ?? { waiting: 0, busy: 0 };
    if (s.status === "waiting") c.waiting++;
    if (s.status === "busy")    c.busy++;
    counts.set(s.tool, c);
  }

  // Only show tools that appear in the current assignment list
  const toolsWithSessions = tools.filter((t) => t !== "human" && (counts.get(t)?.waiting ?? 0) + (counts.get(t)?.busy ?? 0) > 0);

  if (toolsWithSessions.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-3 px-4 py-2 border-b bg-muted/10">
      {toolsWithSessions.map((tool) => {
        const c = counts.get(tool) ?? { waiting: 0, busy: 0 };
        return (
          <span key={tool} className="flex items-center gap-2 text-xs">
            <span className="font-mono text-muted-foreground">{TOOL_LABELS[tool]}</span>
            <span
              title={`${c.waiting} session(s) waiting (warm)`}
              className="inline-flex items-center gap-1 text-amber-500 dark:text-amber-400"
            >
              <span aria-hidden>●</span>
              {c.waiting} warm
            </span>
            <span
              title={`${c.busy} session(s) busy (running)`}
              className="inline-flex items-center gap-1 text-muted-foreground"
            >
              <span aria-hidden>○</span>
              {c.busy} busy
            </span>
          </span>
        );
      })}
    </div>
  );
}

// ── AgentsTab ─────────────────────────────────────────────────────────────────

export function AgentsTab() {
  const { data: all = [], isLoading } = useAgentAssignments();
  const [filter, setFilter] = useState<ModeFilter>("all");
  const [selected, setSelected] = useState<AgentAssignment | null>(null);
  const [showAdd, setShowAdd] = useState(false);

  if (isLoading) {
    return <p className="text-sm text-muted-foreground p-6">Loading agents…</p>;
  }

  const gsdAssignments      = all.filter((a) => classifyMode(a.fsm_state) === "gsd");
  const changesetAssignments = all.filter((a) => classifyMode(a.fsm_state) === "changeset");
  const otherAssignments    = all.filter((a) => classifyMode(a.fsm_state) === "other");

  const visible =
    filter === "gsd"       ? gsdAssignments :
    filter === "changeset" ? changesetAssignments :
    all;

  const counts = { all: all.length, gsd: gsdAssignments.length, changeset: changesetAssignments.length };

  return (
    <div className="p-6 space-y-4">
      <div className="rounded-lg border bg-card">
        {/* Header */}
        <div className="px-4 py-3 border-b bg-muted/30 flex items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold">Agent Assignments</h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              {visible.length} of {all.length} assignment{all.length !== 1 ? "s" : ""}
            </p>
          </div>

          <div className="flex items-center gap-2">
            {/* Mode filter tabs */}
            <div className="flex rounded-md border border-border overflow-hidden text-xs">
              {(["all", "gsd", "changeset"] as ModeFilter[]).map((f) => (
                <button
                  key={f}
                  onClick={() => setFilter(f)}
                  className={`px-2.5 py-1 font-medium transition-colors capitalize ${
                    filter === f
                      ? "bg-amber-500 text-black"
                      : "bg-background text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {f} <span className="opacity-60">({counts[f] ?? otherAssignments.length})</span>
                </button>
              ))}
            </div>

            <button
              onClick={() => setShowAdd(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-500 hover:bg-amber-400 text-black text-xs font-semibold rounded-md transition-colors"
            >
              <Plus size={12} />
              New
            </button>
          </div>
        </div>

        {/* Pool warm/cold indicator strip — shows live session counts per tool */}
        <PoolIndicatorStrip tools={[...new Set<AgentTool>(all.map((a) => a.tool))]} />

        {/* Table */}
        <div>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/10">
                <th className="py-2 px-3 text-left text-xs font-semibold text-muted-foreground">State</th>
                <th className="py-2 px-3 text-left text-xs font-semibold text-muted-foreground">Role</th>
                <th className="py-2 px-3 text-left text-xs font-semibold text-muted-foreground">Tool</th>
                <th className="py-2 px-3 text-left text-xs font-semibold text-muted-foreground">Model</th>
                <th className="py-2 px-3 text-left text-xs font-semibold text-muted-foreground">Skills</th>
                <th className="py-2 px-3 text-left text-xs font-semibold text-muted-foreground">MCPs</th>
                <th className="py-2 px-3 text-center text-xs font-semibold text-muted-foreground">Auto-launch</th>
                <th className="py-2 px-3 text-center text-xs font-semibold text-muted-foreground">Enabled</th>
                <th className="py-2 px-3 text-xs font-semibold text-muted-foreground w-16" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filter === "all" ? (
                <>
                  {gsdAssignments.length > 0 && (
                    <>
                      <SectionHeader label="GSD" count={gsdAssignments.length} />
                      {gsdAssignments.map((a) => (
                        <AssignmentRow key={a.id} assignment={a} onOpen={() => setSelected(a)} />
                      ))}
                    </>
                  )}
                  {changesetAssignments.length > 0 && (
                    <>
                      <SectionHeader label="Changeset" count={changesetAssignments.length} />
                      {changesetAssignments.map((a) => (
                        <AssignmentRow key={a.id} assignment={a} onOpen={() => setSelected(a)} />
                      ))}
                    </>
                  )}
                  {otherAssignments.length > 0 && (
                    <>
                      <SectionHeader label="Other" count={otherAssignments.length} />
                      {otherAssignments.map((a) => (
                        <AssignmentRow key={a.id} assignment={a} onOpen={() => setSelected(a)} />
                      ))}
                    </>
                  )}
                </>
              ) : (
                visible.map((a) => (
                  <AssignmentRow key={a.id} assignment={a} onOpen={() => setSelected(a)} />
                ))
              )}
            </tbody>
          </table>
        </div>

        {visible.length === 0 && (
          <p className="text-sm text-muted-foreground p-6 text-center">
            No {filter === "all" ? "" : filter + " "}assignments.{" "}
            <button onClick={() => setShowAdd(true)} className="text-amber-500 hover:underline">Add one</button>
          </p>
        )}
      </div>

      <p className="text-xs text-muted-foreground">
        Click a role to open the detail panel — configure prompt, skills, and MCPs there.
      </p>

      {selected && (
        <AssignmentDrawer assignment={selected} onClose={() => setSelected(null)} />
      )}

      {showAdd && (
        <AddAssignmentModal
          existingAssignments={all}
          onClose={() => setShowAdd(false)}
          onDone={(created) => { setShowAdd(false); setSelected(created); }}
        />
      )}
    </div>
  );
}
