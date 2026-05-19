declare const __VERSION__: string;
// `__VERSION__` is injected at build time by tsup (see tsup.config.ts
// `define.__VERSION__`). When this module is loaded directly via tsx
// (e.g. by `scripts/validate-bridge-budget.ts` importing through
// `agentsContent.ts` → `ui.ts` → here), the define is absent — fall back
// to the package.json `version` field so the script runs outside the
// bundled CLI. The production CLI path is unchanged because tsup
// replaces the `__VERSION__` token before this fallback executes.
//
// Diagnostics: silent catch is intentional here per the P5 silent-failure
// contract — both fallback branches feed the version into telemetry/UX
// strings only (CLI banner, manifest stamp), never security paths. The
// final `"0.0.0-dev"` sentinel is itself the diagnostic emission: a
// well-known string the operator can grep for to detect missing define.
function resolveVersion(): string {
  try {
    return __VERSION__;
  } catch (defineMissing) {
    // Branch only taken when the tsup `define` was not applied — fall
    // back to reading package.json directly. We intentionally do not
    // emit a warning here because the legitimate caller (tsx-time
    // validators) executes this path on every invocation.
    void defineMissing;
    try {
      // Lazy require keeps the bundled CLI from pulling in fs/url machinery
      // — this branch only executes under tsx where the define is missing.
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { readFileSync } = require("node:fs") as typeof import("node:fs");
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { fileURLToPath } = require("node:url") as typeof import("node:url");
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { dirname, resolve } = require("node:path") as typeof import("node:path");
      const here = fileURLToPath(import.meta.url);
      const pkgPath = resolve(dirname(here), "..", "package.json");
      const raw = readFileSync(pkgPath, "utf8");
      const parsed = JSON.parse(raw) as { version?: string };
      return parsed.version ?? "0.0.0-dev";
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
