import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

/**
 * D3-SA3.5-06 gate test — deferred coverage-floor raise tracking.
 *
 * `scripts/validate-governance-currency.ts` carries a structured
 * `DEFERRED_RAISES` registry + `scanDeferredRaises()` so a deferred coverage
 * threshold raise (previously recorded only as bare prose in a vitest.config.ts
 * comment, which nothing re-reads) surfaces as a warning on every
 * `validate:efficiency` run until its row is removed (raise executed). This
 * pins that the mechanism emits one pending warning per registered raise, keeps
 * them warning-level (surfaced, never a hard fail), and does not affect the
 * gate's exit code.
 *
 * Subprocess form keeps every import inside `src/` (the script lives under
 * `scripts/`, outside tsconfig `rootDir: "src"`), so `tsc --noEmit` stays clean.
 * Mirrors `src/__tests__/governance/cli-count-currency-gate.test.ts`. The scan
 * is file-independent, so an empty `--root` (no governance files) isolates the
 * deferred-raise output from any real-repo currency drift.
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

describe("validate-governance-currency deferred-raise tracking (D3-SA3.5-06)", () => {
  it("surfaces one pending warning per registered deferred coverage-floor raise", () => {
    // Empty root: no governance files to scan, so the only output is the
    // file-independent deferred-raise carrier.
    const dir = mkdtempSync(join(tmpdir(), "h3-defraise-"));
    try {
      const { result, exitCode, stderr } = runGate(dir);
      const pending = result.drifts.filter((d) => d.code === "GOV-DEFERRED-RAISE-PENDING");

      // The two Cycle-11-queued raises are registered as the carrier the bare
      // vitest.config.ts comments were not.
      expect(pending.some((d) => d.message.includes("snapshot.ts")), stderr).toBe(true);
      expect(pending.some((d) => d.message.includes("pipelineContext.ts")), stderr).toBe(true);

      // Every pending raise is a surfaced warning against the pin's owning file,
      // never a hard error.
      expect(pending.length).toBeGreaterThanOrEqual(2);
      for (const d of pending) {
        expect(d.level).toBe("warning");
        expect(d.file).toBe("vitest.config.ts");
      }

      // Warnings surface but do not fail the gate (no governance error present).
      expect(result.errorCount).toBe(0);
      expect(exitCode).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
