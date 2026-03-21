import type { AgentCard } from "./types.js";

const cardCache = new Map<string, AgentCard>();
const registeredAgents = new Map<string, AgentCard>();

export async function fetchAgentCard(baseUrl: string): Promise<AgentCard> {
  // Check cache first
  const cached = cardCache.get(baseUrl);
  if (cached) return cached;

  const url = baseUrl.replace(/\/$/, "") + "/.well-known/agent.json";

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);

  let response: Response;
  try {
    response = await fetch(url, { signal: controller.signal });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error(`Timed out fetching agent card from ${url}`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    throw new Error(`Failed to fetch agent card from ${url}: ${response.status} ${response.statusText}`);
  }

  const data = (await response.json()) as Record<string, unknown>;

  // Validate minimum required fields
  if (!data.name || typeof data.name !== "string") {
    throw new Error(`Invalid agent card from ${url}: missing 'name' field`);
  }

  const card: AgentCard = {
    name: data.name as string,
    description: data.description as string | undefined,
    url: baseUrl,
    provider: data.provider as string | undefined,
    version: data.version as string | undefined,
    skills: data.skills as AgentCard["skills"],
    securitySchemes: data.securitySchemes as Record<string, unknown> | undefined,
  };

  cardCache.set(baseUrl, card);
  return card;
}

export function registerAgent(card: AgentCard): void {
  registeredAgents.set(card.url, card);
}

export function getRegisteredAgents(): AgentCard[] {
  return Array.from(registeredAgents.values());
}

export function getRegisteredAgent(url: string): AgentCard | undefined {
  return registeredAgents.get(url);
}

export function clearCardCache(): void {
  cardCache.clear();
}
