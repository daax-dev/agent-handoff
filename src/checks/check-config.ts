import type { CheckRunName } from "../domain/check-run.js";

export interface CheckConfig {
  name: CheckRunName;
  command: string;
  required: boolean;
}

export const DEFAULT_CHECKS: CheckConfig[] = [
  { name: "typecheck", command: "bun run typecheck", required: true },
  { name: "lint",      command: "bun run lint",      required: true },
  { name: "test",      command: "bun test",           required: true },
];

export const REQUIRED_CHECK_NAMES: CheckRunName[] = DEFAULT_CHECKS
  .filter((c) => c.required)
  .map((c) => c.name);
