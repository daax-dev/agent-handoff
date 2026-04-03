import { describe, test, expect } from "./test-compat.js";
import { ClaudeAdapter } from "../src/cli/claude.js";
import { CodexAdapter } from "../src/cli/codex.js";
import { GeminiAdapter } from "../src/cli/gemini.js";
import { CopilotAdapter } from "../src/cli/copilot.js";
import { OpenCodeAdapter } from "../src/cli/opencode.js";
import { AiderAdapter } from "../src/cli/aider.js";
import { getAdapter, listCliAgents } from "../src/cli/registry.js";

describe("CLI Adapters", () => {
  describe("ClaudeAdapter", () => {
    const adapter = new ClaudeAdapter();

    test("has correct name and command", () => {
      expect(adapter.name).toBe("claude");
      expect(adapter.command).toBe("claude");
    });

    test("builds args without model", () => {
      const args = adapter.buildArgs("refactor auth");
      expect(args).toEqual(["-p", "refactor auth", "--output-format", "json"]);
    });

    test("builds args with model", () => {
      const args = adapter.buildArgs("refactor auth", { model: "opus" });
      expect(args).toEqual(["-p", "refactor auth", "--output-format", "json", "--model", "opus"]);
    });

    test("parseOutput handles valid JSON", () => {
      const result = adapter.parseOutput('{"result": "done"}');
      expect(result.text).toBe("done");
      expect(result.structured).toEqual({ result: "done" });
    });

    test("parseOutput handles invalid JSON", () => {
      const result = adapter.parseOutput("plain text output");
      expect(result.text).toBe("plain text output");
      expect(result.structured).toBeUndefined();
    });
  });

  describe("CodexAdapter", () => {
    const adapter = new CodexAdapter();

    test("has correct name and command", () => {
      expect(adapter.name).toBe("codex");
      expect(adapter.command).toBe("codex");
    });

    test("builds args", () => {
      const args = adapter.buildArgs("refactor auth");
      expect(args).toEqual(["exec", "--json"]);
    });

    test("builds args with model", () => {
      const args = adapter.buildArgs("refactor auth", { model: "o3" });
      expect(args).toEqual(["exec", "--json", "--model", "o3"]);
    });

    test("parseOutput handles JSONL (last line)", () => {
      const result = adapter.parseOutput('{"type":"log"}\n{"message":"done"}');
      expect(result.text).toBe("done");
    });

    test("parseOutput handles invalid output", () => {
      const result = adapter.parseOutput("not json");
      expect(result.text).toBe("not json");
    });
  });

  describe("GeminiAdapter", () => {
    const adapter = new GeminiAdapter();

    test("has correct name and command", () => {
      expect(adapter.name).toBe("gemini");
      expect(adapter.command).toBe("gemini");
    });

    test("builds args", () => {
      expect(adapter.buildArgs("test")).toEqual(["-p", "test", "--output-format", "json"]);
    });

    test("parseOutput handles JSON with response field", () => {
      const result = adapter.parseOutput('{"response": "hello"}');
      expect(result.text).toBe("hello");
    });
  });

  describe("CopilotAdapter", () => {
    const adapter = new CopilotAdapter();

    test("has correct name and command", () => {
      expect(adapter.name).toBe("copilot");
      expect(adapter.command).toBe("copilot");
    });

    test("builds args (text only, no json flag)", () => {
      expect(adapter.buildArgs("test")).toEqual(["-p", "test"]);
    });

    test("parseOutput returns raw text", () => {
      const result = adapter.parseOutput("raw output here");
      expect(result.text).toBe("raw output here");
      expect(result.structured).toBeUndefined();
    });
  });

  describe("OpenCodeAdapter", () => {
    const adapter = new OpenCodeAdapter();

    test("has correct name and command", () => {
      expect(adapter.name).toBe("opencode");
      expect(adapter.command).toBe("opencode");
    });

    test("builds args with -f json", () => {
      expect(adapter.buildArgs("test")).toEqual(["-p", "test", "-f", "json"]);
    });
  });

  describe("AiderAdapter", () => {
    const adapter = new AiderAdapter();

    test("has correct name and command", () => {
      expect(adapter.name).toBe("aider");
      expect(adapter.command).toBe("aider");
    });

    test("builds args with --message and --yes-always --no-git", () => {
      const args = adapter.buildArgs("refactor auth");
      expect(args).toEqual(["--message", "refactor auth", "--yes-always", "--no-git"]);
    });

    test("builds args with model (OpenRouter)", () => {
      const args = adapter.buildArgs("refactor auth", { model: "openrouter/minimax/minimax-01" });
      expect(args).toEqual(["--message", "refactor auth", "--yes-always", "--no-git", "--model", "openrouter/minimax/minimax-01"]);
    });

    test("builds args with model (Ollama local)", () => {
      const args = adapter.buildArgs("write tests", { model: "ollama/qwen2.5-coder:32b" });
      expect(args).toEqual(["--message", "write tests", "--yes-always", "--no-git", "--model", "ollama/qwen2.5-coder:32b"]);
    });

    test("parseOutput returns raw text", () => {
      const result = adapter.parseOutput("aider output here");
      expect(result.text).toBe("aider output here");
      expect(result.structured).toBeUndefined();
    });
  });

  describe("Registry", () => {
    test("getAdapter returns correct adapter", () => {
      expect(getAdapter("claude").name).toBe("claude");
      expect(getAdapter("codex").name).toBe("codex");
    });

    test("getAdapter throws for unknown agent", () => {
      expect(() => getAdapter("unknown" as any)).toThrow("Unknown agent");
    });

    test("listCliAgents returns all 6 agents", () => {
      const agents = listCliAgents();
      expect(agents).toHaveLength(6);
      const names = agents.map((a) => a.name);
      expect(names).toContain("claude");
      expect(names).toContain("codex");
      expect(names).toContain("gemini");
      expect(names).toContain("copilot");
      expect(names).toContain("opencode");
      expect(names).toContain("aider");
      // Each agent has name, available (boolean), command (string)
      for (const agent of agents) {
        expect(typeof agent.available).toBe("boolean");
        expect(typeof agent.command).toBe("string");
      }
    });
  });
});
