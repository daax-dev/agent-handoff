import { useState } from "react";
import { WorkflowTab } from "@/components/settings/WorkflowTab";
import { AgentsTab } from "@/components/settings/AgentsTab";
import { SessionsTab } from "@/components/settings/SessionsTab";

type Tab = "workflow" | "agents" | "sessions";

const TABS: Array<{ id: Tab; label: string }> = [
  { id: "workflow", label: "Workflow"  },
  { id: "agents",   label: "Agents"   },
  { id: "sessions", label: "Sessions" },
];

export function Settings() {
  const [tab, setTab] = useState<Tab>("workflow");

  return (
    <div className="max-w-5xl mx-auto p-6">
      <div className="mb-6">
        <h1 className="text-lg font-semibold">Settings</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Configure the active workflow mode, agent assignments, and monitor live sessions.
        </p>
      </div>

      {/* Tab bar */}
      <div className="flex border-b mb-0">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              tab === t.id
                ? "border-amber-500 text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab body */}
      <div className="border border-t-0 rounded-b-lg bg-background">
        {tab === "workflow"  && <WorkflowTab  />}
        {tab === "agents"    && <AgentsTab    />}
        {tab === "sessions"  && <SessionsTab  />}
      </div>
    </div>
  );
}
