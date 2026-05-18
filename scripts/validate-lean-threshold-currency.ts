#!/usr/bin/env node
/**
 * scripts/validate-lean-threshold-currency.ts — Cycle 9 D16-F16.2.5 (C9-M1)
 *
 * Cross-artifact lean-threshold currency gate. Closes the second half of
 * the propagation gap surfaced in `governance/amendment-procedure.md`
 * §3.2: a Lean Thresholds row change (e.g., `CONSTITUTION.md ≤225 → ≤250`
 * cycle 9) lands in `governance/CONSTITUTION.md` §2 P5 but downstream
 * mirrors (`.claude/rules/governance-lean-thresholds.md`, CLAUDE.md
 * "## Lean Thresholds" table) trail by one or more commits.
 *
 * Checks performed (CI gate):
 *
 *   1. Parse the authoritative Lean Thresholds table from
 *      CONSTITUTION §2 P5. Each row is keyed by the column-1 file/metric
 *      label and carries a column-2 Limit string.
 *
 *   2. For every row in the CONSTITUTION table that has a matching row
 *      (same first-column key) in `.claude/rules/governance-lean-thresholds.md`
 *      OR in CLAUDE.md "## Lean Thresholds", the Limit value MUST match
 *      the CONSTITUTION canonical text. Drift is an error.
 *
 *   3. Rows that exist downstream but have no matching CONSTITUTION row
 *      are reported as warnings (the downstream file references a
 *      threshold the Constitution does not declare — likely a typo on the
 *      first-column label or a stale row left after a Constitution edit).
 *
 * Key matching uses a normalized first-column label: backticks stripped,
 * leading/trailing whitespace trimmed, then a small synonym map
 * collapses canonical aliases (e.g. CONSTITUTION uses `` `governance/CONSTITUTION.md` ``
 * while the rule + bridge tables use `CONSTITUTION.md`).
 *
 * Pillars: P5 (Governance Self-Quality), P4 (Lean Coverage).
 *
 * Usage: `npm run validate:efficiency` (wired as the fifth leg after
 * validate-pillar-currency.ts). Exits 0 on currency, 1 on any drift with
 * a per-file diagnostic.
 */
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = resolve(__dirname, "..");

const CONSTITUTION_REL = "governance/CONSTITUTION.md";
const LEAN_THRESHOLDS_RULE_REL = ".claude/rules/governance-lean-thresholds.md";
const CLAUDE_MD_REL = "CLAUDE.md";

// ── Types ─────────────────────────────────────────────────────────

export type Severity = "error" | "warning";

export interface Drift {
  level: Severity;
  code: string;
  file: string;
  line?: number;
  message: string;
}

export interface RunOptions {
  /** Absolute path to the repo root. Defaults to script's parent directory. */
  rootDir?: string;
}

export interface RunResult {
  /** Number of rows extracted from the CONSTITUTION §2 P5 table. */
  constitutionRowCount: number;
  drifts: Drift[];
  errorCount: number;
  warningCount: number;
}

interface ThresholdRow {
  /** Normalized key derived from the first column. */
  key: string;
  /** Raw first-column text (for diagnostics). */
  rawLabel: string;
  /** Trimmed Limit cell text (column 2). */
  limit: string;
  /** 1-based line number of the row. */
  line: number;
}

// ── Key normalization ─────────────────────────────────────────────

/**
 * Collapse first-column text into a normalization key so equivalent
 * labels in the three tables match. Strips backticks, surrounding
 * whitespace, optional file path prefixes, and case. Applies a small
 * synonym map for label drift between the three surfaces.
 */
export function normalizeKey(label: string): string {
  let s = label.replace(/`/g, "").trim();

  // Strip leading "governance/" prefix so the CONSTITUTION row
  // `governance/CONSTITUTION.md` aligns with CLAUDE.md `CONSTITUTION.md`.
  s = s.replace(/^governance\//i, "");

  // Strip optional trailing " (Cursor)" or similar parenthetical
  // qualifications — they don't change the row identity.
  s = s.replace(/\s*\([^)]*\)\s*$/, "").trim();

  // Lowercase for case-insensitive comparison.
  s = s.toLowerCase();

  // Synonym map for known label drift between tables.
  const synonyms: Record<string, string> = {
    "domain file": "domain files",
    "domain files (d*.md)": "domain files",
    "domain files (`governance/audit/domains/d*.md`)": "domain files",
    "audit/domains/d*.md": "domain files",
    "checklist items per sub-agent": "checklist items/sa",
    "checklist items/sub-agent": "checklist items/sa",
  };
  if (synonyms[s] !== undefined) s = synonyms[s];

  return s;
}

// ── Limit normalization ───────────────────────────────────────────

/**
 * Limit cells can carry trailing prose, calibration notes, or
 * non-breaking spaces. Normalize for comparison: strip surrounding
 * whitespace; collapse internal whitespace; remove backticks; preserve
 * the comparison operator + numeric token semantics.
 */
export function normalizeLimit(limit: string): string {
  return limit
    .replace(/`/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// ── Table extraction ──────────────────────────────────────────────

interface ExtractOpts {
  /** Heading line marker that starts the table region. */
  startHeadingRe: RegExp;
  /**
   * Optional end-marker; when provided, scanning stops at the first line
   * matching it after the heading. Defaults to the next ## or ### heading.
   */
  endRe?: RegExp;
  /** Column index of the limit cell (0-based, after the pipe split). */
  limitColumn?: number;
}

/**
 * Extract pipe-delimited table rows from a section of the content. The
 * section is delimited by `startHeadingRe` and ends at the first ## or
 * ### heading after it (or `opts.endRe` if provided). The first two
 * pipe-rows after the heading are the table header + separator and are
 * skipped.
 */
export function extractTableRows(
  content: string,
  opts: ExtractOpts,
): ThresholdRow[] {
  const lines = content.split("\n");
  const rows: ThresholdRow[] = [];
  const endRe = opts.endRe ?? /^#{2,3}\s+/;

  let startIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (opts.startHeadingRe.test(lines[i])) {
      startIdx = i;
      break;
    }
  }
  if (startIdx === -1) return rows;

  let endIdx = lines.length;
  for (let i = startIdx + 1; i < lines.length; i++) {
    if (endRe.test(lines[i])) {
      endIdx = i;
      break;
    }
  }

  let tableRowCount = 0;
  const limitColumn = opts.limitColumn ?? 1;
  for (let i = startIdx + 1; i < endIdx; i++) {
    const line = lines[i];
    if (!line.trim().startsWith("|")) continue;
    // Separator line shape: `|---|---|`
    if (/^\|[\s|:-]+\|\s*$/.test(line.trim())) {
      tableRowCount++;
      continue;
    }
    tableRowCount++;
    if (tableRowCount <= 1) continue; // skip header row
    const cells = line
      .split("|")
      .slice(1, -1) // strip leading and trailing empty splits
      .map((c) => c.trim());
    if (cells.length < 2) continue;
    const rawLabel = cells[0];
    const limit = cells[limitColumn] ?? "";
    if (!rawLabel) continue;
    rows.push({
      key: normalizeKey(rawLabel),
      rawLabel,
      limit,
      line: i + 1,
    });
  }
  return rows;
}

/**
 * Constitution table is identified by the "#### Lean Thresholds"
 * heading inside §2 P5. The Constitution row table has three columns
 * (Metric | Limit | Calibration); rule + CLAUDE.md tables have two
 * (File | Limit or Metric | Limit). We always read column 1 for the
 * Limit.
 */
export function extractConstitutionRows(content: string): ThresholdRow[] {
  return extractTableRows(content, {
    startHeadingRe: /^####\s+Lean\s+Thresholds\s*$/i,
    // Stop at the next `#### …` sub-heading inside §2 P5 (Anti-Bloat
    // Principles or Silent Failure Contract), or any `## …` boundary.
    endRe: /^(##{1,3})\s+/,
  });
}

/**
 * Rule file at `.claude/rules/governance-lean-thresholds.md` declares a
 * `| File | Limit |` table near the top. The rule file has no `####`
 * heading inside; we anchor on the top of the file body and stop at the
 * next `##` (or end-of-file) — equivalent to "all table rows in the
 * file."
 */
export function extractRuleRows(content: string): ThresholdRow[] {
  return extractTableRows(content, {
    startHeadingRe: /^#\s+Governance\s+Lean\s+Thresholds\s*$/i,
    endRe: /^##\s+/,
  });
}

/**
 * CLAUDE.md declares the table under `## Lean Thresholds` heading.
 */
export function extractClaudeRows(content: string): ThresholdRow[] {
  return extractTableRows(content, {
    startHeadingRe: /^##\s+Lean\s+Thresholds\s*$/i,
    endRe: /^##\s+/,
  });
}

// ── Cross-reference checker ───────────────────────────────────────

/**
 * Compare a downstream table's rows against the CONSTITUTION rows.
 * Returns one drift per mismatch: limit text diverges, or a downstream
 * row exists without a matching CONSTITUTION key.
 *
 * CONSTITUTION rows missing from the downstream table are NOT flagged —
 * not every Constitution row needs to appear in every downstream file
 * (CLAUDE.md is a curated subset; the rule file is a different curated
 * subset). The contract is "if you reference a Constitution row, the
 * Limit must match", not "you must reference every row."
 */
export function diffAgainstConstitution(
  relPath: string,
  downstreamRows: ThresholdRow[],
  constitutionRows: ThresholdRow[],
): Drift[] {
  const drifts: Drift[] = [];
  const cMap = new Map<string, ThresholdRow>();
  for (const r of constitutionRows) cMap.set(r.key, r);

  for (const r of downstreamRows) {
    const cRow = cMap.get(r.key);
    if (!cRow) {
      drifts.push({
        level: "warning",
        code: "LEAN-THRESHOLD-UNKNOWN-ROW",
        file: relPath,
        line: r.line,
        message: `row "${r.rawLabel}" has no matching key in CONSTITUTION §2 P5 Lean Thresholds (normalized "${r.key}"); typo on the first-column label or stale row after a Constitution edit`,
      });
      continue;
    }
    if (normalizeLimit(r.limit) !== normalizeLimit(cRow.limit)) {
      drifts.push({
        level: "error",
        code: "LEAN-THRESHOLD-LIMIT-DRIFT",
        file: relPath,
        line: r.line,
        message: `row "${r.rawLabel}" Limit "${r.limit}" diverges from CONSTITUTION canonical "${cRow.limit}" (governance/CONSTITUTION.md:${cRow.line})`,
      });
    }
  }
  return drifts;
}

// ── Orchestrator ──────────────────────────────────────────────────

export async function runValidator(opts: RunOptions = {}): Promise<RunResult> {
  const rootDir = opts.rootDir ?? ROOT;
  const constitutionPath = resolve(rootDir, CONSTITUTION_REL);
  const ruleFilePath = resolve(rootDir, LEAN_THRESHOLDS_RULE_REL);
  const claudeMdPath = resolve(rootDir, CLAUDE_MD_REL);

  const constitutionContent = await readFile(constitutionPath, "utf-8");
  const constitutionRows = extractConstitutionRows(constitutionContent);

  const drifts: Drift[] = [];

  if (constitutionRows.length === 0) {
    drifts.push({
      level: "error",
      code: "CONSTITUTION-TABLE-MISS",
      file: CONSTITUTION_REL,
      message: `could not locate "#### Lean Thresholds" table in CONSTITUTION.md §2 P5`,
    });
  }

  const ruleContent = await readFile(ruleFilePath, "utf-8");
  const ruleRows = extractRuleRows(ruleContent);
  drifts.push(
    ...diffAgainstConstitution(LEAN_THRESHOLDS_RULE_REL, ruleRows, constitutionRows),
  );

  const claudeContent = await readFile(claudeMdPath, "utf-8");
  const claudeRows = extractClaudeRows(claudeContent);
  drifts.push(
    ...diffAgainstConstitution(CLAUDE_MD_REL, claudeRows, constitutionRows),
  );

  let errorCount = 0;
  let warningCount = 0;
  for (const d of drifts) {
    if (d.level === "error") errorCount++;
    else warningCount++;
  }
  return {
    constitutionRowCount: constitutionRows.length,
    drifts,
    errorCount,
    warningCount,
  };
}

// ── Output formatting ─────────────────────────────────────────────

export function formatDrift(d: Drift): string {
  const tag = d.level === "error" ? "ERROR" : "WARN ";
  const where = d.line !== undefined ? `${d.file}:${d.line}` : d.file;
  return `[${tag} ${d.code}] ${where}: ${d.message}`;
}

async function main(): Promise<void> {
  const result = await runValidator();
  for (const d of result.drifts) {
    const line = formatDrift(d);
    // eslint-disable-next-line no-console
    if (d.level === "error") console.error(line);
    else console.warn(line);
  }
  // eslint-disable-next-line no-console
  console.log(
    `validate-lean-threshold-currency: ${result.constitutionRowCount} canonical row(s); ${result.errorCount} error(s), ${result.warningCount} warning(s)`,
  );
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
    console.error("validate-lean-threshold-currency failed:", err);
    process.exit(1);
  });
}
