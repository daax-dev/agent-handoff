import { spawnSync } from "node:child_process";
import { api } from "../api-client.js";

interface ChangeSet {
  id: string;
  task_id: string;
  spec_path?: string;
}

export async function newCmd(title: string, _opts: { taskId?: string }) {
  const cs = await api.post<ChangeSet>("/api/change-sets/quick-create", {
    title,
  });

  console.log(`Created ${cs.task_id} / ${cs.id}`);

  // Open spec in $EDITOR
  const specPath = cs.spec_path;
  if (specPath) {
    const editor = process.env.EDITOR ?? "vim";
    spawnSync(editor, [specPath], { stdio: "inherit" });
  }
}
