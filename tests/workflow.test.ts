import { describe, test, expect } from "./test-compat.js";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { z } from "zod";
import { runWorkflow } from "../src/workflow/runner.js";
import { createCliExecutor } from "../src/workflow/executor.js";
import { loadWorkflow, resolveWorkflowPath, listWorkflows, WORKFLOWS_DIR } from "../src/workflow/loader.js";
import { validateAgentOutput, fieldMapToZod } from "../src/workflow/schema.js";
import { parsePositiveInt, parseArgs } from "../src/cli/commands/workflow.js";
import {
  AgentFailedError,
  BudgetExceededError,
  SchemaValidationError,
  WorkflowLoadError,
} from "../src/workflow/errors.js";
import type { AgentExecutor, RawAgentResult } from "../src/workflow/types.js";
import type { BaseAdapter } from "../src/cli/base-adapter.js";
import { estimateTokens } from "../src/context/token-estimator.js";

// --- helpers ---------------------------------------------------------------

const ok = (text: string, structured?: unknown, tokensUsed = 4): RawAgentResult => ({
  text,
  structured,
  tokensUsed,
});

/** Executor that returns a fixed result every call. */
function fixedExecutor(result: RawAgentResult): AgentExecutor {
  return async () => result;
}

/** Executor that walks a script of results/errors, repeating the last entry. */
function scriptedExecutor(steps: Array<RawAgentResult | Error>): AgentExecutor {
  let i = 0;
  return async () => {
    const step = steps[Math.min(i, steps.length - 1)];
    i += 1;
    if (step instanceof Error) throw step;
    return step;
  };
}

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

// --- runner: agent() -------------------------------------------------------

describe("workflow runner — agent()", () => {
  test("returns raw text when no schema is given", async () => {
    const run = await runWorkflow((ctx) => ctx.agent({ prompt: "hi" }), {
      executor: fixedExecutor(ok("hello world")),
      defaultAgent: "claude",
    });
    expect(run.result).toBe("hello world");
    expect(run.agentCalls).toHaveLength(1);
    expect(run.agentCalls[0]?.ok).toBe(true);
  });

  test("validates and returns a typed array with field-map schema", async () => {
    const payload = [{ issueId: "A1", title: "boom", userCount: 9 }];
    const run = await runWorkflow(
      (ctx) =>
        ctx.agent({
          prompt: "list",
          schema: { issueId: "string", title: "string", userCount: "number" },
          array: true,
        }),
      { executor: fixedExecutor(ok(JSON.stringify(payload))), defaultAgent: "claude" },
    );
    expect(run.result).toEqual(payload);
  });

  test("validates a single object via the adapter's structured field", async () => {
    // Mimic ClaudeAdapter shape: structured = { result: "<json string>" }.
    const inner = JSON.stringify({ id: "x", n: 3 });
    const run = await runWorkflow(
      (ctx) => ctx.agent({ prompt: "one", schema: { id: "string", n: "number" } }),
      { executor: fixedExecutor(ok(inner, { result: inner })), defaultAgent: "claude" },
    );
    expect(run.result).toEqual({ id: "x", n: 3 });
  });

  test("accepts a Zod schema directly", async () => {
    const schema = z.object({ ok: z.boolean() });
    const run = await runWorkflow(
      (ctx) => ctx.agent({ prompt: "z", schema }),
      { executor: fixedExecutor(ok(JSON.stringify({ ok: true }))), defaultAgent: "claude" },
    );
    expect(run.result).toEqual({ ok: true });
  });

  test("requires an agent (spec.agent or defaultAgent)", async () => {
    await expect(
      runWorkflow((ctx) => ctx.agent({ prompt: "no agent" }), { executor: fixedExecutor(ok("x")) }),
    ).rejects.toThrow(/requires an agent/);
  });

  test("rejects an empty prompt at the boundary", async () => {
    await expect(
      runWorkflow((ctx) => ctx.agent({ prompt: "" }), {
        executor: fixedExecutor(ok("x")),
        defaultAgent: "claude",
      }),
    ).rejects.toThrow(/non-empty prompt/);
  });

  test("rejects a whitespace-only prompt at the boundary", async () => {
    await expect(
      runWorkflow((ctx) => ctx.agent({ prompt: "   \n\t " }), {
        executor: fixedExecutor(ok("x")),
        defaultAgent: "claude",
      }),
    ).rejects.toThrow(/non-empty prompt/);
  });

  test("honors array:true with a Zod schema (validates an array, rejects a single object)", async () => {
    const schema = z.object({ id: z.string() });
    const payload = [{ id: "a" }, { id: "b" }];
    const run = await runWorkflow(
      (ctx) => ctx.agent({ prompt: "many", schema, array: true }),
      { executor: fixedExecutor(ok(JSON.stringify(payload))), defaultAgent: "claude" },
    );
    expect(run.result).toEqual(payload);

    // A single object with array:true must fail (then exhaust retries).
    await expect(
      runWorkflow((ctx) => ctx.agent({ prompt: "one", schema, array: true }), {
        executor: fixedExecutor(ok(JSON.stringify({ id: "a" }))),
        defaultAgent: "claude",
        maxRetries: 1,
      }),
    ).rejects.toBeInstanceOf(AgentFailedError);
  });
});

// --- runner: retry ---------------------------------------------------------

describe("workflow runner — retry", () => {
  test("retries on failure then succeeds; records attempt count", async () => {
    const exec = scriptedExecutor([new Error("flaky-1"), new Error("flaky-2"), ok("recovered")]);
    const run = await runWorkflow((ctx) => ctx.agent({ prompt: "retry me" }), {
      executor: exec,
      defaultAgent: "claude",
    });
    expect(run.result).toBe("recovered");
    expect(run.agentCalls[0]?.attempts).toBe(3);
  });

  test("surfaces AgentFailedError after exhausting maxRetries", async () => {
    const exec = scriptedExecutor([new Error("always")]);
    let caught: unknown;
    await runWorkflow((ctx) => ctx.agent({ prompt: "doomed" }), {
      executor: exec,
      defaultAgent: "claude",
      maxRetries: 3,
    }).catch((e) => (caught = e));
    expect(caught).toBeInstanceOf(AgentFailedError);
    expect((caught as AgentFailedError).attempts).toBe(3);
  });

  test("charges failed attempts and accumulates tokens across the whole call", async () => {
    const failErr = () => Object.assign(new Error("boom"), { tokensUsed: 5 });
    const run = await runWorkflow((ctx) => ctx.agent({ prompt: "retry me" }), {
      executor: scriptedExecutor([failErr(), failErr(), ok("done", undefined, 10)]),
      defaultAgent: "claude",
    });
    expect(run.result).toBe("done");
    expect(run.agentCalls[0]?.attempts).toBe(3);
    // Cumulative across all attempts (failed included): 5 + 5 + 10.
    expect(run.agentCalls[0]?.tokensUsed).toBe(20);
    expect(run.tokensUsed).toBe(20);
  });

  test("schema-validation failure is retried then surfaced", async () => {
    let calls = 0;
    const exec: AgentExecutor = async () => {
      calls += 1;
      return ok("not json at all");
    };
    await expect(
      runWorkflow((ctx) => ctx.agent({ prompt: "bad", schema: { a: "string" } }), {
        executor: exec,
        defaultAgent: "claude",
        maxRetries: 2,
      }),
    ).rejects.toBeInstanceOf(AgentFailedError);
    expect(calls).toBe(2);
  });
});

// --- runner: parallel ------------------------------------------------------

describe("workflow runner — parallel()", () => {
  test("runs all tasks and preserves input order", async () => {
    const run = await runWorkflow(
      (ctx) =>
        ctx.parallel([
          async () => {
            await delay(20);
            return "slow";
          },
          async () => "fast",
        ]),
      { executor: fixedExecutor(ok("x")), defaultAgent: "claude" },
    );
    expect(run.result).toEqual(["slow", "fast"]);
  });

  test("accepts bare promises as well as thunks", async () => {
    const run = await runWorkflow((ctx) => ctx.parallel([Promise.resolve(1), Promise.resolve(2)]), {
      executor: fixedExecutor(ok("x")),
      defaultAgent: "claude",
    });
    expect(run.result).toEqual([1, 2]);
  });
});

// --- runner: pipeline ------------------------------------------------------

describe("workflow runner — pipeline()", () => {
  test("streams items through stages concurrently (not barriered) and keeps order", async () => {
    const events: string[] = [];
    const run = await runWorkflow(
      (ctx) =>
        ctx.pipeline([0, 1], [
          async (item) => {
            const n = item as number;
            events.push(`s1-start:${n}`);
            if (n === 1) await delay(20); // item 1 lingers in stage 1
            events.push(`s1-end:${n}`);
            return n * 10;
          },
          async (prev, item) => {
            events.push(`s2:${item}`);
            return (prev as number) + 1;
          },
        ]),
      { executor: fixedExecutor(ok("x")), defaultAgent: "claude" },
    );
    // Results come back in item order regardless of completion timing.
    expect(run.result).toEqual([1, 11]);
    // Item 0 reaches stage 2 before item 1 finishes stage 1 → genuine streaming.
    expect(events.indexOf("s2:0")).toBeLessThan(events.indexOf("s1-end:1"));
  });

  test("rejects empty stage list", async () => {
    await expect(
      runWorkflow((ctx) => ctx.pipeline([1], []), {
        executor: fixedExecutor(ok("x")),
        defaultAgent: "claude",
      }),
    ).rejects.toThrow(/non-empty array of stages/);
  });
});

// --- runner: budget --------------------------------------------------------

describe("workflow runner — budget", () => {
  test("remaining is queryable and decreases as tokens are spent", async () => {
    const run = await runWorkflow(
      async (ctx) => {
        await ctx.agent({ prompt: "one" });
        return ctx.budget.remaining;
      },
      { executor: fixedExecutor(ok("r", undefined, 6)), defaultAgent: "claude", budget: 100 },
    );
    expect(run.result).toBe(94);
  });

  test("throws BudgetExceededError once the budget is exhausted", async () => {
    await expect(
      runWorkflow(
        async (ctx) => {
          // Each call costs 6; budget 10 allows the first two, blocks the third.
          await ctx.agent({ prompt: "1" });
          await ctx.agent({ prompt: "2" });
          await ctx.agent({ prompt: "3" });
        },
        { executor: fixedExecutor(ok("r", undefined, 6)), defaultAgent: "claude", budget: 10 },
      ),
    ).rejects.toBeInstanceOf(BudgetExceededError);
  });

  test("supports a while-remaining loop guard", async () => {
    const run = await runWorkflow(
      async (ctx) => {
        let n = 0;
        while (ctx.budget.remaining > 5) {
          await ctx.agent({ prompt: `iter ${n}` });
          n += 1;
        }
        return n;
      },
      { executor: fixedExecutor(ok("r", undefined, 4)), defaultAgent: "claude", budget: 20 },
    );
    // 20 budget, 4/call, loop runs while remaining > 5: after 3 calls remaining=8>5,
    // after 4th remaining=4, stop → 4 calls.
    expect(run.result).toBe(4);
  });

  test("failed attempts consume budget, so retries cannot loop for free", async () => {
    const failErr = () => Object.assign(new Error("boom"), { tokensUsed: 5 });
    // budget 8, 5/failed-attempt: attempt 1 → used 5; attempt 2 admitted (5<8) →
    // used 10; attempt 3 admission sees 10>=8 → BudgetExceededError (not endless).
    await expect(
      runWorkflow((ctx) => ctx.agent({ prompt: "x" }), {
        executor: scriptedExecutor([failErr()]),
        defaultAgent: "claude",
        maxRetries: 10,
        budget: 8,
      }),
    ).rejects.toBeInstanceOf(BudgetExceededError);
  });

  test("admission check hard-stops after a concurrent in-flight overshoot", async () => {
    // budget 10, 6/call: a parallel pair is both admitted (used → 12), which is
    // an intentional overshoot — per-call cost is unknown before completion.
    // The budget then hard-stops the next admission. Mirrors the upstream model.
    await expect(
      runWorkflow(
        async (ctx) => {
          await ctx.parallel([
            () => ctx.agent({ prompt: "a" }),
            () => ctx.agent({ prompt: "b" }),
          ]);
          await ctx.agent({ prompt: "c" }); // used 12 >= 10 → throws
        },
        { executor: fixedExecutor(ok("r", undefined, 6)), defaultAgent: "claude", budget: 10 },
      ),
    ).rejects.toBeInstanceOf(BudgetExceededError);
  });
});

// --- runner: args + phaseLog ----------------------------------------------

describe("workflow runner — args & phaseLog", () => {
  test("exposes args with caller-supplied defaults", async () => {
    const run = await runWorkflow((ctx) => (ctx.args.threshold as number) ?? -1, {
      executor: fixedExecutor(ok("x")),
      defaultAgent: "claude",
      args: { threshold: 42 },
    });
    expect(run.result).toBe(42);
  });

  test("captures phase log entries and notifies the observer", async () => {
    const seen: string[] = [];
    const run = await runWorkflow(
      (ctx) => {
        ctx.phaseLog("phase one");
        ctx.phaseLog("phase two", { n: 2 });
        return null;
      },
      { executor: fixedExecutor(ok("x")), defaultAgent: "claude", onPhaseLog: (e) => seen.push(e.message) },
    );
    expect(run.phaseLog.map((e) => e.message)).toEqual(["phase one", "phase two"]);
    expect(run.phaseLog[1]?.data).toEqual({ n: 2 });
    expect(seen).toEqual(["phase one", "phase two"]);
  });
});

// --- schema ----------------------------------------------------------------

describe("workflow schema validation", () => {
  test("fieldMapToZod enforces declared types", () => {
    const schema = fieldMapToZod({ a: "string", b: "number", c: "boolean", tags: "string[]" });
    expect(schema.safeParse({ a: "x", b: 1, c: true, tags: ["t"] }).success).toBe(true);
    expect(schema.safeParse({ a: "x", b: "nope", c: true, tags: [] }).success).toBe(false);
  });

  test("validateAgentOutput throws on non-JSON output", () => {
    expect(() => validateAgentOutput(ok("totally not json"), { a: "string" }, false)).toThrow(
      SchemaValidationError,
    );
  });

  test("validateAgentOutput extracts JSON embedded in prose", () => {
    const raw = ok('Here you go:\n[{"id":"1"}]\nThanks!');
    const result = validateAgentOutput(raw, { id: "string" }, true);
    expect(result).toEqual([{ id: "1" }]);
  });

  test("validateAgentOutput unwraps non-Claude adapter envelopes (message/response)", () => {
    // Codex envelope: text is prose, the JSON reply sits in structured.message.
    const codexLike = { text: "ok done", structured: { message: '{"id":"z"}' }, tokensUsed: 4 };
    expect(validateAgentOutput(codexLike, { id: "string" }, false)).toEqual({ id: "z" });
    // Gemini envelope: structured.response.
    const geminiLike = { text: "summary", structured: { response: '{"id":"g"}' }, tokensUsed: 4 };
    expect(validateAgentOutput(geminiLike, { id: "string" }, false)).toEqual({ id: "g" });
  });
});

// --- CLI argument parsing --------------------------------------------------

describe("workflow CLI parsing", () => {
  test("parsePositiveInt accepts positive integers and rejects non-integers/non-positives", () => {
    expect(parsePositiveInt(undefined, "--budget")).toBeUndefined();
    expect(parsePositiveInt("200000", "--budget")).toBe(200000);
    expect(() => parsePositiveInt("1.5", "--max-retries")).toThrow(/positive integer/);
    expect(() => parsePositiveInt("0", "--budget")).toThrow(/positive integer/);
    expect(() => parsePositiveInt("-3", "--budget")).toThrow(/positive integer/);
    expect(() => parsePositiveInt("abc", "--budget")).toThrow(/positive integer/);
  });

  test("parseArgs JSON-coerces values and rejects malformed pairs", () => {
    expect(parseArgs(["threshold=100", "name=foo", "flag=true"])).toEqual({
      threshold: 100,
      name: "foo",
      flag: true,
    });
    expect(() => parseArgs(["noequals"])).toThrow(/key=value/);
    expect(() => parseArgs(["=novalue"])).toThrow(/empty key/);
  });
});

// --- loader ----------------------------------------------------------------

describe("workflow loader", () => {
  test("resolveWorkflowPath maps a bare name into the workflows dir", () => {
    const p = resolveWorkflowPath("triage", "/repo");
    expect(p).toBe(path.resolve("/repo", WORKFLOWS_DIR, "triage.js"));
  });

  test("resolveWorkflowPath treats a path-like ref as a path", () => {
    const p = resolveWorkflowPath("examples/x.workflow.js", "/repo");
    expect(p).toBe(path.resolve("/repo", "examples/x.workflow.js"));
  });

  test("loads the shipped example workflow as a function", async () => {
    const def = await loadWorkflow(resolveWorkflowPath("examples/workflows/triage.workflow.js"));
    expect(typeof def).toBe("function");
  });

  test("listWorkflows finds nothing when the dir is absent", () => {
    expect(listWorkflows(mkdtempSync(path.join(tmpdir(), "wf-empty-")))).toEqual([]);
  });

  test("throws WorkflowLoadError for a missing file", async () => {
    await expect(loadWorkflow("/nope/missing.js")).rejects.toBeInstanceOf(WorkflowLoadError);
  });

  test("throws WorkflowLoadError when the module exports no function", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "wf-bad-"));
    const file = path.join(dir, "bad.mjs");
    writeFileSync(file, "export const notAFunction = 42;\n");
    try {
      await expect(loadWorkflow(file)).rejects.toBeInstanceOf(WorkflowLoadError);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// --- executor → adapter seam ----------------------------------------------

/** Build a fake adapter that records spawns and returns canned ClaudeAdapter-shaped output. */
function fakeAdapter(opts: {
  stdout: string;
  exitCode?: number;
  stderr?: string;
  onRun?: (prompt: string, options?: unknown) => void;
}): BaseAdapter {
  return {
    name: "claude",
    command: "claude",
    buildArgs: () => [],
    parseOutput(stdout: string) {
      try {
        const parsed = JSON.parse(stdout);
        return { text: parsed.result ?? stdout, structured: parsed };
      } catch {
        return { text: stdout };
      }
    },
    async run(prompt: string, options?: unknown) {
      opts.onRun?.(prompt, options);
      return { stdout: opts.stdout, stderr: opts.stderr ?? "", exitCode: opts.exitCode ?? 0, pid: 1234 };
    },
    get processRef() {
      return null;
    },
  } as unknown as BaseAdapter;
}

describe("createCliExecutor — executor→adapter seam", () => {
  test("spawns via the adapter, parses output, and accounts tokens", async () => {
    let received: { prompt?: string; options?: unknown } = {};
    const stdout = JSON.stringify({ result: "done" });
    const exec = createCliExecutor({
      getAdapter: () => fakeAdapter({ stdout, onRun: (prompt, options) => (received = { prompt, options }) }),
    });
    const result = await exec({ agent: "claude", prompt: "do it", model: "opus" });
    expect(received.prompt).toBe("do it");
    expect((received.options as { model?: string }).model).toBe("opus");
    expect(result.text).toBe("done");
    expect(result.structured).toEqual({ result: "done" });
    expect(result.tokensUsed).toBe(estimateTokens("do it") + estimateTokens(stdout));
  });

  test("throws AgentFailedError on a non-zero exit code, with token cost attached", async () => {
    const stdout = "partial output before failure";
    const exec = createCliExecutor({
      getAdapter: () => fakeAdapter({ stdout, exitCode: 1, stderr: "kaboom" }),
    });
    const err = await exec({ agent: "claude", prompt: "x" }).then(
      () => null,
      (e) => e,
    );
    expect(err).toBeInstanceOf(AgentFailedError);
    // The runner relies on this to charge failed attempts against the budget.
    expect((err as AgentFailedError).tokensUsed).toBe(estimateTokens("x") + estimateTokens(stdout));
  });
});

// --- end-to-end: load file + real executor + adapter seam ------------------

describe("end-to-end: example workflow over the real executor", () => {
  // Route prompts to canned adapter outputs, mimicking real spawns.
  function route(prompt: string): string {
    if (prompt.includes("List unresolved issues")) {
      return JSON.stringify([
        { issueId: "A1", title: "crash on save", userCount: 500 },
        { issueId: "A2", title: "typo", userCount: 2 },
      ]);
    }
    if (prompt.startsWith("Investigate and fix")) return "patched";
    return "verified";
  }

  function routedAdapter(): BaseAdapter {
    return {
      name: "claude",
      command: "claude",
      buildArgs: () => [],
      parseOutput(stdout: string) {
        try {
          const parsed = JSON.parse(stdout);
          return { text: parsed.result ?? stdout, structured: parsed };
        } catch {
          return { text: stdout };
        }
      },
      async run(prompt: string) {
        return { stdout: JSON.stringify({ result: route(prompt) }), stderr: "", exitCode: 0, pid: 1 };
      },
      get processRef() {
        return null;
      },
    } as unknown as BaseAdapter;
  }

  test("filters by threshold, runs the fix→verify pipeline, returns a typed result", async () => {
    const def = await loadWorkflow(resolveWorkflowPath("examples/workflows/triage.workflow.js"));
    const executor = createCliExecutor({ getAdapter: () => routedAdapter() });
    const run = await runWorkflow(def, {
      executor,
      defaultAgent: "claude",
      args: { threshold: 100 },
      budget: 1_000_000,
    });
    // Only A1 (userCount 500) clears threshold 100 → 1 issue fixed+verified.
    expect(run.result).toMatchObject({ fixed: 1, threshold: 100 });
    // 1 list call + (1 fix + 1 verify) for the one big issue = 3 agent calls.
    expect(run.agentCalls).toHaveLength(3);
    expect(run.agentCalls.every((c) => c.ok)).toBe(true);
  });

  test("takes the early-exit branch when nothing clears the threshold", async () => {
    const def = await loadWorkflow(resolveWorkflowPath("examples/workflows/triage.workflow.js"));
    const executor = createCliExecutor({ getAdapter: () => routedAdapter() });
    const run = await runWorkflow(def, { executor, defaultAgent: "claude", args: { threshold: 10_000 } });
    expect(run.result).toMatchObject({ fixed: 0 });
    expect(run.agentCalls).toHaveLength(1); // only the list phase ran
  });
});
