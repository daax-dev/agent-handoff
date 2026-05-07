export interface HITLConfig {
  enabled: boolean;
  gatedTriggers: string[];
}

export function getHITLConfig(): HITLConfig {
  const enabled = process.env.LOCALSDLC_HITL_ENABLED !== "false";
  return {
    enabled,
    gatedTriggers: ["approve", "merge", "escalated"],
  };
}
