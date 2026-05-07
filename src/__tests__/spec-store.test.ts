import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SpecStore, SpecPathError } from "../spec/store.js";
import { SPEC_TEMPLATE, ACCEPTANCE_TEMPLATE } from "../spec/templates.js";

let tmpDir: string;
let store: SpecStore;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "spec-store-test-"));
  store = new SpecStore(tmpDir);
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("SpecStore", () => {
  // ---------------------------------------------------------------------------
  // Round-trip
  // ---------------------------------------------------------------------------

  test("write + read round-trip for spec", () => {
    store.write("TSK_000001", "spec", "# My Spec\nGoal: do the thing");
    expect(store.read("TSK_000001", "spec")).toBe(
      "# My Spec\nGoal: do the thing"
    );
  });

  test("write + read round-trip for plan", () => {
    store.write("TSK_000001", "plan", "## Plan\n1. Step one");
    expect(store.read("TSK_000001", "plan")).toBe("## Plan\n1. Step one");
  });

  test("write + read round-trip for acceptance", () => {
    store.write("TSK_000001", "acceptance", "- [ ] Criterion 1");
    expect(store.read("TSK_000001", "acceptance")).toBe("- [ ] Criterion 1");
  });

  // ---------------------------------------------------------------------------
  // Missing file → null
  // ---------------------------------------------------------------------------

  test("read returns null for missing spec", () => {
    expect(store.read("TSK_000002", "spec")).toBeNull();
  });

  test("read returns null for missing plan", () => {
    expect(store.read("TSK_000002", "plan")).toBeNull();
  });

  test("read returns null for missing acceptance", () => {
    expect(store.read("TSK_000002", "acceptance")).toBeNull();
  });

  // ---------------------------------------------------------------------------
  // Directory creation
  // ---------------------------------------------------------------------------

  test("write creates the task directory if it does not exist", () => {
    const taskId = "TSK_000099";
    expect(existsSync(store.filePath(taskId, "spec"))).toBe(false);
    store.write(taskId, "spec", "content");
    expect(existsSync(store.filePath(taskId, "spec"))).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // exists()
  // ---------------------------------------------------------------------------

  test("exists returns false before write", () => {
    expect(store.exists("TSK_000003", "spec")).toBe(false);
  });

  test("exists returns true after write", () => {
    store.write("TSK_000003", "spec", "x");
    expect(store.exists("TSK_000003", "spec")).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // Path validation
  // ---------------------------------------------------------------------------

  test("write with traversal task ID throws SpecPathError", () => {
    expect(() =>
      store.write("../../etc" as any, "spec", "x")
    ).toThrow(SpecPathError);
  });

  test("write with invalid task ID throws SpecPathError", () => {
    expect(() =>
      store.write("invalid-id" as any, "spec", "x")
    ).toThrow(SpecPathError);
  });

  test("read with invalid task ID throws SpecPathError", () => {
    expect(() => store.read("../injected" as any, "spec")).toThrow(
      SpecPathError
    );
  });

  // ---------------------------------------------------------------------------
  // Templates
  // ---------------------------------------------------------------------------

  test("SPEC_TEMPLATE has ## Goal section", () => {
    expect(SPEC_TEMPLATE).toContain("## Goal");
  });

  test("SPEC_TEMPLATE has ## Context section", () => {
    expect(SPEC_TEMPLATE).toContain("## Context");
  });

  test("SPEC_TEMPLATE has ## Constraints section", () => {
    expect(SPEC_TEMPLATE).toContain("## Constraints");
  });

  test("SPEC_TEMPLATE has ## Out of Scope section", () => {
    expect(SPEC_TEMPLATE).toContain("## Out of Scope");
  });

  test("ACCEPTANCE_TEMPLATE has ## Acceptance Criteria section", () => {
    expect(ACCEPTANCE_TEMPLATE).toContain("## Acceptance Criteria");
  });

  // ---------------------------------------------------------------------------
  // initDefaults
  // ---------------------------------------------------------------------------

  test("initDefaults writes spec.md and acceptance.md with templates", () => {
    store.initDefaults("TSK_000010");
    const spec = store.read("TSK_000010", "spec");
    const acc = store.read("TSK_000010", "acceptance");
    expect(spec).toContain("## Goal");
    expect(acc).toContain("## Acceptance Criteria");
  });

  test("initDefaults does not overwrite existing files", () => {
    store.write("TSK_000011", "spec", "custom content");
    store.initDefaults("TSK_000011");
    expect(store.read("TSK_000011", "spec")).toBe("custom content");
  });

  // ---------------------------------------------------------------------------
  // Distinct files per kind
  // ---------------------------------------------------------------------------

  test("spec and acceptance are written to different paths", () => {
    expect(store.filePath("TSK_000001", "spec")).not.toBe(
      store.filePath("TSK_000001", "acceptance")
    );
  });

  test("all three kinds write to distinct files", () => {
    const paths = (["spec", "plan", "acceptance"] as const).map((k) =>
      store.filePath("TSK_000001", k)
    );
    const unique = new Set(paths);
    expect(unique.size).toBe(3);
  });
});
