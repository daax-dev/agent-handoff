import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { ChangeSet, ChangeSetStatus } from "@/types";

const API = "/api";

async function fetchChangeSets(): Promise<ChangeSet[]> {
  const res = await fetch(`${API}/change-sets`);
  if (!res.ok) throw new Error("Failed to fetch change sets");
  return res.json();
}

async function patchStatus(id: string, status: ChangeSetStatus): Promise<ChangeSet> {
  const res = await fetch(`${API}/change-sets/${id}/status`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "Unknown error" }));
    throw new Error(err.error ?? "Failed to update status");
  }
  return res.json();
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
    mutationFn: (id: string) => patchStatus(id, "merged"),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["change-sets"] }),
  });
}

export function useRejectChangeSet() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => patchStatus(id, "abandoned"),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["change-sets"] }),
  });
}
