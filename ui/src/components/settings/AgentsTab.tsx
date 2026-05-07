import { useWorkflowConfig } from "@/hooks/useWorkflowConfig";
import { useAgentAssignmentsByMode, useUpdateAssignment } from "@/hooks/useAgentAssignments";
import { TOOL_LABELS, type AgentAssignment, type AgentTool } from "@/types";
import { useState } from "react";

const TOOLS = Object.keys(TOOL_LABELS) as AgentTool[];

const MODEL_OPTIONS = [
  { group: "Anthropic", options: [
    { value: "anthropic:claude-opus-4-7",    label: "Claude Opus 4.7"    },
    { value: "anthropic:claude-sonnet-4-6",  label: "Claude Sonnet 4.6"  },
    { value: "anthropic:claude-haiku-4-5",   label: "Claude Haiku 4.5"   },
  ]},
  { group: "OpenAI", options: [
    { value: "openai:gpt-4o",    label: "GPT-4o"    },
    { value: "openai:o3",        label: "o3"         },
    { value: "openai:o4-mini",   label: "o4-mini"    },
  ]},
  { group: "Google", options: [
    { value: "google:gemini-2.5-pro",   label: "Gemini 2.5 Pro"   },
    { value: "google:gemini-2.5-flash", label: "Gemini 2.5 Flash" },
  ]},
];

interface RowProps {
  assignment: AgentAssignment;
}

function AssignmentRow({ assignment: a }: RowProps) {
  const update = useUpdateAssignment();
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
      },
      { onSuccess: () => flash("Saved"), onError: () => flash("Error") }
    );
  }

  return (
    <tr className="border-b hover:bg-accent/30 transition-colors">
      <td className="py-2 px-3 font-mono text-xs text-amber-600 dark:text-amber-400">{a.fsm_state}</td>
      <td className="py-2 px-3 font-mono text-xs text-muted-foreground">{a.role}</td>
      <td className="py-2 px-3">
        <select
          value={a.tool}
          onChange={(e) => mutate({ tool: e.target.value as AgentTool })}
          disabled={update.isPending}
          className="bg-background border border-border rounded px-2 py-1 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-50"
        >
          {TOOLS.map((t) => (
            <option key={t} value={t}>{TOOL_LABELS[t]}</option>
          ))}
        </select>
      </td>
      <td className="py-2 px-3">
        <select
          value={a.model ?? ""}
          onChange={(e) => mutate({ model: e.target.value || null })}
          disabled={update.isPending}
          className="bg-background border border-border rounded px-2 py-1 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-50"
        >
          <option value="">Role default</option>
          {MODEL_OPTIONS.map((g) => (
            <optgroup key={g.group} label={g.group}>
              {g.options.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </optgroup>
          ))}
        </select>
      </td>
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
          <span
            className={`inline-block h-3 w-3 transform rounded-full bg-white shadow transition-transform ${
              a.auto_launch ? "translate-x-4.5" : "translate-x-0.5"
            }`}
          />
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
        {toast && (
          <span className="text-green-600 dark:text-green-400">{toast}</span>
        )}
        {update.isPending && (
          <span className="text-muted-foreground">…</span>
        )}
      </td>
    </tr>
  );
}

export function AgentsTab() {
  const { data: config, isLoading: configLoading } = useWorkflowConfig();
  const mode = config?.mode ?? "changeset";
  const { data: assignments = [], isLoading: assignmentsLoading } = useAgentAssignmentsByMode(mode);

  if (configLoading || assignmentsLoading) {
    return <p className="text-sm text-muted-foreground p-6">Loading agents…</p>;
  }

  return (
    <div className="p-6 space-y-4">
      <div className="rounded-lg border bg-card overflow-hidden">
        <div className="px-4 py-3 border-b bg-muted/30 flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold">Agent Assignments</h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              Mode: <span className="font-mono font-medium">{mode}</span> — showing{" "}
              {assignments.length} assignment{assignments.length !== 1 ? "s" : ""}
            </p>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/10">
                <th className="py-2 px-3 text-left text-xs font-semibold text-muted-foreground">State</th>
                <th className="py-2 px-3 text-left text-xs font-semibold text-muted-foreground">Role</th>
                <th className="py-2 px-3 text-left text-xs font-semibold text-muted-foreground">Tool</th>
                <th className="py-2 px-3 text-left text-xs font-semibold text-muted-foreground">Model</th>
                <th className="py-2 px-3 text-center text-xs font-semibold text-muted-foreground">Auto-launch</th>
                <th className="py-2 px-3 text-center text-xs font-semibold text-muted-foreground">Enabled</th>
                <th className="py-2 px-3 text-xs font-semibold text-muted-foreground w-12" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {assignments.map((a) => (
                <AssignmentRow key={a.id} assignment={a} />
              ))}
            </tbody>
          </table>
        </div>

        {assignments.length === 0 && (
          <p className="text-sm text-muted-foreground p-6 text-center">
            No assignments for {mode} mode.
          </p>
        )}
      </div>

      <p className="text-xs text-muted-foreground">
        Click a state node in the FSM diagram to configure prompt overrides and MCP settings.
      </p>
    </div>
  );
}
