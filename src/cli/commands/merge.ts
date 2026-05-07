import { api } from "../api-client.js";

export async function mergeCmd(changeSetId: string) {
  await api.patch(`/api/change-sets/${changeSetId}/status`, { trigger: "merge" });
  console.log(`Merged ${changeSetId} into main`);
}
