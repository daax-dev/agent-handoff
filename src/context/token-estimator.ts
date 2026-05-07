// Token estimator: chars / 4 (industry-standard approximation).
// No external tokenizer dependency.

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export function truncateToTokens(
  text: string,
  maxTokens: number,
  ref?: string
): { text: string; truncated: boolean } {
  const maxChars = maxTokens * 4;
  if (text.length <= maxChars) return { text, truncated: false };

  // Truncate at word boundary
  const suffix = ref
    ? `\n[truncated — full content at ${ref}]`
    : "\n[truncated]";
  const available = maxChars - suffix.length;
  const cut = text.slice(0, available);
  const lastSpace = cut.lastIndexOf(" ");
  const safe = lastSpace > 0 ? cut.slice(0, lastSpace) : cut;

  return { text: safe + suffix, truncated: true };
}
