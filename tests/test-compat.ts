const runner = typeof Bun !== "undefined"
  ? await import("bun:test")
  : await import("vitest");

export const describe = runner.describe;
export const test = runner.test;
export const it = runner.it;
export const expect = runner.expect;
export const beforeEach = runner.beforeEach;
export const afterEach = runner.afterEach;
export const beforeAll = runner.beforeAll;
export const afterAll = runner.afterAll;
export const vi = (runner as { vi?: unknown; mock?: unknown }).vi
  ?? (runner as { mock?: unknown }).mock;
export const mock = (vi as { fn?: unknown } | undefined)?.fn
  ?? (runner as { mock?: unknown }).mock;
