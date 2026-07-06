import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

/**
 * Cycle 11 D24-15 gate test (retargeted to EVOLVE.md after the RE-ENVISION
 * retirement).
 *
 * `scripts/validate-governance-currency.ts` enforces (second check,
 * GOV-CLI-COUNT-CACHED) that governance/EVOLVE.md — the unified interactive
 * governance-evolution engine — does not cache a hardcoded "<N> command(s)"
 * count on any "Current state:" line, file-wide. The engine generates its
 * "Current state:" lines at run time from templates; the only enumeration of
 * the CLI command surface is VISION §CLI Scope, and CLAUDE.md's architecture
 * table carries the aggregate count. A literal count in the static file drifts
 * against both — the Cycle-11 drift recorded "13 commands" while VISION listed
 * 14 bullets and CLAUDE.md declared 18. The gate keeps a count from silently
 * entering any "Current state:" line.
 *
 * Three assertions:
 *   1. The real shipped EVOLVE.md passes (exit 0, 0 errors) — no "Current
 *      state:" line caches a count.
 *   2. A synthetic governance tree whose EVOLVE.md caches "13 commands" on a
 *      "Current state:" line trips the gate (exit 1, GOV-CLI-COUNT-CACHED) —
 *      proving the gate catches a regression.
 *   3. A drift-proof "Current state:" line is NOT flagged, and a
 *      "<N> commands" phrase on a non-"Current state:" line is NOT flagged
 *      (scope is "Current state:" lines only).
 *
 * Subprocess form keeps every import inside `src/` (the script lives under
 * `scripts/`, outside tsconfig `rootDir: "src"`), so `tsc --noEmit` stays
 * clean. Mirrors `src/__tests__/governance/archive-path-currency-gate.test.ts`.
 */

const ROOT = resolve(import.meta.dirname, "..", "..", "..");
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

/**
 * Build a synthetic governance/EVOLVE.md under `dir`. The body carries one
 * clean "Current state:" line (no count) plus a parameterized "Current
 * state:" line under test; `extraTail` appends arbitrary trailing lines
 * (e.g. a non-"Current state:" line carrying a count).
 */
function writeEvolve(dir: string, currentStateUnderTest: string, extraTail = ""): string {
  const govDir = join(dir, "governance");
  mkdirSync(govDir, { recursive: true });
  const body = [
    "# Evolve",
    "",
    "> Last updated: 2026-07-06",
    "",
    "## Layer Scan",
    "",
    "Current state: VISION §Supported Platforms (3 adapters). Drift: none.",
    "",
    `Current state: ${currentStateUnderTest}`,
    "",
    extraTail,
    "",
  ].join("\n");
  writeFileSync(join(govDir, "EVOLVE.md"), body, "utf-8");
  return "governance/EVOLVE.md";
}

// Privatization gate: governance/EVOLVE.md is private overlay IP, gitignored
// and absent in public CI / contributor clones. Skip the real-repo assertion when
// it is absent (mirrors validate-governance-total.test.ts's "skips clean when the
// CONSTITUTION is absent (private-corpus public CI)" contract); the two synthetic
// gate tests below build their own EVOLVE.md and stay fully effective. The
// real-repo assertion runs unchanged wherever the file is present.
const EVOLVE_PRESENT = existsSync(resolve(ROOT, "governance", "EVOLVE.md"));

describe("validate-governance-currency CLI-count gate (Cycle 11 D24-15)", () => {
  it.skipIf(!EVOLVE_PRESENT)("the real shipped EVOLVE.md caches no CLI count on any Current state: line", () => {
    const { result, exitCode, stderr } = runGate(ROOT);
    const cliCountErrors = result.drifts.filter((d) => d.code === "GOV-CLI-COUNT-CACHED");
    expect(cliCountErrors, `GOV-CLI-COUNT-CACHED hits:\n${stderr}`).toHaveLength(0);
    // The whole gate is green on the real repo (no other currency drift either).
    expect(exitCode).toBe(0);
    expect(result.scannedFiles).toBeGreaterThan(0);
  });

  it("flags a Current state: line that caches a hardcoded '13 commands' count", () => {
    const dir = mkdtempSync(join(tmpdir(), "h3-d2415-"));
    try {
      const rel = writeEvolve(
        dir,
        "VISION §CLI Scope (generator vs runtime boundary, 13 commands). Drift: L1 IDs.",
      );
      const { result, exitCode } = runGate(dir);
      expect(exitCode).toBe(1);
      const hit = result.drifts.find((d) => d.code === "GOV-CLI-COUNT-CACHED");
      expect(hit).toBeDefined();
      expect(hit?.level).toBe("error");
      expect(hit?.file).toBe(rel);
      // The parameterized "Current state:" line sits at line 9 in the
      // synthetic body (the clean line at line 7 is not flagged).
      expect(hit?.line).toBe(9);
      expect(hit?.message).toContain("13 commands");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("does not flag drift-proof phrasing, nor a count on a non-Current-state line", () => {
    const dir = mkdtempSync(join(tmpdir(), "h3-d2415-"));
    try {
      writeEvolve(
        dir,
        "VISION §CLI Scope (generator vs runtime boundary, the CLI command surface enumerated in VISION §CLI Scope). Drift: L1 IDs.",
        // A "14 commands" phrase on a line that is not a "Current state:" line
        // must NOT trip the gate — the check is scoped to "Current state:"
        // lines only, even though it scans the whole file.
        "## Notes\nNote: some other section once mentioned 14 commands historically.",
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
