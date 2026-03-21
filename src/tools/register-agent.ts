import { fetchAgentCard, registerAgent } from "../a2a/agent-card.js";
import { logHandoffEvent } from "../utils/logger.js";
import type { RegisterAgentInput } from "../types.js";

export async function handleRegisterAgent(args: RegisterAgentInput) {
  const card = await fetchAgentCard(args.url);

  // Attach auth headers if provided
  if (args.authToken) {
    card.authHeaders = { Authorization: `Bearer ${args.authToken}` };
  } else if (args.authHeaders) {
    card.authHeaders = args.authHeaders;
  }

  registerAgent(card);

  logHandoffEvent({
    timestamp: new Date().toISOString(),
    event: "agent_registered",
    agentUrl: card.url,
    agent: card.name,
  });

  return {
    content: [{
      type: "text" as const,
      text: JSON.stringify({
        registered: true,
        name: card.name,
        url: card.url,
        description: card.description,
        skills: card.skills?.map((s: { name: string }) => s.name) ?? [],
        authenticated: !!(card.authHeaders),
      }, null, 2),
    }],
  };
}
