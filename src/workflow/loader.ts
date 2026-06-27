import { statSync, readdirSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { WorkflowLoadError } from "./errors.js";
import type { WorkflowDefinition } from "./types.js";

/** Default directory holding `<name>.js` workflow files. */
export const WORKFLOWS_DIR = ".claude/workflows";

// Only plain ESM is accepted: the published CLI runs under Node, where
// `import()` of a TypeScript file would fail without a transpiler.
const ALLOWED_EXTENSIONS = new Set([".js", ".mjs"]);

/**
 * Resolve a workflow reference to an absolute file path. A bare name (no slash,
 * no extension) is looked up under {@link WORKFLOWS_DIR}; anything else is
 * treated as a path relative to `baseDir`.
 */
export function resolveWorkflowPath(ref: string, baseDir = process.cwd()): string {
  if (typeof ref !== "string" || ref.trim().length === 0) {
    throw new WorkflowLoadError("Workflow reference must be a non-empty string");
  }
  const isBareName = !ref.includes("/") && !ref.includes(path.sep) && path.extname(ref) === "";
  if (isBareName) {
    return path.resolve(baseDir, WORKFLOWS_DIR, `${ref}.js`);
  }
  return path.resolve(baseDir, ref);
}

/**
 * List workflows under {@link WORKFLOWS_DIR} that are runnable by bare name.
 *
 * Only `<name>.js` files with a dotless stem are surfaced, matching
 * {@link resolveWorkflowPath} (bare name → `<name>.js`). Files like
 * `triage.workflow.js` or `*.mjs` are reachable only by explicit path, so they
 * are not listed as bare names. Returns `[]` if the directory is absent or the
 * path is not a directory.
 */
export function listWorkflows(baseDir = process.cwd()): string[] {
  const dir = path.resolve(baseDir, WORKFLOWS_DIR);
  let entries: string[];
  try {
    if (!statSync(dir).isDirectory()) return [];
    entries = readdirSync(dir);
  } catch {
    return []; // missing dir, permission error, etc.
  }
  return entries
    .filter((f) => f.endsWith(".js"))
    .map((f) => f.slice(0, -3)) // strip ".js"
    .filter((name) => name.length > 0 && !name.includes(".")) // bare-runnable only
    .filter((name) => {
      // Surface only entries loadWorkflow() would accept: a real file (or a
      // symlink to one). A directory named "foo.js" must not be advertised.
      try {
        return statSync(path.join(dir, `${name}.js`)).isFile();
      } catch {
        return false; // race-removed, broken symlink, permission error, etc.
      }
    })
    .sort();
}

/**
 * Load and validate a workflow file, returning its definition function.
 * Validates the path and module shape at the boundary.
 */
export async function loadWorkflow(filePath: string): Promise<WorkflowDefinition> {
  const ext = path.extname(filePath);
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    throw new WorkflowLoadError(`Workflow file must be .js or .mjs (got "${ext || "none"}")`);
  }
  let isFile: boolean;
  try {
    isFile = statSync(filePath).isFile();
  } catch {
    isFile = false; // missing, unreadable, broken symlink, etc.
  }
  if (!isFile) {
    throw new WorkflowLoadError(`Workflow file not found or not readable: ${filePath}`);
  }

  let mod: Record<string, unknown>;
  try {
    mod = (await import(pathToFileURL(filePath).href)) as Record<string, unknown>;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new WorkflowLoadError(`Failed to import workflow ${filePath}: ${message}`);
  }

  const definition = mod.default ?? mod.workflow ?? mod.run;
  if (typeof definition !== "function") {
    throw new WorkflowLoadError(
      `Workflow ${filePath} must export a default async function (or a named "workflow"/"run" export)`,
    );
  }
  return definition as WorkflowDefinition;
}
