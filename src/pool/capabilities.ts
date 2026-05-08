export function normalizeCapabilities(capabilities: string[] | undefined): string[] {
  if (!capabilities) return [];

  const seen = new Set<string>();
  const normalized: string[] = [];

  for (const capability of capabilities) {
    const token = capability.trim().toLowerCase();
    if (!token || seen.has(token)) continue;
    seen.add(token);
    normalized.push(token);
  }

  return normalized;
}

export function workerMatchesRequiredCapabilities(
  workerCapabilities: string[] | undefined,
  requiredCapabilities: string[] | undefined,
): boolean {
  if (!requiredCapabilities || requiredCapabilities.length === 0) return true;

  const workerSet = new Set(workerCapabilities ?? []);
  return requiredCapabilities.every((required) => workerSet.has(required));
}
