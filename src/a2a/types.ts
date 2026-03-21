export interface AgentCard {
  name: string;
  description?: string;
  url: string;
  provider?: string;
  version?: string;
  skills?: AgentSkill[];
  securitySchemes?: Record<string, unknown>;
  /** Auth headers to include in A2A requests to this agent */
  authHeaders?: Record<string, string>;
}

export interface AgentSkill {
  id: string;
  name: string;
  description?: string;
}

export type A2ATaskStatus = "submitted" | "working" | "input-required" | "completed" | "failed" | "canceled";

export interface A2ATask {
  id: string;
  status: A2ATaskStatus;
  messages?: A2AMessage[];
  artifacts?: A2AArtifact[];
  error?: { code: number; message: string; data?: unknown };
}

export interface A2AMessage {
  role: "user" | "agent";
  parts: A2APart[];
}

export type A2APart =
  | { type: "text"; text: string }
  | { type: "data"; data: Record<string, unknown> };

export interface A2AArtifact {
  name?: string;
  description?: string;
  parts: A2APart[];
}

export interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: number | string;
  method: string;
  params?: Record<string, unknown>;
}

export interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: number | string;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}
