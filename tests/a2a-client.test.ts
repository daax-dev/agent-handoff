import { describe, test, expect, beforeEach, mock } from "bun:test";
import { registerAgent, getRegisteredAgents, getRegisteredAgent, clearCardCache } from "../src/a2a/agent-card.js";
import type { AgentCard } from "../src/a2a/types.js";

// Track registered agents across tests - we can't clear registeredAgents directly
// so tests must account for cumulative state or use unique URLs
describe("A2A Agent Card", () => {
  beforeEach(() => {
    clearCardCache();
  });

  test("registerAgent and getRegisteredAgents roundtrip", () => {
    const card: AgentCard = {
      name: "Test Agent",
      url: "https://test-roundtrip.example.com",
      description: "A test agent",
      skills: [{ id: "research", name: "Research", description: "Web research" }],
    };
    registerAgent(card);
    const agents = getRegisteredAgents();
    const found = agents.find((a) => a.url === "https://test-roundtrip.example.com");
    expect(found).toBeDefined();
    expect(found!.name).toBe("Test Agent");
    expect(found!.url).toBe("https://test-roundtrip.example.com");
  });

  test("registerAgent overwrites by URL", () => {
    const card1: AgentCard = { name: "Agent v1", url: "https://overwrite-test.example.com" };
    const card2: AgentCard = { name: "Agent v2", url: "https://overwrite-test.example.com" };
    registerAgent(card1);
    registerAgent(card2);
    const agents = getRegisteredAgents();
    const matching = agents.filter((a) => a.url === "https://overwrite-test.example.com");
    expect(matching).toHaveLength(1);
    expect(matching[0].name).toBe("Agent v2");
  });
  test("registerAgent stores auth headers", () => {
    const card: AgentCard = {
      name: "Auth Agent",
      url: "https://auth-test.example.com",
      authHeaders: { Authorization: "Bearer tok_123" },
    };
    registerAgent(card);
    const found = getRegisteredAgent("https://auth-test.example.com");
    expect(found).toBeDefined();
    expect(found!.authHeaders).toEqual({ Authorization: "Bearer tok_123" });
  });

  test("registerAgent stores custom auth headers", () => {
    const card: AgentCard = {
      name: "API Key Agent",
      url: "https://apikey-test.example.com",
      authHeaders: { "X-API-Key": "key_abc", "X-Org-Id": "org_456" },
    };
    registerAgent(card);
    const found = getRegisteredAgent("https://apikey-test.example.com");
    expect(found!.authHeaders).toEqual({ "X-API-Key": "key_abc", "X-Org-Id": "org_456" });
  });
});

describe("A2A Client", () => {
  test("sendMessage constructs correct JSON-RPC request", async () => {
    const originalFetch = globalThis.fetch;
    let capturedBody: any;

    globalThis.fetch = mock(async (url: string | URL | Request, init: any) => {
      capturedBody = JSON.parse(init.body);
      return new Response(JSON.stringify({
        jsonrpc: "2.0",
        id: capturedBody.id,
        result: { id: "task-123", status: "submitted" },
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }) as any;

    try {
      const { sendMessage } = await import("../src/a2a/client.js");
      const task = await sendMessage("https://agent.example.com", "Do research");

      expect(capturedBody.jsonrpc).toBe("2.0");
      expect(capturedBody.method).toBe("message/send");
      expect(capturedBody.params.message.role).toBe("user");
      expect(capturedBody.params.message.parts[0].text).toBe("Do research");
      expect(task.id).toBe("task-123");
      expect(task.status).toBe("submitted");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("sendMessage includes auth headers when provided", async () => {
    const originalFetch = globalThis.fetch;
    let capturedHeaders: Record<string, string> = {};

    globalThis.fetch = mock(async (_url: string | URL | Request, init: any) => {
      capturedHeaders = init.headers;
      const body = JSON.parse(init.body);
      return new Response(JSON.stringify({
        jsonrpc: "2.0",
        id: body.id,
        result: { id: "task-456", status: "submitted" },
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }) as any;

    try {
      const { sendMessage } = await import("../src/a2a/client.js");
      await sendMessage("https://auth-agent.example.com", "Do work", {
        authHeaders: { Authorization: "Bearer secret_token", "X-Custom": "value" },
      });

      expect(capturedHeaders["Content-Type"]).toBe("application/json");
      expect(capturedHeaders["Authorization"]).toBe("Bearer secret_token");
      expect(capturedHeaders["X-Custom"]).toBe("value");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
