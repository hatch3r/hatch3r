#!/usr/bin/env node
/**
 * scripts/validate-canonical.ts — Pillar P3 (Adapter & External Tool
 * Currency, release-pipeline integrity), P5 (Governance Self-Quality —
 * Silent Failure Contract).
 *
 * Audit Cycle 10 D2-SA2.2 finding 2.2-F7. `readCanonicalFiles` accumulates
 * non-fatal problems (YAML parse errors, PERMISSION_DENIED, TYPE_MISMATCH,
 * promptGuard injection tokens) on a soft `warnings[]` channel and still
 * returns a degraded file list with exit 0. Nothing in the build or release
 * path fails on `warnings.length > 0`, so `npm publish` can ship a tarball
 * whose canonical content silently lost files — consumers only see the
 * degradation after install.
 *
 * This gate closes that loop. It loads every published canonical content
 * type from the bundled content root via the opt-in `{ strict: true }` mode
 * of `readCanonicalFiles` (added in the same finding): strict mode throws a
 * `HatchError(VALIDATION_ERROR)` when ANY warning is collected. The gate
 * converts each throw into an error-level finding and exits non-zero, so a
 * zero-warning canonical corpus is a release precondition alongside
 * `validate:rule-parity` and `validate:efficiency`.
 *
 * The default (non-strict) production code path is unchanged — sync/init/
 * update keep their resilient soft-warning behavior. Strict mode is opt-in
 * tooling exercised only by this gate.
 *
 * Scanned types: the published content classes shipped in the npm package
 * (`rules`, `agents`, `skills`, `commands`, `hooks`, `checks`). Reserved/
 * empty classes (`prompts`) and user-state/derived classes (`policy`,
 * `learnings`, `github-agents`) are out of the bundled-content contract and
 * are not scanned. Missing/empty directories are benign — strict mode only
 * trips on an actual warning, never on an absent type.
 *
 * Usage: `npm run validate:canonical`
 *        `tsx scripts/validate-canonical.ts`
 *        `tsx scripts/validate-canonical.ts --json`
 */
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { readCanonicalFiles, type CanonicalType } from "../src/adapters/canonical.js";
import { resolveBundledContentRoot } from "../src/content/contentRoot.js";
import { HatchError } from "../src/types.js";

const __filename = fileURLToPath(import.meta.url);

// ── Types ─────────────────────────────────────────────────────────

type Severity = "error" | "warning";

export interface Finding {
  level: Severity;
  code: string;
  type: CanonicalType;
  message: string;
}

export interface RunOptions {
  /** Bundled content root; defaults to `resolveBundledContentRoot()`. */
  root?: string;
  /** Override the scanned type set (test injection). */
  types?: readonly CanonicalType[];
}

export interface RunResult {
  findings: Finding[];
  errorCount: number;
  warningCount: number;
  checkedTypes: number;
}

// Published content classes shipped in the npm package. Order is cosmetic
// (alphabetical) — findings are independent per type.
export const SCANNED_TYPES: readonly CanonicalType[] = [
  "agents",
  "checks",
  "commands",
  "hooks",
  "rules",
  "skills",
];

// ── Core ──────────────────────────────────────────────────────────

export async function runValidator(opts: RunOptions = {}): Promise<RunResult> {
  const root = opts.root ?? resolveBundledContentRoot();
  const types = opts.types ?? SCANNED_TYPES;
  const findings: Finding[] = [];

  for (const type of types) {
    try {
      await readCanonicalFiles(root, type, undefined, undefined, { strict: true });
    } catch (err) {
      if (err instanceof HatchError && err.errorCode === "VALIDATION_ERROR") {
        findings.push({
          level: "error",
          code: "P5-CANONICAL-WARN",
          type,
          message: err.message,
        });
      } else {
        // An unexpected error (not the strict-mode validation throw) is still
        // a gate failure — surface it rather than swallow it.
        findings.push({
          level: "error",
          code: "P5-CANONICAL-READ-FAIL",
          type,
          message: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  let errorCount = 0;
  let warningCount = 0;
  for (const f of findings) {
    if (f.level === "error") errorCount++;
    else warningCount++;
  }
  return { findings, errorCount, warningCount, checkedTypes: types.length };
}

// ── Output ────────────────────────────────────────────────────────

export function formatFinding(f: Finding): string {
  const tag = f.level === "error" ? "ERROR" : "WARN ";
  return `[${tag} ${f.code}] ${f.type}: ${f.message}`;
}

interface CliFlags {
  json: boolean;
}

function parseArgs(argv: readonly string[]): CliFlags {
  return { json: argv.includes("--json") };
}

async function main(): Promise<void> {
  const flags = parseArgs(process.argv.slice(2));
  const result = await runValidator();
  if (flags.json) {
    // eslint-disable-next-line no-console
    console.log(JSON.stringify(result, null, 2));
  } else {
    for (const f of result.findings) {
      const line = formatFinding(f);
      // eslint-disable-next-line no-console
      if (f.level === "error") console.error(line);
      else console.warn(line);
    }
    // eslint-disable-next-line no-console
    console.log(
      `validate-canonical: ${result.checkedTypes} type(s) checked; ${result.errorCount} error(s), ${result.warningCount} warning(s)`,
    );
  }
  if (result.errorCount > 0) process.exit(1);
}

// Only auto-run when executed as a script, never when imported by tests.
const isMain = (() => {
  try {
    return resolve(process.argv[1] ?? "") === __filename;
  } catch {
    return false;
  }
})();

if (isMain) {
  main().catch((err) => {
    // eslint-disable-next-line no-console
    console.error("validate-canonical failed:", err);
    process.exit(1);
  });
}
