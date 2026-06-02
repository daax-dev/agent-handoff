import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { inspectOutput, redactSecretsFrom } from "./inspect-output.js";

describe("inspectOutput — secret gate", () => {
  test("fires on AWS key", () => {
    const result = inspectOutput("AKIAIOSFODNN7EXAMPLE rest of output", null);
    expect(result.secretsFound).toBe(true);
    expect(result.findings[0]!.category).toBe("aws");
    expect(result.findings[0]!.match).toContain("AKIAIOSFODNN7EXAMPLE");
  });

  test("clean output yields no findings", () => {
    const result = inspectOutput("Task completed successfully with no secrets", null);
    expect(result.secretsFound).toBe(false);
    expect(result.findings.length).toBe(0);
  });

  test("partial stdout does not throw", () => {
    const result = inspectOutput("AKIA partial line cut off mid", null);
    expect(typeof result.secretsFound).toBe("boolean");
  });

  test("detects unencrypted PKCS#8 private key", () => {
    const pem = "-----BEGIN PRIVATE KEY-----\nMIIBVgIBADANBgkqhkiG9w0\n-----END PRIVATE KEY-----";
    const result = inspectOutput(pem, null);
    expect(result.secretsFound).toBe(true);
    expect(result.findings.some((f) => f.category === "private_key")).toBe(true);
  });

  test("detects modern OpenAI project key (sk-proj-)", () => {
    // Assembled at runtime so no full secret literal is committed (push protection).
    const key = ["sk", "proj", "abcdefghijklmnopqrstuvwxyz0123"].join("-");
    const result = inspectOutput(`key ${key} end`, null);
    expect(result.secretsFound).toBe(true);
    expect(result.findings[0]!.category).toBe("api_key");
  });

  test("detects a standalone Bearer token", () => {
    const token = "abcdefghijklmnopqrstuvwxyz123456";
    const result = inspectOutput(`auth header: Bearer ${token}`, null);
    expect(result.secretsFound).toBe(true);
    expect(redactSecretsFrom(`Bearer ${token}`, result.findings)).not.toContain(token);
  });

  test("captures the FULL three-part Slack token (so redaction is complete)", () => {
    // Assembled at runtime so no full secret literal is committed (push protection).
    const token = ["xoxb", "1234567890", "1234567890", "abcdefghijklmnopqrstuvwx"].join("-");
    const result = inspectOutput(`slack ${token} here`, null);
    expect(result.secretsFound).toBe(true);
    expect(result.findings[0]!.match).toBe(token);
    expect(redactSecretsFrom(`slack ${token} here`, result.findings)).not.toContain("xoxb-");
  });
});

describe("inspectOutput — phrase gate", () => {
  test("fires on self-reported completion", () => {
    expect(inspectOutput("I've completed the task", null).claimsCompletion).toBe(true);
  });

  test("clean status does not fire", () => {
    expect(inspectOutput("The build passed all checks", null).claimsCompletion).toBe(false);
  });

  test("auxSecretText is excluded from the phrase gate", () => {
    const result = inspectOutput("clean agent output", null, "tool stderr: Done!");
    expect(result.claimsCompletion).toBe(false);
  });
});

describe("inspectOutput — auxSecretText (stderr) secret scan", () => {
  test("a secret present only in auxSecretText is detected", () => {
    const result = inspectOutput("clean stdout", null, "stderr: AKIAIOSFODNN7EXAMPLE");
    expect(result.secretsFound).toBe(true);
    expect(result.findings[0]!.category).toBe("aws");
  });
});

describe("redactSecretsFrom", () => {
  test("replaces each detected secret with a category placeholder", () => {
    const { findings } = inspectOutput("AKIAIOSFODNN7EXAMPLE", null);
    const redacted = redactSecretsFrom("prefix AKIAIOSFODNN7EXAMPLE suffix", findings)!;
    expect(redacted).not.toContain("AKIAIOSFODNN7EXAMPLE");
    expect(redacted).toContain("«redacted:aws»");
  });

  test("returns input unchanged when there are no findings", () => {
    expect(redactSecretsFrom("nothing secret here", [])).toBe("nothing secret here");
  });
});

describe("inspectOutput — token extraction", () => {
  const ENV_KEYS = ["DAAX_COST_INPUT_PER_MILLION", "DAAX_COST_OUTPUT_PER_MILLION"] as const;
  let saved: Record<string, string | undefined>;

  beforeEach(() => {
    saved = {};
    for (const k of ENV_KEYS) {
      saved[k] = process.env[k];
      process.env[k] = "1";
    }
  });

  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  test("extracts valid usage and computes positive cost with no NaN", () => {
    const result = inspectOutput("done", { usage: { input_tokens: 100, output_tokens: 50 } });
    expect(result.tokens).not.toBeNull();
    expect(result.tokens!.input).toBe(100);
    expect(result.tokens!.output).toBe(50);
    expect(result.tokens!.costUsd).toBeGreaterThan(0);
    expect(Number.isNaN(result.tokens!.costUsd)).toBe(false);
  });

  test("null usage yields null tokens with no NaN/undefined", () => {
    const result = inspectOutput("done", null);
    expect(result.tokens).toBeNull();
  });
});
