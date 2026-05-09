import { api } from "../api-client.js";

interface ReviewComment {
  id: string;
  severity: string;
  body: string;
  file_path?: string;
  line_number?: number;
  author_agent?: string;
}

interface ChangeSet {
  id: string;
  title: string;
  status: string;
  review_comments?: ReviewComment[];
  check_runs?: Array<{ name: string; status: string; conclusion?: string }>;
}

export async function reviewCmd(changeSetId?: string, opts: { json?: boolean } = {}) {
  if (!changeSetId) {
    const list = await api.get<ChangeSet[]>("/api/change-sets?status=reviewing");
    if (opts.json) { console.log(JSON.stringify(list)); return; }
    if (list.length === 0) {
      console.log("No ChangeSets currently in review.");
      return;
    }
    for (const cs of list) {
      console.log(`${cs.id}  ${cs.title}  [${cs.status}]`);
    }
    return;
  }

  const cs = await api.get<ChangeSet>(`/api/change-sets/${changeSetId}`);
  const comments = await api.get<ReviewComment[]>(`/api/change-sets/${changeSetId}/review-comments`);
  if (opts.json) { console.log(JSON.stringify({ ...cs, review_comments: comments })); return; }

  console.log(`\nReview: ${cs.id} — ${cs.title}  [${cs.status}]`);

  const blocking = comments.filter((c) => c.severity === "blocking");
  const advisory = comments.filter((c) => c.severity !== "blocking");

  if (blocking.length > 0) {
    console.log(`\n── Blocking Comments (${blocking.length}) ──`);
    for (const c of blocking) {
      const loc = c.file_path ? `  ${c.file_path}${c.line_number ? `:${c.line_number}` : ""}` : "";
      console.log(`  [BLOCKING]${loc}`);
      console.log(`  ${c.body}`);
      if (c.author_agent) console.log(`  — ${c.author_agent}`);
      console.log();
    }
  }

  if (advisory.length > 0) {
    console.log(`── Advisory/Nit Comments (${advisory.length}) ──`);
    for (const c of advisory) {
      console.log(`  [${c.severity.toUpperCase()}] ${c.body}`);
    }
  }

  if (blocking.length === 0 && advisory.length === 0) {
    console.log("  No review comments.");
  }
}
