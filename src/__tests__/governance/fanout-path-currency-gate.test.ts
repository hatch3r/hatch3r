import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

/**
 * Cycle 11 D7-32 gate test.
 *
 * `scripts/validate-fanout-path-currency.ts` enforces that no shipped artifact
 * (agent, skill, command, rule, hook, check) cites the framework-dev path
 * `.claude/rules/fan-out-discipline.md`. That mirror is not shipped to end-user
 * repos — adapters read the canonical runtime twin
 * `rules/hatch3r-fan-out-discipline.md` from the `rules/` tree — so a shipped
 * citation of the `.claude/` path dangles on the published surface
 * (D7-SA7.6-F3). The D7-32 fix rewrote all 28 such citations across 25 files to
 * the runtime path; this gate keeps the redirect from regressing.
 *
 * Three assertions:
 *   1. The real repo corpus passes (exit 0, 0 errors) — every shipped citation
 *      was redirected, and the one deliberate framework-dev meta-reference in
 *      `agents/hatch3r-creator.md` is opted out by the `framework-dev` cue.
 *   2. A synthetic content tree containing a shipped citation of the
 *      framework-dev path trips the gate (exit 1, FANOUT-PATH-FRAMEWORK-DEV) —
 *      proving the gate catches the regression if it returns.
 *   3. A line that mentions `framework-dev` on the same line as the path is a
 *      documented meta-reference and is NOT flagged (the opt-out cue).
 *
 * Subprocess form keeps every import inside `src/` (the script lives under
 * `scripts/`, outside tsconfig `rootDir: "src"`), so `tsc --noEmit` stays
 * clean. Mirrors `src/__tests__/governance/customize-doc-examples-gate.test.ts`.
 */

const ROOT = resolve(import.meta.dirname, "..", "..", "..");
const TSX = resolve(ROOT, "node_modules", ".bin", "tsx");
const SCRIPT = resolve(ROOT, "scripts", "validate-fanout-path-currency.ts");

interface GateResult {
  errorCount: number;
  warningCount: number;
  filesScanned: number;
  findings: Array<{ code: string; file: string; line?: number }>;
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

describe("validate-fanout-path-currency gate (Cycle 11 D7-32)", () => {
  it("the real shipped corpus carries no framework-dev fan-out-discipline path", () => {
    // Runs against the actual repo root, so it scans agents/ skills/ commands/
    // rules/ hooks/ checks/.
    const { result, exitCode, stderr } = runGate(ROOT);
    expect(result.errorCount, `fanout-path-currency errors:\n${stderr}`).toBe(0);
    expect(exitCode).toBe(0);
    // The shipped content surface is non-trivial, so the scan covers many files
    // (sanity bound, not an exact count that would churn on every new artifact).
    expect(result.filesScanned).toBeGreaterThan(100);
  });

  it("flags a shipped artifact that cites the framework-dev path", () => {
    const dir = mkdtempSync(join(tmpdir(), "h3-d732-"));
    try {
      const skillDir = join(dir, "skills", "hatch3r-example");
      mkdirSync(skillDir, { recursive: true });
      writeFileSync(
        join(skillDir, "SKILL.md"),
        [
          "# Example skill",
          "",
          "Fan out per the discipline.",
          "Source: `.claude/rules/fan-out-discipline.md` (P8 B2).",
          "",
        ].join("\n"),
        "utf-8",
      );
      const { result, exitCode } = runGate(dir);
      expect(exitCode).toBe(1);
      expect(result.errorCount).toBe(1);
      expect(result.findings[0].code).toBe("FANOUT-PATH-FRAMEWORK-DEV");
      expect(result.findings[0].file).toBe("skills/hatch3r-example/SKILL.md");
      expect(result.findings[0].line).toBe(4);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("does not flag a deliberate framework-dev meta-reference (opt-out cue)", () => {
    const dir = mkdtempSync(join(tmpdir(), "h3-d732-"));
    try {
      const agentDir = join(dir, "agents");
      mkdirSync(agentDir, { recursive: true });
      // A line that describes the non-shipped mirror deliberately cites the
      // `.claude/` path; the `framework-dev` cue on the line opts it out.
      writeFileSync(
        join(agentDir, "hatch3r-example.md"),
        [
          "# Example agent",
          "",
          "The framework-dev attestation rule (`.claude/rules/fan-out-discipline.md`)",
          "is not loaded in end-user contexts, so no proof-id is expected.",
          "",
        ].join("\n"),
        "utf-8",
      );
      const { result, exitCode } = runGate(dir);
      expect(exitCode).toBe(0);
      expect(result.errorCount).toBe(0);
      expect(result.filesScanned).toBe(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
