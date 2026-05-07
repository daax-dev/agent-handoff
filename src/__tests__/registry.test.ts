import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { resolve } from "node:path";
import { AgentRoleRegistry, UnknownRoleError, resetRegistry } from "../roles/registry.js";

const REPO_ROOT = resolve(process.cwd());

beforeEach(() => resetRegistry());
afterEach(() => resetRegistry());

describe("AgentRoleRegistry", () => {
  test("loads all 8 roles", () => {
    const reg = new AgentRoleRegistry(REPO_ROOT);
    const roles = reg.listRoles();
    const expected = [
      "planner", "implementer", "test_agent", "reviewer",
      "security_reviewer", "architecture_reviewer", "fixer", "summarizer",
    ];
    for (const r of expected) {
      expect(roles).toContain(r);
    }
  });

  test("security_reviewer default model is claude-opus-4-7", () => {
    const reg = new AgentRoleRegistry(REPO_ROOT);
    expect(reg.getRoleConfig("security_reviewer").model).toBe("claude-opus-4-7");
  });

  test("architecture_reviewer default model is claude-opus-4-7", () => {
    const reg = new AgentRoleRegistry(REPO_ROOT);
    expect(reg.getRoleConfig("architecture_reviewer").model).toBe("claude-opus-4-7");
  });

  test("planner default model is claude-sonnet-4-6", () => {
    const reg = new AgentRoleRegistry(REPO_ROOT);
    expect(reg.getRoleConfig("planner").model).toBe("claude-sonnet-4-6");
  });

  test("test_agent default model is claude-haiku-4-5-20251001", () => {
    const reg = new AgentRoleRegistry(REPO_ROOT);
    expect(reg.getRoleConfig("test_agent").model).toBe("claude-haiku-4-5-20251001");
  });

  test("env override LOCALSDLC_MODEL_SECURITY_REVIEWER overrides model", () => {
    process.env.LOCALSDLC_MODEL_SECURITY_REVIEWER = "claude-sonnet-4-6";
    const reg = new AgentRoleRegistry(REPO_ROOT);
    expect(reg.getRoleConfig("security_reviewer").model).toBe("claude-sonnet-4-6");
    delete process.env.LOCALSDLC_MODEL_SECURITY_REVIEWER;
  });

  test("env override LOCALSDLC_MODEL_PLANNER overrides model", () => {
    process.env.LOCALSDLC_MODEL_PLANNER = "claude-haiku-4-5-20251001";
    const reg = new AgentRoleRegistry(REPO_ROOT);
    expect(reg.getRoleConfig("planner").model).toBe("claude-haiku-4-5-20251001");
    delete process.env.LOCALSDLC_MODEL_PLANNER;
  });

  test("getRoleConfig for unknown role throws UnknownRoleError", () => {
    const reg = new AgentRoleRegistry(REPO_ROOT);
    expect(() => reg.getRoleConfig("nonexistent")).toThrow(UnknownRoleError);
  });

  test("all 8 prompt template files exist and contain {{handoff_context}}", () => {
    const reg = new AgentRoleRegistry(REPO_ROOT);
    for (const role of reg.listRoles()) {
      const config = reg.getRoleConfig(role);
      expect(config.promptContent).toContain("{{handoff_context}}");
    }
  });

  test("getRoleConfig returns promptPath that exists", () => {
    const { existsSync } = require("node:fs");
    const reg = new AgentRoleRegistry(REPO_ROOT);
    for (const role of reg.listRoles()) {
      expect(existsSync(reg.getRoleConfig(role).promptPath)).toBe(true);
    }
  });
});
