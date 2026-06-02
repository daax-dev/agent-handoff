/**
 * SecretsScanner — content-based secret detection.
 *
 * Logic vendored and adapted from `@daax/secrets-guard`
 * (daax-dev/skills-marketplace, `tools/secrets-guard/src/scanner.ts`). The
 * upstream `scanContent` is `private` and redacts the matched value; this
 * adaptation exposes `scanContent` publicly and keeps the raw matched value so
 * that callers (agent-output inspection) can gate on and record the exact
 * finding. See `patterns.ts` for the vendored pattern definitions.
 */

import { allPatterns, type SecretCategory, type SecretPattern, type SecretSeverity } from "./patterns.js";

export interface SecretFinding {
  /** Pattern id that matched, e.g. "aws-access-key-id". */
  patternId: string;
  /** Human-readable pattern name. */
  patternName: string;
  /** Upstream category, e.g. "aws_credential". */
  category: SecretCategory;
  /** Severity of the matched pattern. */
  severity: SecretSeverity;
  /** Raw matched value (capture group 1 when present, else the full match). */
  match: string;
  /** 1-based line number of the match within the scanned content. */
  line: number;
  /** Shannon entropy of the matched value, when computed. */
  entropy?: number;
}

export interface ScanResult {
  findings: SecretFinding[];
  /** True if any finding has critical or high severity. */
  hasCritical: boolean;
}

export interface ScannerOptions {
  /** Override the pattern set (defaults to all built-in patterns). */
  patterns?: SecretPattern[];
  /** Disable entropy gating (defaults to enabled). */
  checkEntropy?: boolean;
}

/** Shannon entropy of a string, in bits per character. */
export function calculateEntropy(str: string): number {
  if (!str || str.length === 0) return 0;

  const charCounts = new Map<string, number>();
  for (const char of str) {
    charCounts.set(char, (charCounts.get(char) || 0) + 1);
  }

  let entropy = 0;
  const len = str.length;
  for (const count of charCounts.values()) {
    const freq = count / len;
    entropy -= freq * Math.log2(freq);
  }
  return entropy;
}

export class SecretsScanner {
  private readonly patterns: SecretPattern[];
  private readonly checkEntropy: boolean;

  constructor(options: ScannerOptions = {}) {
    this.patterns = options.patterns ?? allPatterns;
    this.checkEntropy = options.checkEntropy ?? true;
  }

  /**
   * Scan arbitrary content for secrets. `source` is a label used only for
   * diagnostics (it is not read from disk). Returns every match across all
   * enabled patterns. Never throws on malformed or partial input.
   */
  public scanContent(source: string, content: string): ScanResult {
    const findings: SecretFinding[] = [];
    if (typeof content !== "string" || content.length === 0) {
      return { findings, hasCritical: false };
    }
    void source;

    for (const pattern of this.patterns) {
      // Keyword precondition: at least one keyword must appear in the content.
      if (pattern.keywords && pattern.keywords.length > 0) {
        const lowered = content.toLowerCase();
        const hasKeyword = pattern.keywords.some((kw) => lowered.includes(kw.toLowerCase()));
        if (!hasKeyword) continue;
      }

      // Global regexes are stateful; reset before each scan.
      pattern.pattern.lastIndex = 0;

      let match: RegExpExecArray | null;
      let guard = 0;
      while ((match = pattern.pattern.exec(content)) !== null) {
        // Defensive: a zero-width match would loop forever; advance manually.
        if (match.index === pattern.pattern.lastIndex) {
          pattern.pattern.lastIndex++;
        }
        if (++guard > 10_000) break;

        const matchedValue = match[1] || match[0];
        if (!matchedValue) continue;

        let entropy: number | undefined;
        if (this.checkEntropy && pattern.entropyThreshold !== undefined) {
          entropy = calculateEntropy(matchedValue);
          if (entropy < pattern.entropyThreshold) continue;
        }

        const before = content.slice(0, match.index);
        const line = before.split("\n").length;

        findings.push({
          patternId: pattern.id,
          patternName: pattern.name,
          category: pattern.category,
          severity: pattern.severity,
          match: matchedValue,
          line,
          entropy,
        });
      }
      pattern.pattern.lastIndex = 0;
    }

    const hasCritical = findings.some((f) => f.severity === "critical" || f.severity === "high");
    return { findings, hasCritical };
  }
}
