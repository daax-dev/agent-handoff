import { api } from "../api-client.js";

interface MergeResult {
  status?: string;
  approvalId?: string;
}

export async function mergeCmd(changeSetId: string) {
  const result = await api.patch<MergeResult>(`/api/change-sets/${changeSetId}/status`, { trigger: "merge" });
  if (result.status === "awaiting_human_approval") {
    console.log(`Merge pending human approval for ${changeSetId} (approval: ${result.approvalId})`);
  } else {
    console.log(`Merged ${changeSetId} into main`);
  }
}
