import { api } from "../api-client.js";
import { createInterface } from "node:readline";

async function confirm(msg: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(`${msg} [y/N] `, (answer) => {
      rl.close();
      resolve(answer.toLowerCase() === "y");
    });
  });
}

interface ApprovalRow {
  id: string;
  change_set_id: string;
  decided_at?: string;
}

export async function approveCmd(changeSetId: string) {
  const ok = await confirm(`Approve ${changeSetId}?`);
  if (!ok) {
    console.log("Cancelled.");
    process.exit(0);
  }

  // Check for pending HITL approvals first
  const approvals = await api.get<ApprovalRow[]>(`/api/approvals/by-changeset/${changeSetId}`);
  const pending = approvals.find((a) => !a.decided_at);

  if (pending) {
    await api.post(`/api/approvals/${pending.id}/approve`, {});
    console.log(`HITL approval granted for ${changeSetId}`);
  } else {
    await api.patch(`/api/change-sets/${changeSetId}/status`, { trigger: "approve" });
    console.log(`Approved ${changeSetId}`);
  }
}
