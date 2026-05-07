import { describe, test, expect } from "bun:test";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const CLI = resolve(process.cwd(), "src/cli/localsdlc.ts");

// ---------------------------------------------------------------------------
// CLI smoke tests — no API server required
// ---------------------------------------------------------------------------

describe("localsdlc CLI smoke tests", () => {
  test("--help exits 0 and lists all subcommands", () => {
    const result = spawnSync("bun", [CLI, "--help"], { encoding: "utf-8" });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("localsdlc");
    expect(result.stdout).toContain("init");
    expect(result.stdout).toContain("new");
    expect(result.stdout).toContain("status");
    expect(result.stdout).toContain("review");
    expect(result.stdout).toContain("approve");
    expect(result.stdout).toContain("merge");
    expect(result.stdout).toContain("export");
    expect(result.stdout).toContain("import-issue");
  });

  test("--version exits 0 and prints version", () => {
    const result = spawnSync("bun", [CLI, "--version"], { encoding: "utf-8" });
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toMatch(/^\d+\.\d+\.\d+$/);
  });

  test("init subcommand --help describes its purpose", () => {
    const result = spawnSync("bun", [CLI, "init", "--help"], { encoding: "utf-8" });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain(".work/");
  });

  test("unknown subcommand exits non-zero", () => {
    const result = spawnSync("bun", [CLI, "notacommand"], { encoding: "utf-8" });
    expect(result.status).not.toBe(0);
  });

  test("export --help shows --dry-run option", () => {
    const result = spawnSync("bun", [CLI, "export", "--help"], { encoding: "utf-8" });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("--dry-run");
  });

  test("import-issue --help shows <url> argument", () => {
    const result = spawnSync("bun", [CLI, "import-issue", "--help"], { encoding: "utf-8" });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("url");
  });
});

// ---------------------------------------------------------------------------
// API key hygiene: no direct Anthropic API key usage in non-test src/
// ---------------------------------------------------------------------------

describe("No API key usage in source", () => {
  test("src/ (excluding tests) has no direct Anthropic API key env access", () => {
    const pattern = "ANTHROP" + "IC_API_KEY";
    const result = spawnSync(
      "grep",
      ["-r", "--include=*.ts", "--exclude-dir=__tests__", "-l", pattern, "src/"],
      { encoding: "utf-8" }
    );
    const matchedFiles = result.stdout.trim();
    expect(matchedFiles).toBe("");
  });
});
