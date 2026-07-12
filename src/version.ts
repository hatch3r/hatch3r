import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

declare const __VERSION__: string;
// `__VERSION__` is injected at build time by tsup (see tsup.config.ts
// `define.__VERSION__`) and under vitest (vitest.config.ts `define`). When this
// module is loaded directly via tsx (e.g. by `scripts/validate-bridge-budget.ts`
// importing through `agentsContent.ts` → `ui.ts` → here), the define is absent —
// fall back to reading the package.json `version` field so the script runs
// outside the bundled CLI. The production CLI path is unchanged because tsup
// replaces the `__VERSION__` token before this fallback executes.
//
// Diagnostics: silent catch is intentional here per the P5 silent-failure
// contract — both fallback branches feed the version into telemetry/UX
// strings only (CLI banner, manifest stamp), never security paths. The
// final `"0.0.0-dev"` sentinel is itself the diagnostic emission: a
// well-known string the operator can grep for to detect missing define.

/**
 * Read the `version` field from package.json using an ESM-safe file read.
 * package.json sits one directory above this module (src/version.ts →
 * ../package.json; the equivalent relative position holds in the dist layout,
 * where this branch is never reached because tsup defines `__VERSION__`).
 *
 * D1-SA1.4-09 (Cycle 12 Wave 4, D1, P5): the prior fallback called bare
 * `require("node:fs")`, but this package declares `"type": "module"`, so
 * `require` does not exist in ESM module scope — every tsx-driven run threw
 * "require is not defined", fell through to the sentinel, and stamped
 * "0.0.0-dev" into the status/verify/validate JSON envelopes and the manifest.
 * The runtime path computation (`resolve(dirname(fileURLToPath(import.meta.url)),
 * "..", "package.json")`) preserves the original resolution while staying pure
 * ESM, and is not statically analyzed by esbuild as a bundled asset. Exported so
 * a unit test can assert the resolved version equals package.json without
 * depending on the `__VERSION__` define (which vitest supplies, masking this
 * path).
 */
export function readPackageVersion(): string {
  const here = fileURLToPath(import.meta.url);
  const pkgPath = resolve(dirname(here), "..", "package.json");
  const parsed = JSON.parse(readFileSync(pkgPath, "utf8")) as { version?: string };
  return parsed.version ?? "0.0.0-dev";
}

function resolveVersion(): string {
  try {
    return __VERSION__;
  } catch (defineMissing) {
    // Branch only taken when the tsup/vitest `define` was not applied — fall
    // back to reading package.json directly. We intentionally do not emit a
    // warning here because the legitimate caller (tsx-time validators) executes
    // this path on every invocation.
    void defineMissing;
    try {
      return readPackageVersion();
    } catch (readErr) {
      // Final sentinel: surface the read failure to stderr so an
      // operator can correlate but never throw — version is a label,
      // not a security check.
      console.warn(
        "[hatch3r] version resolution fell back to '0.0.0-dev':",
        readErr instanceof Error ? readErr.message : String(readErr),
      );
      return "0.0.0-dev";
    }
  }
}
export const HATCH3R_VERSION = resolveVersion();
