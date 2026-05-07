export interface SlotDef {
  name: string;
  maxTokens: number;
}

export const SLOTS: SlotDef[] = [
  { name: "taskSpec",           maxTokens: 2048 },
  { name: "diff",               maxTokens: 5120 },
  { name: "acceptanceCriteria", maxTokens: 1024 },
  { name: "blockingComments",   maxTokens: 512  },
  { name: "architectureContext",maxTokens: 1024 },
];

export const TOTAL_TOKEN_BUDGET = SLOTS.reduce((s, slot) => s + slot.maxTokens, 0);
// 2048 + 5120 + 1024 + 512 + 1024 = 9728
