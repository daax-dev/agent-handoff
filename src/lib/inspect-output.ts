/**
 * inspectOutput — post-execution inspection of agent output.
 *
 * Three independent gates, run after an agent finishes but before a job is
 * recorded as `completed`:
 *   1. Secret gate   — scans stdout for leaked credentials (SecretsScanner).
 *   2. Phrase gate   — detects natural-language self-reported completion.
 *   3. Token extract — reads usage from structured output, computes cost.
 *
 * Pricing is configurable via env vars and is intentionally NOT model-specific;
 * callers that need accurate cost must set the rates for the model they ran.
 */

import { SecretsScanner } from "./secrets/scanner.js";

export interface Finding {
  /** Normalized short category, e.g. "aws", "github", "api_key". */
  category: string;
  /** Pattern id that matched, e.g. "aws-access-key-id". */
  patternId: string;
  /** Raw matched value. */
  match: string;
  /** Severity of the matched pattern. */
  severity: string;
  /** 1-based line number within the scanned output. */
  line: number;
}

/**
 * A finding as recorded on a job / surfaced through the API. The raw matched
 * value is intentionally absent — only a non-recoverable redacted preview is
 * kept, so a stored job never retains the leaked credential.
 */
export interface StoredFinding {
  category: string;
  patternId: string;
  severity: string;
  line: number;
  matchRedacted: string;
}

export interface TokenUsage {
  input: number;
  output: number;
  costUsd: number;
}

export interface InspectResult {
  secretsFound: boolean;
  findings: Finding[];
  claimsCompletion: boolean;
  tokens: TokenUsage | null;
}

/**
 * Forbidden phrases that indicate an agent self-reporting completion in natural
 * language rather than via a verifiable signal. Matched case-insensitively.
 */
export const FORBIDDEN_COMPLETION_PHRASES: readonly string[] = [
  "I have completed",
  "I've completed",
  "I've finished",
  "Done!",
  "I've successfully",
];

/**
 * Generic, non-model-specific fallback price (USD per million tokens). Used only
 * when the corresponding env var is unset or unparseable. Kept > 0 so that a
 * known token count always yields a positive (if approximate) cost estimate.
 */
const DEFAULT_PRICE_PER_MILLION = 1;

const scanner = new SecretsScanner();

/** Strip credential-type suffixes so categories read as short labels. */
function normalizeCategory(category: string): string {
  return category
    .replace(/_credential$/, "")
    .replace(/_token$/, "");
}

/** Parse a per-million price env var, falling back to a safe positive default. */
function priceFromEnv(name: string): number {
  const raw = process.env[name];
  if (raw === undefined) return DEFAULT_PRICE_PER_MILLION;
  const parsed = Number.parseFloat(raw);
  if (!Number.isFinite(parsed) || parsed < 0) return DEFAULT_PRICE_PER_MILLION;
  return parsed;
}

function toNonNegativeInt(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return null;
  return Math.floor(value);
}

/**
 * Extract token usage from an agent's structured output. Returns `null` when no
 * `usage` object with numeric token counts is present. Never returns NaN.
 */
export function extractTokens(structured: unknown): TokenUsage | null {
  const usage = (structured as { usage?: unknown } | null | undefined)?.usage;
  if (!usage || typeof usage !== "object") return null;

  const input = toNonNegativeInt((usage as { input_tokens?: unknown }).input_tokens);
  const output = toNonNegativeInt((usage as { output_tokens?: unknown }).output_tokens);
  if (input === null && output === null) return null;

  const inTokens = input ?? 0;
  const outTokens = output ?? 0;
  const costUsd =
    (inTokens / 1_000_000) * priceFromEnv("DAAX_COST_INPUT_PER_MILLION") +
    (outTokens / 1_000_000) * priceFromEnv("DAAX_COST_OUTPUT_PER_MILLION");

  return { input: inTokens, output: outTokens, costUsd };
}

/** Redact a matched secret to a short, non-recoverable preview. */
export function redactMatch(match: string): string {
  if (typeof match !== "string" || match.length === 0) return "";
  if (match.length <= 4) return "*".repeat(match.length);
  return `${match.slice(0, 4)}${"*".repeat(Math.min(match.length - 4, 12))}`;
}

/** Convert a Finding (with raw match) into a StoredFinding (redacted, no raw value). */
export function toStoredFinding(f: Finding): StoredFinding {
  return {
    category: f.category,
    patternId: f.patternId,
    severity: f.severity,
    line: f.line,
    matchRedacted: redactMatch(f.match),
  };
}

/**
 * Replace every detected secret value in `text` with a category-labelled
 * placeholder. Used to scrub stored stdout/stderr on a secret-blocked job so the
 * raw credential is never persisted or surfaced through the API.
 */
export function redactSecretsFrom(text: string | undefined, findings: Finding[]): string | undefined {
  if (typeof text !== "string" || text.length === 0) return text;
  let out = text;
  for (const f of findings) {
    if (!f.match) continue;
    out = out.split(f.match).join(`«redacted:${f.category}»`);
  }
  return out;
}

/** True if `text` contains any forbidden self-completion phrase. */
export function claimsCompletion(text: string): boolean {
  if (typeof text !== "string" || text.length === 0) return false;
  const lowered = text.toLowerCase();
  return FORBIDDEN_COMPLETION_PHRASES.some((phrase) => lowered.includes(phrase.toLowerCase()));
}

/**
 * Inspect an agent's raw text output and structured output. Pure and total:
 * never throws on partial or malformed input.
 *
 * `auxSecretText` (e.g. stderr) is included in the secret scan only — it does
 * NOT participate in the completion-phrase gate, since a tool writing "Done!"
 * to stderr must not be mistaken for the agent self-reporting completion.
 */
export function inspectOutput(
  text: string,
  structured: unknown,
  auxSecretText?: string,
): InspectResult {
  const safeText = typeof text === "string" ? text : "";
  const aux = typeof auxSecretText === "string" && auxSecretText.length > 0 ? auxSecretText : "";
  const secretScanInput = aux ? `${safeText}\n${aux}` : safeText;

  const scan = scanner.scanContent("agent-output", secretScanInput);
  const findings: Finding[] = scan.findings.map((f) => ({
    category: normalizeCategory(f.category),
    patternId: f.patternId,
    match: f.match,
    severity: f.severity,
    line: f.line,
  }));

  return {
    secretsFound: findings.length > 0,
    findings,
    claimsCompletion: claimsCompletion(safeText),
    tokens: extractTokens(structured),
  };
}
