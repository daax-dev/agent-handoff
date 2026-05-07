export interface McpResponse {
  content: { type: "text"; text: string }[];
  isError?: boolean;
  [key: string]: unknown;
}

export function mcpText(data: unknown): McpResponse {
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
}

export function mcpError(data: unknown): McpResponse {
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }], isError: true };
}
