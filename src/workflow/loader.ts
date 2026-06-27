import { existsSync, statSync } from "node:fs";
import { readdirSync } from "node:fs";
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

/** List available workflow files (base names) under {@link WORKFLOWS_DIR}. */
export function listWorkflows(baseDir = process.cwd()): string[] {
  const dir = path.resolve(baseDir, WORKFLOWS_DIR);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => ALLOWED_EXTENSIONS.has(path.extname(f)))
    .map((f) => f.replace(/\.(js|mjs)$/, ""))
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
  if (!existsSync(filePath) || !statSync(filePath).isFile()) {
    throw new WorkflowLoadError(`Workflow file not found: ${filePath}`);
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
