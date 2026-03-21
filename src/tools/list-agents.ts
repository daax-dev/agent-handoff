import { listCliAgents } from "../cli/registry.js";
import { getRegisteredAgents } from "../a2a/agent-card.js";
import { isTmuxAvailable } from "../cli/tmux-spawner.js";

export async function handleListAgents() {
  const cli = listCliAgents();
  const a2aCards = getRegisteredAgents();
  const tmuxAvailable = await isTmuxAvailable();
  const a2a = a2aCards.map((card) => ({
    name: card.name,
    url: card.url,
    description: card.description,
    skills: card.skills?.map((s: { name: string }) => s.name) ?? [],
  }));

  return {
    content: [{
      type: "text" as const,
      text: JSON.stringify({ cli, a2a, tmuxAvailable }, null, 2),
    }],
  };
}
