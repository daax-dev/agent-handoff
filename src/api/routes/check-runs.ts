import type { Database } from "bun:sqlite";
import { listCheckRuns } from "../../domain/check-run.js";
import { json } from "../response.js";

export function checkRunRoutes(
  db: Database,
  path: string,
  req: Request
): Response | null {
  const listMatch = path.match(/^\/api\/change-sets\/(chg_\d{6})\/check-runs$/);
  if (listMatch && req.method === "GET") {
    return json(listCheckRuns(db, listMatch[1]));
  }
  return null;
}
