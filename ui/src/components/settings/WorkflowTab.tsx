import { useWorkflowConfig, useSaveWorkflowConfig, type WorkflowMode } from "@/hooks/useWorkflowConfig";

export function WorkflowTab() {
  const { data: config, isLoading } = useWorkflowConfig();
  const save = useSaveWorkflowConfig();

  if (isLoading || !config) {
    return <p className="text-sm text-muted-foreground p-6">Loading workflow config…</p>;
  }

  async function toggleMode(newMode: WorkflowMode) {
    if (!config || save.isPending) return;
    await save.mutateAsync({ ...config, mode: newMode });
  }

  async function toggleHitl(trigger: string) {
    if (!config || save.isPending) return;
    const already = config.hitlGatedTriggers.includes(trigger);
    const next = already
      ? config.hitlGatedTriggers.filter((t) => t !== trigger)
      : [...config.hitlGatedTriggers, trigger];
    await save.mutateAsync({ ...config, hitlGatedTriggers: next });
  }

  const triggers = config.transitions
    .filter((t) => t.trigger !== "abandon")
    .map((t) => t.trigger)
    .filter((v, i, a) => a.indexOf(v) === i)
    .sort();

  return (
    <div className="p-6 space-y-6">
      {/* Mode card */}
      <div className="rounded-lg border bg-card p-5 space-y-4">
        <div>
          <h3 className="text-sm font-semibold">Workflow Mode</h3>
          <p className="text-xs text-muted-foreground mt-1">
            Switch the active FSM. The diagram and agent assignments update immediately.
          </p>
        </div>

        <div className="flex gap-2">
          {(["changeset", "gsd"] as WorkflowMode[]).map((m) => (
            <button
              key={m}
              onClick={() => toggleMode(m)}
              disabled={save.isPending || config.mode === m}
              className={`px-4 py-2 rounded-md text-sm font-medium border transition-colors ${
                config.mode === m
                  ? "bg-amber-500 border-amber-500 text-black"
                  : "bg-background border-border text-muted-foreground hover:text-foreground hover:border-input"
              } disabled:cursor-not-allowed`}
            >
              {m === "changeset" ? "Changeset" : "GSD"}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-2 gap-4 text-xs text-muted-foreground">
          <div className="p-3 rounded-md bg-muted/40 border">
            <div className="font-semibold text-foreground mb-1">Changeset mode</div>
            Code review workflow: draft → planned → implementing → reviewing → approved → merged.
            Optimized for pull-request-driven development with automated review gates.
          </div>
          <div className="p-3 rounded-md bg-muted/40 border">
            <div className="font-semibold text-foreground mb-1">GSD mode</div>
            Get-Shit-Done workflow: project init → roadmap → discuss → plan → execute → verify → ship.
            Optimized for feature delivery with milestone-based iteration.
          </div>
        </div>
      </div>

      {/* HITL gates card */}
      <div className="rounded-lg border bg-card p-5 space-y-4">
        <div>
          <h3 className="text-sm font-semibold">HITL Gates</h3>
          <p className="text-xs text-muted-foreground mt-1">
            Transitions with HITL gates require human approval before the FSM advances.
            Off = agent proceeds automatically.
          </p>
        </div>

        {triggers.length === 0 && (
          <p className="text-xs text-muted-foreground">No transitions defined.</p>
        )}

        <div className="space-y-2">
          {triggers.map((trigger) => {
            const isGated = config.hitlGatedTriggers.includes(trigger);
            return (
              <div
                key={trigger}
                className="flex items-center justify-between px-3 py-2.5 rounded-md border bg-background hover:bg-accent/40 transition-colors"
              >
                <span className="text-xs font-mono text-foreground">{trigger}</span>
                <button
                  role="switch"
                  aria-checked={isGated}
                  onClick={() => toggleHitl(trigger)}
                  disabled={save.isPending}
                  className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus:outline-none disabled:opacity-50 ${
                    isGated ? "bg-blue-600" : "bg-muted"
                  }`}
                >
                  <span
                    className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${
                      isGated ? "translate-x-4.5" : "translate-x-0.5"
                    }`}
                  />
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
