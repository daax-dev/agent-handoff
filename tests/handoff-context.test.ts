import { describe, test, expect } from "./test-compat.js";
import { randomBytes } from "crypto";
import {
  serializeContext,
  deserializeContext,
  createHandoffContext,
  HandoffContextSchema,
  type HandoffContext,
} from "../src/handoff-context.js";

const minimalContext: HandoffContext = {
  version: "1",
  completed_tasks: [],
  decisions: [],
  modified_files: [],
  next_steps: [],
};

describe("HandoffContext schema", () => {
  test("validates minimal context", () => {
    expect(() => HandoffContextSchema.parse(minimalContext)).not.toThrow();
  });

  test("validates full context", () => {
    const full: HandoffContext = {
      version: "1",
      sourceJobId: "hnd_abc123",
      completed_tasks: [
        { id: "task-1", title: "Setup auth", completedAt: "2026-04-17T10:00:00Z", summary: "Done" },
      ],
      decisions: [
        { description: "Use HMAC for SVID stub", rationale: "No SPIFFE lib available", decidedAt: "2026-04-17T09:00:00Z" },
      ],
      modified_files: [
        { path: "src/auth/spiffe.ts", changeType: "added", note: "New SVID implementation" },
        { path: "src/types.ts", changeType: "modified" },
      ],
      next_steps: [
        { order: 1, description: "Run integration tests", context: "Tests are in tests/", suggestedAgent: "claude" },
        { order: 2, description: "Deploy to staging" },
      ],
      workingContext: {
        workingDirectory: "/home/user/project",
        gitBranch: "feat/spiffe",
        gitHeadSha: "abc1234",
      },
    };
    expect(() => HandoffContextSchema.parse(full)).not.toThrow();
  });

  test("rejects invalid changeType", () => {
    const bad = {
      ...minimalContext,
      modified_files: [{ path: "foo.ts", changeType: "updated" }], // invalid enum
    };
    expect(() => HandoffContextSchema.parse(bad)).toThrow();
  });

  test("rejects negative next_steps order", () => {
    const bad = {
      ...minimalContext,
      next_steps: [{ order: -1, description: "bad" }],
    };
    expect(() => HandoffContextSchema.parse(bad)).toThrow();
  });
});

describe("serializeContext / deserializeContext roundtrip", () => {
  test("roundtrip minimal context", () => {
    const encoded = serializeContext(minimalContext);
    expect(typeof encoded).toBe("string");
    const decoded = deserializeContext(encoded);
    expect(decoded).toEqual(minimalContext);
  });

  test("roundtrip full context", () => {
    const ctx = createHandoffContext({
      sourceJobId: "hnd_test123456",
      completed_tasks: [
        { id: "t-1", title: "Auth", completedAt: new Date().toISOString() },
      ],
      decisions: [
        { description: "Use zlib", decidedAt: new Date().toISOString() },
      ],
      modified_files: [
        { path: "src/handoff-context.ts", changeType: "added" },
      ],
      next_steps: [
        { order: 1, description: "Test compression" },
      ],
    });

    const encoded = serializeContext(ctx);
    const decoded = deserializeContext(encoded);
    expect(decoded.sourceJobId).toBe("hnd_test123456");
    expect(decoded.completed_tasks).toHaveLength(1);
    expect(decoded.decisions).toHaveLength(1);
    expect(decoded.modified_files[0].changeType).toBe("added");
    expect(decoded.next_steps[0].order).toBe(1);
  });

  test("compressed output is base64 string", () => {
    const encoded = serializeContext(minimalContext);
    expect(() => Buffer.from(encoded, "base64")).not.toThrow();
    // Check it's valid base64 (no non-base64 chars outside padding)
    expect(encoded).toMatch(/^[A-Za-z0-9+/]+=*$/);
  });

  test("compressed size is well under 50KB for typical context", () => {
    const ctx = createHandoffContext({
      completed_tasks: Array.from({ length: 20 }, (_, i) => ({
        id: `task-${i}`,
        title: `Task ${i}: Some moderately long title describing what was done`,
        completedAt: new Date().toISOString(),
        summary: "Implemented and tested successfully",
      })),
      decisions: Array.from({ length: 10 }, (_, i) => ({
        description: `Decision ${i}: chose approach A over B`,
        rationale: "Better performance and simpler code",
        decidedAt: new Date().toISOString(),
      })),
      modified_files: Array.from({ length: 30 }, (_, i) => ({
        path: `src/module-${i}/index.ts`,
        changeType: "modified" as const,
      })),
      next_steps: Array.from({ length: 5 }, (_, i) => ({
        order: i + 1,
        description: `Step ${i + 1}: Do the next thing`,
        context: "Refer to the backlog for details",
      })),
    });

    const encoded = serializeContext(ctx);
    const sizeBytes = Buffer.from(encoded, "base64").length;
    expect(sizeBytes).toBeLessThan(50 * 1024);
  });

  test("throws when payload exceeds 50KB", () => {
    // Build a context with many large, hard-to-compress (random-ish) descriptions.
    // Using crypto random hex ensures the deflate output approaches the input size.
    const ctx = createHandoffContext({
      decisions: Array.from({ length: 500 }, () => ({
        description: randomBytes(128).toString("hex"), // 256 unique chars each
        rationale: randomBytes(64).toString("hex"),    // 128 unique chars each
        decidedAt: new Date().toISOString(),
      })),
    });

    expect(() => serializeContext(ctx)).toThrow(/exceeds limit/);
  });

  test("throws on corrupted base64 input", () => {
    expect(() => deserializeContext("not-valid-compressed-data!!!")).toThrow();
  });
});

describe("createHandoffContext helper", () => {
  test("fills defaults for empty partial", () => {
    const ctx = createHandoffContext({});
    expect(ctx.version).toBe("1");
    expect(ctx.completed_tasks).toEqual([]);
    expect(ctx.decisions).toEqual([]);
    expect(ctx.modified_files).toEqual([]);
    expect(ctx.next_steps).toEqual([]);
  });

  test("merges provided fields", () => {
    const ctx = createHandoffContext({
      sourceJobId: "hnd_xyz",
      next_steps: [{ order: 1, description: "Do thing" }],
    });
    expect(ctx.sourceJobId).toBe("hnd_xyz");
    expect(ctx.next_steps).toHaveLength(1);
    expect(ctx.completed_tasks).toEqual([]);
  });
});
