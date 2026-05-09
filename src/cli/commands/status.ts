import { api } from "../api-client.js";

interface ChangeSet {
  id: string;
  task_id: string;
  title: string;
  status: string;
  updated_at: string;
  blocking_comment_count?: number;
}

function pad(s: string, n: number) {
  return s.length >= n ? s.slice(0, n) : s + " ".repeat(n - s.length);
}

export async function statusCmd(changeSetId?: string, opts: { json?: boolean } = {}) {
  if (changeSetId) {
    const cs = await api.get<ChangeSet & { check_runs?: unknown[] }>(`/api/change-sets/${changeSetId}`);
    if (opts.json) { console.log(JSON.stringify(cs)); return; }
    console.log(`\nChangeSet: ${cs.id}`);
    console.log(`  Task:    ${cs.task_id}`);
    console.log(`  Title:   ${cs.title}`);
    console.log(`  Status:  ${cs.status}`);
    console.log(`  Updated: ${cs.updated_at}`);
    if (cs.blocking_comment_count !== undefined) {
      console.log(`  Blocking comments: ${cs.blocking_comment_count}`);
    }
    return;
  }

  const list = await api.get<ChangeSet[]>("/api/change-sets");
  if (opts.json) { console.log(JSON.stringify(list)); return; }
  if (list.length === 0) {
    console.log("No ChangeSets found. Create one with: agent-handoff new \"My feature\"");
    return;
  }

  console.log(`\n${pad("ID", 14)} ${pad("TASK", 10)} ${pad("STATUS", 20)} TITLE`);
  console.log("-".repeat(80));
  for (const cs of list) {
    console.log(`${pad(cs.id, 14)} ${pad(cs.task_id, 10)} ${pad(cs.status, 20)} ${cs.title}`);
  }
}
