import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * D8-1 (Cycle 11 Wave 2, P1): the top-level CLI catch in `src/cli/index.ts`
 * must route caught failures through the single error funnel
 * `src/cli/shared/errors.ts` (`formatActionableError` + `writeFormattedCliError`).
 *
 * The audit found the funnel orphaned: its only importers were tests, while
 * the live catch surfaced ONLY `err.recoveryHint` and never the
 * errorCode-keyed `DEFAULT_RECOVERY_HINT` floor. The result was that the 53%
 * of fatal HatchErrors with no explicit hint (28 of 53) exited silently —
 * defeating the very floor the same cycle had added (`SA12.1-F01`).
 *
 * This suite asserts the fix from two angles:
 *   1. A subprocess proof — spawning the funnel on a hint-less FS_ERROR and
 *      asserting the floor recovery hint reaches stderr with the sysexits.h
 *      FS_ERROR exit code (74). This is the literal remediation the finding
 *      calls for ("spawn the CLI on a hint-less FS_ERROR asserting a recovery
 *      hint on stderr") and exercises the real funnel as a child process.
 *   2. A static wiring guard — reading `src/cli/index.ts` and asserting the
 *      catch imports AND invokes the funnel, so the funnel can never be
 *      re-orphaned (the exact D8-1 regression) without this test failing.
 */

const REPO_ROOT = resolve(import.meta.dirname, "../../..");
const ERRORS_SRC = resolve(REPO_ROOT, "src/cli/shared/errors.ts");
const TYPES_SRC = resolve(REPO_ROOT, "src/types.ts");
const INDEX_SRC = resolve(REPO_ROOT, "src/cli/index.ts");

// The subprocess runs the TypeScript source via the `tsx` loader, so it does
// NOT depend on a fresh `dist/` build (which is built by the CI matrix but is
// absent / stale on a local checkout). Skip cleanly with an actionable message
// if `tsx` is not resolvable instead of producing an opaque spawn failure.
let HAS_TSX = true;
try {
  import.meta.resolve("tsx");
} catch {
  HAS_TSX = false;
  console.warn(
    "[topLevelErrorFunnel.test] Skipping subprocess funnel proof: `tsx` is not resolvable. Run `npm ci` to install dev dependencies.",
  );
}

/**
 * Spawn a short ESM script through the `tsx` loader that drives the funnel
 * exactly as the top-level catch does — `formatActionableError(err)` followed
 * by `writeFormattedCliError(formatted)` — and exits with `formatted.exitCode`.
 * Returns the captured stderr and the process exit code.
 */
function runFunnelSubprocess(script: string): { stderr: string; exitCode: number } {
  try {
    execFileSync("node", ["--import", "tsx", "--input-type=module", "-e", script], {
      cwd: REPO_ROOT,
      encoding: "utf-8",
      timeout: 20_000,
      env: { ...process.env, NODE_NO_WARNINGS: "1", FORCE_COLOR: "0", NO_COLOR: "1" },
    });
    return { stderr: "", exitCode: 0 };
  } catch (err: unknown) {
    const e = err as { stderr?: string; status?: number };
    return { stderr: e.stderr ?? "", exitCode: e.status ?? 1 };
  }
}

describe.skipIf(!HAS_TSX)("top-level CLI error funnel (D8-1) — subprocess proof", () => {
  it("surfaces the DEFAULT_RECOVERY_HINT floor on stderr for a hint-less FS_ERROR (exit 74)", () => {
    // A hint-less FS_ERROR is the canonical 53%-miss case: no explicit
    // recoveryHint, so before D8-1 the live catch exited silently. The funnel
    // must now box the errorCode-keyed FS_ERROR floor hint to stderr.
    const errorsUrl = `file://${ERRORS_SRC}`;
    const typesUrl = `file://${TYPES_SRC}`;
    const script = [
      `import { formatActionableError, writeFormattedCliError } from ${JSON.stringify(errorsUrl)};`,
      `import { HatchError } from ${JSON.stringify(typesUrl)};`,
      // No 4th positional arg => no explicit recoveryHint => floor must apply.
      `const err = new HatchError("could not write .hatch3r/hatch.json", undefined, "FS_ERROR");`,
      `const formatted = formatActionableError(err);`,
      `writeFormattedCliError(formatted);`,
      `process.exit(formatted.exitCode);`,
    ].join("\n");

    const { stderr, exitCode } = runFunnelSubprocess(script);

    // The FS_ERROR floor text (from DEFAULT_RECOVERY_HINT.FS_ERROR) — a
    // distinctive fragment that is NOT part of the error message itself, so a
    // match proves the floor (not the message) reached stderr.
    expect(stderr).toContain("Check the path exists and you have write permission");
    // The funnel writes to stderr, not stdout (POSIX diagnostics convention).
    expect(stderr).toContain("could not write .hatch3r/hatch.json");
    // sysexits.h EX_IOERR — FS_ERROR's central ERROR_CODE_TO_EXIT_CODE value.
    expect(exitCode).toBe(74);
  });

  it("classifies a generic Error as 'unexpected' and emits the troubleshooting footer (exit 1)", () => {
    // The funnel also owns the generic-error path the inline block used to
    // duplicate: an unclassified Error exits 1 with the multi-line footer.
    const errorsUrl = `file://${ERRORS_SRC}`;
    const script = [
      `import { formatActionableError, writeFormattedCliError } from ${JSON.stringify(errorsUrl)};`,
      `const formatted = formatActionableError(new Error("something unexpected broke"));`,
      `writeFormattedCliError(formatted);`,
      `process.exit(formatted.exitCode);`,
    ].join("\n");

    const { stderr, exitCode } = runFunnelSubprocess(script);

    expect(stderr).toContain("hatch3r encountered an unexpected error: something unexpected broke");
    expect(stderr).toContain("hatch3r#troubleshooting");
    expect(exitCode).toBe(1);
  });
});

describe("top-level CLI error funnel (D8-1) — wiring guard", () => {
  // Guard against re-orphaning the funnel. The D8-1 failure mode was an inline
  // error block in index.ts that never imported errors.ts; this reads the
  // source and fails if the import or the invocation regresses.
  const indexSource = readFileSync(INDEX_SRC, "utf-8");

  it("src/cli/index.ts imports the central error funnel", () => {
    expect(indexSource).toMatch(
      /import\s*\{[^}]*\bformatActionableError\b[^}]*\bwriteFormattedCliError\b[^}]*\}\s*from\s*["']\.\/shared\/errors\.js["']/,
    );
  });

  it("the top-level catch invokes formatActionableError + writeFormattedCliError", () => {
    expect(indexSource).toContain("formatActionableError(err, { shuttingDown })");
    expect(indexSource).toContain("writeFormattedCliError(formatted)");
  });

  it("no longer hand-rolls the legacy 'Try:' recovery-hint line in the catch (funnel owns it)", () => {
    // The old inline block printed `  Try: ${err.recoveryHint}`; the funnel now
    // renders the (explicit-or-floor) hint inside a boxen block instead. A
    // re-appearance of the hand-rolled line signals the inline block returned.
    expect(indexSource).not.toContain("Try: ${err.recoveryHint}");
  });
});
