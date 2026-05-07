import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { ChangeSet } from "@/types";

const API = "/api";

async function fetchChangeSets(): Promise<ChangeSet[]> {
  const res = await fetch(`${API}/change-sets`);
  if (!res.ok) throw new Error("Failed to fetch change sets");
  return res.json();
}

async function triggerFSM(id: string, trigger: string): Promise<ChangeSet> {
  const res = await fetch(`${API}/change-sets/${id}/status`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ trigger }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "Unknown error" }));
    throw new Error(err.error ?? "Failed to update status");
  }
  return res.json();
}

async function approveViaHITL(changeSetId: string): Promise<void> {
  const res = await fetch(`${API}/approvals/by-changeset/${changeSetId}`);
  if (res.ok) {
    const approvals = await res.json() as Array<{ id: string; decided_at: string | null }>;
    const pending = approvals.find((a) => !a.decided_at);
    if (pending) {
      const r = await fetch(`${API}/approvals/${pending.id}/approve`, { method: "POST" });
      if (!r.ok) throw new Error("Failed to approve via HITL");
      return;
    }
  }
  // No pending HITL approval — use FSM trigger
  await triggerFSM(changeSetId, "approve");
}

async function rejectViaHITL(changeSetId: string): Promise<void> {
  const res = await fetch(`${API}/approvals/by-changeset/${changeSetId}`);
  if (res.ok) {
    const approvals = await res.json() as Array<{ id: string; decided_at: string | null }>;
    const pending = approvals.find((a) => !a.decided_at);
    if (pending) {
      const r = await fetch(`${API}/approvals/${pending.id}/reject`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: "Rejected via UI" }),
      });
      if (!r.ok) throw new Error("Failed to reject via HITL");
      return;
    }
  }
  // No pending HITL approval — fall back to abandon trigger
  await triggerFSM(changeSetId, "abandon");
}

export function useChangeSets() {
  return useQuery({
    queryKey: ["change-sets"],
    queryFn: fetchChangeSets,
    staleTime: 10_000,
  });
}

export function useApproveChangeSet() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => approveViaHITL(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["change-sets"] }),
  });
}

export function useRejectChangeSet() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => rejectViaHITL(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["change-sets"] }),
  });
}
