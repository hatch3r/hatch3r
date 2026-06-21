import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

/**
 * Cycle 11 D10-31 gate test.
 *
 * `scripts/validate-archive-path-currency.ts` enforces that no doc under
 * `docs/` or `website/docs/` cites the non-existent `.hatch3r/archive/...`
 * path. The single source of truth for the tool-output archive directory is
 * `ARCHIVE_DIR` (`.hatch3r-archive`) in `src/types.ts`; `archiveToolOutputs`
 * writes to `<ARCHIVE_DIR>/<tool>/<timestamp>/`. The docs drifted to
 * `.hatch3r/archive/<tool>/` (slash, no timestamp), so the documented recovery
 * `mv` glob pointed at a path that does not exist. The D10-31 fix corrected the
 * docs and added this probe; the gate keeps the corrected docs from regressing.
 *
 * Three assertions:
 *   1. The real repo docs pass (exit 0, 0 errors) — every doc reference was
 *      corrected to the real `.hatch3r-archive` path with the timestamp level.
 *   2. A synthetic docs tree that cites `.hatch3r/archive/<tool>/` trips the
 *      gate (exit 1, ARCHIVE-PATH-DRIFT) — proving the gate catches a
 *      regression.
 *   3. A doc that uses the correct `.hatch3r-archive` path is NOT flagged (the
 *      correct path does not contain the forbidden substring).
 *
 * Subprocess form keeps every import inside `src/` (the script lives under
 * `scripts/`, outside tsconfig `rootDir: "src"`), so `tsc --noEmit` stays
 * clean. Mirrors `src/__tests__/governance/fanout-path-currency-gate.test.ts`.
 */

const ROOT = resolve(import.meta.dirname, "..", "..", "..");
const SCRIPT = resolve(ROOT, "scripts", "validate-archive-path-currency.ts");

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
    // Spawn node with the tsx loader directly (not the `.bin/tsx` POSIX shim,
    // which is not executable on Windows) — same pattern as
    // `src/__tests__/cli/topLevelErrorFunnel.test.ts`.
    stdout = execFileSync(process.execPath, ["--import", "tsx", SCRIPT, "--json", "--root", scanRoot], {
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

describe("validate-archive-path-currency gate (Cycle 11 D10-31)", () => {
  it("the real shipped docs carry no drifted .hatch3r/archive path", () => {
    const { result, exitCode, stderr } = runGate(ROOT);
    expect(result.errorCount, `archive-path-currency errors:\n${stderr}`).toBe(0);
    expect(exitCode).toBe(0);
    // docs/ + website/docs/ together hold a non-trivial number of .md files.
    expect(result.filesScanned).toBeGreaterThan(10);
  });

  it("flags a doc that cites the drifted .hatch3r/archive path", () => {
    const dir = mkdtempSync(join(tmpdir(), "h3-d1031-"));
    try {
      const docsDir = join(dir, "docs");
      mkdirSync(docsDir, { recursive: true });
      writeFileSync(
        join(docsDir, "recovery.md"),
        [
          "# Recovery",
          "",
          "Restore with `mv .hatch3r/archive/<tool>/* <target-dir>/`.",
          "",
        ].join("\n"),
        "utf-8",
      );
      const { result, exitCode } = runGate(dir);
      expect(exitCode).toBe(1);
      expect(result.errorCount).toBe(1);
      expect(result.findings[0].code).toBe("ARCHIVE-PATH-DRIFT");
      expect(result.findings[0].file).toBe("docs/recovery.md");
      expect(result.findings[0].line).toBe(3);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("does not flag the correct .hatch3r-archive path", () => {
    const dir = mkdtempSync(join(tmpdir(), "h3-d1031-"));
    try {
      const docsDir = join(dir, "website", "docs");
      mkdirSync(docsDir, { recursive: true });
      // The correct path uses a hyphen, not a slash — it must not match the
      // forbidden `.hatch3r/archive` substring.
      writeFileSync(
        join(docsDir, "ok.md"),
        [
          "# OK",
          "",
          "Outputs move to `.hatch3r-archive/<tool>/<timestamp>/` (inspection copy).",
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
