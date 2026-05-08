import { useState } from "react";
import { useAgentAssignments, useUpdateAssignment } from "@/hooks/useAgentAssignments";
import { TOOL_LABELS, type AgentTool } from "@/types";

const TOOLS: AgentTool[] = ["claude-code", "codex", "cursor", "copilot-cli", "gemini", "human"];

export function AssignmentTable() {
  const { data: assignments = [], isLoading, isError } = useAgentAssignments();
  const update = useUpdateAssignment();
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null);

  function showToast(msg: string, ok: boolean) {
    setToast({ msg, ok });
    setTimeout(() => setToast(null), 3000);
  }

  function handleToolChange(fsmState: string, role: string, enabled: boolean, tool: AgentTool) {
    update.mutate(
      { fsmState, role, tool, enabled },
      {
        onSuccess: () => showToast("Assignment updated", true),
        onError: (e) => showToast(e instanceof Error ? e.message : "Update failed", false),
      }
    );
  }

  if (isLoading) return <p className="text-sm text-muted-foreground p-4">Loading assignments…</p>;
  if (isError) return <p className="text-sm text-destructive p-4">Failed to load assignments.</p>;

  return (
    <div className="relative">
      {/* Toast */}
      {toast && (
        <div
          className={`fixed bottom-4 right-4 z-50 px-4 py-2.5 rounded-lg text-sm font-medium shadow-lg ${
            toast.ok ? "bg-status-approved/10 text-status-approved border border-status-approved/20" : "bg-destructive/10 text-destructive border border-destructive/20"
          }`}
        >
          {toast.msg}
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left">
              <th className="py-2.5 px-4 text-xs font-semibold text-muted-foreground">FSM State</th>
              <th className="py-2.5 px-4 text-xs font-semibold text-muted-foreground">Role</th>
              <th className="py-2.5 px-4 text-xs font-semibold text-muted-foreground">Tool</th>
              <th className="py-2.5 px-4 text-xs font-semibold text-muted-foreground text-center">Enabled</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {assignments.map((a) => (
              <tr key={a.id} className="hover:bg-accent/40 transition-colors">
                <td className="py-2.5 px-4 font-mono text-xs text-foreground">{a.fsm_state}</td>
                <td className="py-2.5 px-4 font-mono text-xs text-muted-foreground">{a.role}</td>
                <td className="py-2.5 px-4">
                  <select
                    value={a.tool}
                    onChange={(e) => handleToolChange(a.fsm_state, a.role, a.enabled, e.target.value as AgentTool)}
                    className="bg-background border border-border rounded px-2 py-1 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                  >
                    {TOOLS.map((t) => (
                      <option key={t} value={t}>{TOOL_LABELS[t]}</option>
                    ))}
                  </select>
                </td>
                <td className="py-2.5 px-4 text-center">
                  <input
                    type="checkbox"
                    checked={a.enabled}
                    onChange={(e) => handleToolChange(a.fsm_state, a.role, e.target.checked, a.tool)}
                    className="w-4 h-4 accent-primary cursor-pointer"
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
