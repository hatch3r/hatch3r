import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

/**
 * Cycle 11 D10-10 gate test.
 *
 * `scripts/validate-customize-doc-examples.ts` enforces that every fenced
 * `yaml` block a documentation file introduces as a `.customize.yaml`
 * example declares only the four allowed override fields
 * {model, scope, description, enabled} — the set the runtime validator
 * (`src/cli/commands/validate.ts::validateCustomizeYaml`) accepts. Before
 * the D10-10 fix, the customization/model-selection guides opened those
 * examples with a redundant leading key (`agent:`/`skill:`/`rule:`/
 * `command:`) that trips an "unknown field" warning on copy-paste.
 *
 * Two assertions:
 *   1. The real repo corpus passes (exit 0, 0 errors) — the four guide
 *      examples were de-keyed, and the hook-definition yaml block in
 *      reference/hooks.md is correctly out of scope (no `.customize.yaml`
 *      lead-in), so it is not a false positive.
 *   2. A synthetic doc tree containing a leading-`agent:` example trips the
 *      gate (exit 1, CUSTOMIZE-DOC-UNKNOWN-FIELD) — proving the gate would
 *      catch the regression if it returned.
 *
 * Subprocess form keeps every import inside `src/` (the script lives under
 * `scripts/`, outside tsconfig `rootDir: "src"`), so `tsc --noEmit` stays
 * clean. Mirrors `src/__tests__/governance/content-validation-gate.test.ts`.
 */

const ROOT = resolve(import.meta.dirname, "..", "..", "..");
const TSX = resolve(ROOT, "node_modules", ".bin", "tsx");
const SCRIPT = resolve(ROOT, "scripts", "validate-customize-doc-examples.ts");

interface GateResult {
  errorCount: number;
  warningCount: number;
  checkedFiles: number;
  checkedBlocks: number;
  findings: Array<{ code: string; file: string; line: number }>;
}

function runGate(scanRoot: string): { result: GateResult; exitCode: number; stderr: string } {
  let stdout: string;
  let stderr = "";
  let exitCode = 0;
  try {
    stdout = execFileSync(TSX, [SCRIPT, "--json", "--root", scanRoot], {
      cwd: ROOT,
      encoding: "utf-8",
      timeout: 60_000,
      env: { ...process.env, NODE_NO_WARNINGS: "1" },
    });
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string; status?: number };
    stdout = e.stdout ?? "";
    stderr = e.stderr ?? "";
    exitCode = e.status ?? 1;
  }
  return { result: JSON.parse(stdout) as GateResult, exitCode, stderr };
}

describe("validate-customize-doc-examples gate (Cycle 11 D10-10)", () => {
  it("the real docs corpus exposes only allowed .customize.yaml fields", () => {
    // Runs against the actual repo root, so it scans docs/ and website/docs/.
    const { result, exitCode, stderr } = runGate(ROOT);
    expect(result.errorCount, `customize-doc-examples errors:\n${stderr}`).toBe(0);
    expect(exitCode).toBe(0);
    // The four guide examples (agents/skills/rules/commands) plus the two
    // model-selection examples are introduced by a `.customize.yaml` lead-in,
    // so at least the four canonical blocks are exercised, not zero.
    expect(result.checkedBlocks).toBeGreaterThanOrEqual(4);
  });

  it("flags a doc example that opens with a redundant leading key", () => {
    const dir = mkdtempSync(join(tmpdir(), "h3-d1010-"));
    try {
      const docsDir = join(dir, "docs");
      mkdirSync(docsDir, { recursive: true });
      writeFileSync(
        join(docsDir, "bad.md"),
        [
          "# Bad example",
          "",
          "Create `.hatch3r/agents/{agent-id}.customize.yaml`:",
          "",
          "```yaml",
          "agent: hatch3r-reviewer",
          "model: codex",
          "```",
          "",
        ].join("\n"),
        "utf-8",
      );
      const { result, exitCode } = runGate(dir);
      expect(exitCode).toBe(1);
      expect(result.errorCount).toBe(1);
      expect(result.findings[0].code).toBe("CUSTOMIZE-DOC-UNKNOWN-FIELD");
      expect(result.findings[0].file).toBe("docs/bad.md");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("does not flag a non-customize yaml block (hook-definition shape)", () => {
    const dir = mkdtempSync(join(tmpdir(), "h3-d1010-"));
    try {
      const docsDir = join(dir, "docs");
      mkdirSync(docsDir, { recursive: true });
      // A `type: hook` frontmatter example with no `.customize.yaml` lead-in
      // must be out of scope even though it carries an `agent:` key.
      writeFileSync(
        join(docsDir, "hooks.md"),
        [
          "## Canonical Location",
          "",
          "Hook definitions declare `agent` in frontmatter:",
          "",
          "```yaml",
          "---",
          "id: pre-commit-lint-fixer",
          "type: hook",
          "agent: lint-fixer",
          "---",
          "```",
          "",
          "Mentions `.customize.yaml` elsewhere so the file is scanned.",
          "",
        ].join("\n"),
        "utf-8",
      );
      const { result, exitCode } = runGate(dir);
      expect(exitCode).toBe(0);
      expect(result.errorCount).toBe(0);
      // File is scanned (it mentions `.customize.yaml`) but the yaml block is
      // not a customize example, so no block is checked.
      expect(result.checkedFiles).toBe(1);
      expect(result.checkedBlocks).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
