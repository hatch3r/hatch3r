import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

/**
 * Cycle 11 D24-15 gate test.
 *
 * `scripts/validate-governance-currency.ts` enforces (second check,
 * GOV-CLI-COUNT-CACHED) that RE-ENVISION.md's T8 "CLI Scope" sparring-theme row
 * does not cache a hardcoded "<N> command(s)" count in its "Current state:"
 * line. The only enumeration of the CLI command surface is VISION §CLI Scope;
 * CLAUDE.md's architecture table carries the aggregate count. A literal count
 * in T8 drifts against both — the Cycle-11 drift recorded "13 commands" while
 * VISION listed 14 bullets and CLAUDE.md declared 18. The D24-15 fix replaced
 * the literal with drift-proof phrasing and added this probe; the gate keeps
 * the count from silently re-entering the row.
 *
 * Three assertions:
 *   1. The real shipped RE-ENVISION.md passes (exit 0, 0 errors) — its T8 row
 *      uses drift-proof phrasing, no cached count.
 *   2. A synthetic governance tree whose T8 row caches "13 commands" trips the
 *      gate (exit 1, GOV-CLI-COUNT-CACHED) — proving the gate catches a
 *      regression.
 *   3. A synthetic T8 row with the drift-proof phrasing is NOT flagged, and a
 *      "<N> commands" phrase OUTSIDE the T8 block is NOT flagged (scope is the
 *      T8 "Current state:" line only).
 *
 * Subprocess form keeps every import inside `src/` (the script lives under
 * `scripts/`, outside tsconfig `rootDir: "src"`), so `tsc --noEmit` stays
 * clean. Mirrors `src/__tests__/governance/archive-path-currency-gate.test.ts`.
 */

const ROOT = resolve(import.meta.dirname, "..", "..", "..");
const TSX = resolve(ROOT, "node_modules", ".bin", "tsx");
const SCRIPT = resolve(ROOT, "scripts", "validate-governance-currency.ts");

interface GateDrift {
  file: string;
  line?: number;
  level: "error" | "warning";
  code: string;
  message: string;
}
interface GateResult {
  drifts: GateDrift[];
  scannedFiles: number;
  errorCount: number;
  warningCount: number;
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

/** Build a synthetic governance/RE-ENVISION.md under `dir` with a given T8 row. */
function writeReEnvision(dir: string, t8CurrentState: string, extraTail = ""): string {
  const govDir = join(dir, "governance");
  mkdirSync(govDir, { recursive: true });
  const body = [
    "# Re-Envision",
    "",
    "> Last updated: 2026-06-09",
    "",
    "### T7. Platform Strategy | L1 | direct-edit VISION",
    "Current state: VISION §Supported Platforms (3 adapters). Drift: L1 IDs.",
    "",
    "### T8. CLI Scope | L1 | direct-edit VISION",
    `Current state: ${t8CurrentState}`,
    "",
    "### T9. Learning System Vision | L1 | direct-edit VISION",
    "Current state: VISION §Learning. Drift: L1 IDs.",
    extraTail,
    "",
  ].join("\n");
  writeFileSync(join(govDir, "RE-ENVISION.md"), body, "utf-8");
  return "governance/RE-ENVISION.md";
}

describe("validate-governance-currency CLI-count gate (Cycle 11 D24-15)", () => {
  it("the real shipped RE-ENVISION.md caches no CLI count in its T8 row", () => {
    const { result, exitCode, stderr } = runGate(ROOT);
    const cliCountErrors = result.drifts.filter((d) => d.code === "GOV-CLI-COUNT-CACHED");
    expect(cliCountErrors, `GOV-CLI-COUNT-CACHED hits:\n${stderr}`).toHaveLength(0);
    // The whole gate is green on the real repo (no other currency drift either).
    expect(exitCode).toBe(0);
    expect(result.scannedFiles).toBeGreaterThan(0);
  });

  it("flags a T8 row that caches a hardcoded '13 commands' count", () => {
    const dir = mkdtempSync(join(tmpdir(), "h3-d2415-"));
    try {
      const rel = writeReEnvision(
        dir,
        "VISION §CLI Scope (generator vs runtime boundary, 13 commands). Drift: L1 IDs.",
      );
      const { result, exitCode } = runGate(dir);
      expect(exitCode).toBe(1);
      const hit = result.drifts.find((d) => d.code === "GOV-CLI-COUNT-CACHED");
      expect(hit).toBeDefined();
      expect(hit?.level).toBe("error");
      expect(hit?.file).toBe(rel);
      // T8 "Current state:" line sits at line 9 in the synthetic body.
      expect(hit?.line).toBe(9);
      expect(hit?.message).toContain("13 commands");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("does not flag drift-proof phrasing, nor a count outside the T8 block", () => {
    const dir = mkdtempSync(join(tmpdir(), "h3-d2415-"));
    try {
      writeReEnvision(
        dir,
        "VISION §CLI Scope (generator vs runtime boundary, the CLI command surface enumerated in VISION §CLI Scope). Drift: L1 IDs.",
        // A "14 commands" phrase in a later, unrelated theme line must NOT trip
        // the gate — the check is scoped to the T8 "Current state:" line only.
        "### T15. Misc | L1\nNote: some other section once mentioned 14 commands historically.",
      );
      const { result, exitCode } = runGate(dir);
      const cliCountHits = result.drifts.filter((d) => d.code === "GOV-CLI-COUNT-CACHED");
      expect(cliCountHits).toHaveLength(0);
      expect(exitCode).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
