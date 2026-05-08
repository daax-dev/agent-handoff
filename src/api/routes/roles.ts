import { join, resolve, dirname } from "path";
import { existsSync, readFileSync } from "fs";
import { fileURLToPath } from "url";
import { json, notFound } from "../response.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROMPTS_DIR = resolve(__dirname, "../../roles/prompts");

export function rolesRoute(path: string, req: Request): Response | null {
  const match = path.match(/^\/api\/roles\/([^/]+)\/prompt$/);
  if (!match || req.method !== "GET") return null;
  const [, role] = match;
  if (!/^[a-z0-9_-]+$/.test(role)) return notFound();
  const filePath = join(PROMPTS_DIR, `${role}.md`);
  if (!existsSync(filePath)) return notFound();
  const content = readFileSync(filePath, "utf8");
  return json({ role, content });
}
