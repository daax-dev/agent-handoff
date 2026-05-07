import { useState } from "react";
import { AssignmentTable } from "@/components/AssignmentTable";
import { SessionStatus } from "@/components/SessionStatus";

type Tab = "assignments" | "sessions";

export function Settings() {
  const [tab, setTab] = useState<Tab>("assignments");

  const tabClass = (t: Tab) =>
    `px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
      tab === t
        ? "border-primary text-foreground"
        : "border-transparent text-muted-foreground hover:text-foreground"
    }`;

  return (
    <div className="max-w-4xl mx-auto p-6">
      <h1 className="text-lg font-semibold mb-1">Settings</h1>
      <p className="text-sm text-muted-foreground mb-6">
        Configure which agent handles each FSM step and monitor live agent sessions.
      </p>

      {/* Tabs */}
      <div className="flex gap-0 border-b mb-0">
        <button className={tabClass("assignments")} onClick={() => setTab("assignments")}>
          Agent Assignments
        </button>
        <button className={tabClass("sessions")} onClick={() => setTab("sessions")}>
          Live Sessions
        </button>
      </div>

      <div className="border border-t-0 rounded-b-lg bg-card">
        {tab === "assignments" && <AssignmentTable />}
        {tab === "sessions" && <SessionStatus />}
      </div>
    </div>
  );
}
