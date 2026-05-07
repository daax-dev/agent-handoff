import type { TransitionDef } from "./states.js";

const NON_TERMINAL = [
  "project_init",
  "roadmap_ready",
  "discussing",
  "planning",
  "plan_ready",
  "executing",
  "verifying",
  "gap_fixing",
  "shipping",
  "phase_done",
  "milestone_complete",
] as const;

export const GSD_TRANSITIONS: TransitionDef[] = [
  { from: "project_init",       to: "roadmap_ready",      trigger: "roadmap_approved"    },
  { from: "roadmap_ready",      to: "discussing",          trigger: "start_phase"         },
  { from: "roadmap_ready",      to: "planning",            trigger: "skip_discuss"        },
  { from: "discussing",         to: "planning",            trigger: "decisions_captured"  },
  { from: "planning",           to: "plan_ready",          trigger: "plans_verified"      },
  { from: "plan_ready",         to: "executing",           trigger: "start_execution"     },
  { from: "executing",          to: "verifying",           trigger: "execution_complete"  },
  { from: "verifying",          to: "shipping",            trigger: "verification_passed" },
  { from: "verifying",          to: "gap_fixing",          trigger: "gaps_found"          },
  { from: "gap_fixing",         to: "verifying",           trigger: "gaps_resolved"       },
  { from: "shipping",           to: "phase_done",          trigger: "pr_created"          },
  { from: "phase_done",         to: "discussing",          trigger: "start_next_phase"    },
  { from: "phase_done",         to: "milestone_complete",  trigger: "all_phases_done"     },
  { from: "milestone_complete", to: "project_init",        trigger: "new_milestone"       },
  ...NON_TERMINAL.map((from) => ({
    from,
    to: "escalated" as string,
    trigger: "abandon",
  })),
];

export const GSD_HITL_TRIGGERS = [
  "roadmap_approved",
  "verification_passed",
  "new_milestone",
];
