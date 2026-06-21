import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

/**
 * Cycle 11 D16-1 (Critical, CI enforcement keystone) corpus gate.
 *
 * package.json `validate` chains 10 content/governance validators, but only 3
 * (rule-parity, wiring, specialist-roster) ran as CI steps — the rest
 * (efficiency, cli-skills, control-reachability, anti-slop, severity-vocabulary,
 * canonical, adapter-parity) ran in no workflow, so the invariant "the published
 * corpus passes its content and governance gates" was honor-system on PRs. The
 * Cycle 11 D16-1 CI fix adds a single
 * `npm run validate` umbrella step; this in-suite test gives the same
 * invariant a vitest assertion that fails locally and in `npm test` the moment
 * the real `commands/`, `rules/`, `agents/`, `skills/`, `hooks/`, `checks/`
 * corpus develops a canonical-read warning or an anti-slop hit.
 *
 * It value-asserts the two corpus-scanning gates programmatically rather than
 * shelling out to the full 8-gate `npm run validate` (which re-runs structural
 * gates already covered by their own dedicated tests and adds ~5s of subprocess
 * cost). Each gate is invoked as a node subprocess with the `tsx` loader
 * (`node --import tsx <script> --json`), so this test exercises the same code
 * path as the gate it backstops:
 *   - validate-canonical: strict-mode read of every published canonical content
 *     type from the bundled content root; 0 warnings is a release precondition.
 *   - validate-anti-slop:  whole-phrase wordlist scan of the user-facing
 *     surfaces (README/SECURITY/CONTRIBUTING/current CHANGELOG/manifest
 *     descriptions); 0 hits required.
 *
 * The subprocess form keeps every import inside `src/` (the scripts live under
 * `scripts/`, outside tsconfig `rootDir: "src"`), so `tsc --noEmit` stays
 * clean. Mirrors the subprocess convention in
 * `src/__tests__/cli/entrypoint.test.ts`.
 */

const ROOT = resolve(import.meta.dirname, "..", "..", "..");

interface ValidatorRun {
  /** Parsed `--json` payload from the validator. */
  result: { errorCount: number } & Record<string, unknown>;
  /** Process exit code: 0 on a clean corpus, non-zero on any error finding. */
  exitCode: number;
  /** Raw stderr, surfaced in assertion messages when a gate trips. */
  stderr: string;
}

/**
 * Run a validator script via the tsx loader with `--json` and return its
 * parsed result, exit code, and stderr. Throws only if the validator emits
 * no parseable JSON (a broken validator, distinct from a corpus failure).
 */
function runValidator(scriptRelPath: string): ValidatorRun {
  let stdout: string;
  let stderr = "";
  let exitCode = 0;
  try {
    // Spawn node with the tsx loader directly (not the `.bin/tsx` POSIX shim,
    // which is not executable on Windows) — same pattern as
    // `src/__tests__/cli/topLevelErrorFunnel.test.ts`.
    stdout = execFileSync(process.execPath, ["--import", "tsx", resolve(ROOT, scriptRelPath), "--json"], {
      cwd: ROOT,
      encoding: "utf-8",
      timeout: 60_000,
      env: { ...process.env, NODE_NO_WARNINGS: "1" },
    });
  } catch (err: unknown) {
    // A non-zero exit (error findings present) is an expected, assertable
    // outcome — the validator still prints its JSON to stdout before exiting 1.
    const e = err as { stdout?: string; stderr?: string; status?: number };
    stdout = e.stdout ?? "";
    stderr = e.stderr ?? "";
    exitCode = e.status ?? 1;
  }
  const result = JSON.parse(stdout) as ValidatorRun["result"];
  return { result, exitCode, stderr };
}

describe("Content + governance validation gate (Cycle 11 D16-1)", () => {
  it("canonical corpus reads strict-clean (0 warnings) across every published content type", () => {
    const { result, exitCode, stderr } = runValidator("scripts/validate-canonical.ts");
    // value-assert the invariant the umbrella gate enforces, not mere presence
    expect(result.errorCount, `validate-canonical errors:\n${stderr}`).toBe(0);
    expect(exitCode).toBe(0);
    // strict mode scans the published classes shipped in the npm package
    expect(result.checkedTypes).toBe(6);
  });

  it("anti-slop scan finds 0 hits across the user-facing surfaces", () => {
    const { result, exitCode, stderr } = runValidator("scripts/validate-anti-slop.ts");
    expect(result.errorCount, `validate-anti-slop hits:\n${stderr}`).toBe(0);
    expect(exitCode).toBe(0);
    // the surface list (README, SECURITY, CONTRIBUTING, CHANGELOG, two manifests)
    // is fully present in this repo layout, so all 6 are scanned
    expect(result.scannedSurfaces).toBe(6);
  });

  it("both corpus gates exit 0, proving the umbrella's content invariant holds", () => {
    const canonical = runValidator("scripts/validate-canonical.ts");
    const antiSlop = runValidator("scripts/validate-anti-slop.ts");
    expect({
      canonicalExit: canonical.exitCode,
      antiSlopExit: antiSlop.exitCode,
    }).toEqual({ canonicalExit: 0, antiSlopExit: 0 });
  });
});
