import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { ChangeSet, ReviewComment, CheckRun, FSMCheckpoint, Task } from "@/types";

const API = "/api";

async function fetchChangeSet(id: string): Promise<ChangeSet> {
  const res = await fetch(`${API}/change-sets/${id}`);
  if (!res.ok) throw new Error("Failed to fetch change set");
  return res.json();
}

async function fetchDiff(id: string): Promise<string> {
  const res = await fetch(`${API}/change-sets/${id}/diff`);
  if (!res.ok) return "";
  return res.text();
}

async function fetchComments(id: string): Promise<ReviewComment[]> {
  const res = await fetch(`${API}/change-sets/${id}/comments`);
  if (!res.ok) return [];
  return res.json();
}

async function fetchCheckRuns(id: string): Promise<CheckRun[]> {
  const res = await fetch(`${API}/change-sets/${id}/check-runs`);
  if (!res.ok) return [];
  return res.json();
}

async function fetchCheckpoints(id: string): Promise<FSMCheckpoint[]> {
  const res = await fetch(`${API}/change-sets/${id}/checkpoints`);
  if (!res.ok) return [];
  return res.json();
}

async function fetchTasks(changeSetId: string): Promise<Task[]> {
  const res = await fetch(`${API}/tasks?changeSetId=${changeSetId}`);
  if (!res.ok) return [];
  return res.json();
}

async function resolveComment(csId: string, commentId: string): Promise<ReviewComment> {
  const res = await fetch(`${API}/change-sets/${csId}/comments/${commentId}/resolve`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ resolved_by: "human" }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "Unknown error" }));
    throw new Error(err.error ?? "Failed to resolve comment");
  }
  return res.json();
}

export function useChangeSetDetail(id: string) {
  const changeSet = useQuery({
    queryKey: ["change-sets", id],
    queryFn: () => fetchChangeSet(id),
    enabled: !!id,
  });

  const diff = useQuery({
    queryKey: ["change-sets", id, "diff"],
    queryFn: () => fetchDiff(id),
    enabled: !!id,
    staleTime: 30_000,
  });

  const comments = useQuery({
    queryKey: ["change-sets", id, "comments"],
    queryFn: () => fetchComments(id),
    enabled: !!id,
    refetchInterval: 5_000,
  });

  const checkRuns = useQuery({
    queryKey: ["change-sets", id, "check-runs"],
    queryFn: () => fetchCheckRuns(id),
    enabled: !!id,
    refetchInterval: 5_000,
  });

  const checkpoints = useQuery({
    queryKey: ["change-sets", id, "checkpoints"],
    queryFn: () => fetchCheckpoints(id),
    enabled: !!id,
    refetchInterval: 10_000,
  });

  const tasks = useQuery({
    queryKey: ["tasks", { changeSetId: id }],
    queryFn: () => fetchTasks(id),
    enabled: !!id,
  });

  return { changeSet, diff, comments, checkRuns, checkpoints, tasks };
}

export function useResolveComment(csId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (commentId: string) => resolveComment(csId, commentId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["change-sets", csId, "comments"] }),
  });
}
