#!/usr/bin/env node
/**
 * scripts/validate-governance-total.ts — Audit Cycle 11 D24-9 (Wave 3 Medium)
 *
 * Enforces the CONSTITUTION §2 P5 "Governance total" lean-threshold row. That
 * row was scope-undefined and unenforced: no CI leg summed any files, and the
 * smallest defensible scope (the 6 lean-tracked prompts) already exceeded the
 * prior <=3000 ceiling. D24-9 redefined the scope inline and reset the ceiling
 * to the deterministic sum of those 6 files' own per-file caps; this script is
 * the enforcer that row's text now names.
 *
 * Scope (the 6 lean-tracked governance prompts, per CONSTITUTION §2 P5):
 *   CONSTITUTION.md + VISION.md + AUDIT.md + AUDIT-EXECUTE.md +
 *   EVOLVE.md + pack-trust-model.md
 *
 * The ceiling is NOT hardcoded here. It is parsed from the CONSTITUTION §2 P5
 * "Governance total" row Limit cell, so the table stays the single source of
 * truth (P4) and this script can never drift from it. If the parse fails or
 * the row is missing, that is an error.
 *
 * Public-CI safety: the governance/ corpus is private (governance privatization
 * initiative, 2026-06-03) and absent in public clones / contributor CI. When
 * the scoped files are absent, the check skips clean (exit 0) — mirroring
 * `scripts/validate-lean-threshold-currency.ts`, which is also a governance-only
 * gate that no-ops without the private corpus.
 *
 * Pillars: P5 (Governance Self-Quality), P4 (Lean Coverage).
 *
 * Usage: `npm run validate:efficiency` (wired as the final leg). Exits 0 when
 * the sum is at or under the ceiling, 1 on breach or a parse/row error.
 */
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = resolve(__dirname, "..");

const CONSTITUTION_REL = "governance/CONSTITUTION.md";

/**
 * The 6 lean-tracked governance prompts that constitute the "Governance total"
 * scope. Order matches the CONSTITUTION §2 P5 row text for diagnostic
 * readability.
 */
export const SCOPED_FILES: readonly string[] = [
  "governance/CONSTITUTION.md",
  "governance/VISION.md",
  "governance/AUDIT.md",
  "governance/AUDIT-EXECUTE.md",
  "governance/EVOLVE.md",
  "governance/pack-trust-model.md",
];

// ── Types ─────────────────────────────────────────────────────────

export interface FileCount {
  /** Repo-relative path. */
  relPath: string;
  /** Newline-counted line total (matches `wc -l` for newline-terminated files). */
  lines: number;
}

export interface RunOptions {
  /** Absolute path to the repo root. Defaults to script's parent directory. */
  rootDir?: string;
}

export interface RunResult {
  /** True when the private corpus was absent and the check was skipped. */
  skipped: boolean;
  /** Ceiling parsed from the CONSTITUTION §2 P5 row, or null when unavailable. */
  ceiling: number | null;
  /** Per-file line counts (empty when skipped). */
  counts: FileCount[];
  /** Sum of `counts[].lines`. */
  total: number;
  /** True when `total > ceiling`. */
  breached: boolean;
  /** Diagnostic messages (parse/row errors). */
  errors: string[];
  /** Process exit code this result implies. */
  exitCode: 0 | 1;
}

// ── Line counting ─────────────────────────────────────────────────

/**
 * Count lines the same way `wc -l` does: the number of newline characters.
 * A trailing newline therefore does not add a phantom empty line, matching
 * the `wc -l` totals the CONSTITUTION per-file caps are written against.
 */
export function countLines(content: string): number {
  let n = 0;
  for (let i = 0; i < content.length; i++) {
    if (content.charCodeAt(i) === 10 /* \n */) n++;
  }
  return n;
}

// ── Ceiling parsing ───────────────────────────────────────────────

/**
 * Parse the integer ceiling from the CONSTITUTION §2 P5 "Governance total"
 * row. The row's first column starts with the literal text "Governance total"
 * (the inline scope parenthetical follows). The Limit cell (column index 1)
 * carries a `<=NNNN lines` token. Returns the integer NNNN, or null when the
 * row or token cannot be found.
 */
export function parseCeiling(constitutionContent: string): number | null {
  const lines = constitutionContent.split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("|")) continue;
    const cells = trimmed
      .split("|")
      .slice(1, -1)
      .map((c) => c.trim());
    if (cells.length < 2) continue;
    // Match the metric cell on its leading label so the inline scope
    // parenthetical does not have to be reproduced here.
    if (!/^governance total\b/i.test(cells[0].replace(/`/g, ""))) continue;
    const m = cells[1].match(/<=\s*(\d+)\s*lines/i);
    if (!m) return null;
    return Number.parseInt(m[1], 10);
  }
  return null;
}

// ── Orchestrator ──────────────────────────────────────────────────

export async function runValidator(opts: RunOptions = {}): Promise<RunResult> {
  const rootDir = opts.rootDir ?? ROOT;
  const constitutionPath = resolve(rootDir, CONSTITUTION_REL);

  // Governance corpus is private and absent in public CI / contributor clones.
  // With no scoped files to sum, skip the whole check (exit clean).
  if (!existsSync(constitutionPath)) {
    return {
      skipped: true,
      ceiling: null,
      counts: [],
      total: 0,
      breached: false,
      errors: [],
      exitCode: 0,
    };
  }

  const errors: string[] = [];
  const constitutionContent = await readFile(constitutionPath, "utf-8");
  const ceiling = parseCeiling(constitutionContent);
  if (ceiling === null) {
    errors.push(
      `could not parse a "<=NNNN lines" ceiling from the CONSTITUTION §2 P5 "Governance total" row in ${CONSTITUTION_REL}`,
    );
  }

  const counts: FileCount[] = [];
  for (const relPath of SCOPED_FILES) {
    const abs = resolve(rootDir, relPath);
    if (!existsSync(abs)) {
      errors.push(`scoped file missing: ${relPath}`);
      continue;
    }
    const content = await readFile(abs, "utf-8");
    counts.push({ relPath, lines: countLines(content) });
  }

  const total = counts.reduce((acc, c) => acc + c.lines, 0);
  const breached = ceiling !== null && total > ceiling;
  const exitCode: 0 | 1 = breached || errors.length > 0 ? 1 : 0;

  return { skipped: false, ceiling, counts, total, breached, errors, exitCode };
}

// ── Output formatting ─────────────────────────────────────────────

export function formatResult(result: RunResult): string[] {
  if (result.skipped) {
    return [
      `[validate-governance-total] ${CONSTITUTION_REL} absent — skipping governance-total check`,
    ];
  }
  const out: string[] = [];
  for (const e of result.errors) out.push(`[ERROR GOVERNANCE-TOTAL] ${e}`);
  for (const c of result.counts) {
    out.push(`  ${c.relPath}: ${c.lines}`);
  }
  const ceilingStr = result.ceiling === null ? "(unparsed)" : String(result.ceiling);
  if (result.breached) {
    out.push(
      `[ERROR GOVERNANCE-TOTAL] sum ${result.total} > ceiling ${ceilingStr} — compress a scoped prompt or raise the §2 P5 "Governance total" ceiling with a pillar-backed rationale`,
    );
  }
  out.push(
    `validate-governance-total: ${result.total} line(s) across ${result.counts.length} scoped prompt(s); ceiling ${ceilingStr}; ${result.breached ? "BREACH" : "ok"}`,
  );
  return out;
}

async function main(): Promise<void> {
  const result = await runValidator();
  for (const line of formatResult(result)) {
    // eslint-disable-next-line no-console
    if (line.startsWith("[ERROR")) console.error(line);
    else console.log(line);
  }
  if (result.exitCode !== 0) process.exit(result.exitCode);
}

// Only auto-run when executed as a script, never when imported by tests.
const isMain = (() => {
  try {
    return resolve(process.argv[1] ?? "") === __filename;
    // A path-resolve failure here only means "not the main module"; returning
    // false is the correct, non-degrading classification with no operator-facing
    // diagnostic to emit (no I/O, no state mutation).
    // eslint-disable-next-line silent-failure/no-silent-catch
  } catch {
    return false;
  }
})();

if (isMain) {
  main().catch((err) => {
    // eslint-disable-next-line no-console
    console.error("validate-governance-total failed:", err);
    process.exit(1);
  });
}
