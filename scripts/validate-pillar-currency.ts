#!/usr/bin/env node
/**
 * scripts/validate-pillar-currency.ts — Cycle 9 D16-F16.2.5 (C9-M1)
 *
 * Cross-artifact pillar currency gate. Closes the propagation gap that
 * caused Cycle 8 P8 drift: a pillar addition / removal / range change
 * lands in `governance/CONSTITUTION.md` §2 but downstream surfaces
 * (CLAUDE.md table, agents/shared/quality-charter.md cross-refs,
 * `.claude/rules/pillar-compliance.md` enumeration) trail by one or more
 * cycles. The sister script `scripts/validate-rule-pillar-currency.ts`
 * (Cycle 9 H78) covers the `.claude/rules/` half; this script covers the
 * CLAUDE.md + quality-charter half so the propagation manifest in
 * `governance/amendment-procedure.md` §3.1 has a code-side gate per row.
 *
 * Checks performed (CI gate):
 *
 *   1. Parse the authoritative pillar count K from CONSTITUTION §2
 *      heading "## N. The K Binding Pillars" (single source of truth).
 *
 *   2. CLAUDE.md "## The K Binding Pillars" or equivalent section MUST
 *      reference the same range `P1-P{K}` and contain a table with K
 *      pillar rows (`| P1 | ... |` through `| P{K} | ... |`).
 *
 *   3. agents/shared/quality-charter.md MUST NOT reference any
 *      `CONSTITUTION §2 P{j}` where j > K (out-of-band pillar ref).
 *
 *   4. No `P1-P{j}` fragment may appear in CLAUDE.md for any j < K
 *      (stale-range drift on the bridge file).
 *
 * Pillars: P5 (Governance Self-Quality), P8 (Clarification & Fan-out
 * Discipline — the validator codifies the propagation manifest's pillar
 * row).
 *
 * Usage: `npm run validate:efficiency` (wired as the fourth leg after
 * fanout-emission). Exits 0 on currency, 1 on any drift with a per-file
 * diagnostic.
 */
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = resolve(__dirname, "..");

const CONSTITUTION_REL = "governance/CONSTITUTION.md";
const CLAUDE_MD_REL = "CLAUDE.md";
const QUALITY_CHARTER_REL = "agents/shared/quality-charter.md";

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
  pillarCount: number;
  drifts: Drift[];
  errorCount: number;
  warningCount: number;
}

// ── Constitution parsing (mirrors validate-rule-pillar-currency.ts) ───

/**
 * Locate the "## N. The K Binding Pillars" heading in the Constitution
 * and return K plus the count of `### P{i}.` sub-headings underneath up
 * to the next `## ` boundary. The two numbers MUST agree; the caller
 * surfaces a CONSTITUTION-SELF-DRIFT error when they don't.
 */
export function parseConstitutionPillars(content: string): {
  declaredCount: number;
  sectionCount: number;
  declaredHeadingLine: number;
} {
  const lines = content.split("\n");
  const HEADING_RE = /^##\s+(\d+)\.\s+The\s+(\d+)\s+Binding\s+Pillars\s*$/i;
  let declaredCount = -1;
  let headingIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(HEADING_RE);
    if (m) {
      declaredCount = Number(m[2]);
      headingIdx = i;
      break;
    }
  }
  if (headingIdx === -1) {
    throw new Error(
      `validate-pillar-currency: could not locate "## N. The K Binding Pillars" heading in CONSTITUTION.md`,
    );
  }
  const SECTION_RE = /^###\s+P(\d+)\.\s+/;
  let sectionCount = 0;
  for (let i = headingIdx + 1; i < lines.length; i++) {
    if (/^##\s+/.test(lines[i])) break;
    if (SECTION_RE.test(lines[i])) sectionCount++;
  }
  return {
    declaredCount,
    sectionCount,
    declaredHeadingLine: headingIdx + 1,
  };
}

// ── CLAUDE.md pillar table check ──────────────────────────────────

/**
 * Count `| P{i} |` table rows in CLAUDE.md so a maintainer adding a
 * pillar without rebuilding the CLAUDE.md table is caught at gate time.
 * Returns the set of pillar indices present in the table.
 */
export function parseClaudePillarTable(content: string): Set<number> {
  const present = new Set<number>();
  const ROW_RE = /^\|\s*P(\d+)\s*\|/;
  for (const line of content.split("\n")) {
    const m = line.match(ROW_RE);
    if (m) present.add(Number(m[1]));
  }
  return present;
}

/**
 * Verify CLAUDE.md references the canonical range `P1-P{K}` at least
 * once and that its pillar-table row set equals exactly {1, …, K}.
 * Returns one drift per violation.
 */
export function checkClaudeMd(
  relPath: string,
  content: string,
  pillarCount: number,
): Drift[] {
  const drifts: Drift[] = [];
  const lines = content.split("\n");
  const canonicalRange = `P1-P${pillarCount}`;

  // (a) Canonical range must appear at least once.
  if (!content.includes(canonicalRange)) {
    drifts.push({
      level: "error",
      code: "PILLAR-RANGE-MISS",
      file: relPath,
      message: `missing canonical range "${canonicalRange}"; CLAUDE.md must reference the same range as CONSTITUTION §2`,
    });
  }

  // (b) Stale P1-P{j} for j ≠ K → error per row.
  const STALE_RANGE_RE = /\bP1-P(\d+)\b/g;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    let m: RegExpExecArray | null;
    STALE_RANGE_RE.lastIndex = 0;
    while ((m = STALE_RANGE_RE.exec(line)) !== null) {
      const j = Number(m[1]);
      if (j !== pillarCount) {
        drifts.push({
          level: "error",
          code: "PILLAR-RANGE-STALE",
          file: relPath,
          line: i + 1,
          message: `stale range "P1-P${j}" found; expected "P1-P${pillarCount}" (Constitution declares ${pillarCount} pillars)`,
        });
      }
    }
  }

  // (c) Pillar-table row set must equal exactly {1, …, K}. Missing rows
  // and out-of-band rows are both errors.
  const present = parseClaudePillarTable(content);
  const expected = new Set<number>();
  for (let i = 1; i <= pillarCount; i++) expected.add(i);

  for (const i of expected) {
    if (!present.has(i)) {
      drifts.push({
        level: "error",
        code: "PILLAR-TABLE-MISSING-ROW",
        file: relPath,
        message: `pillar table missing row for P${i}; Constitution declares ${pillarCount} pillars`,
      });
    }
  }
  for (const i of present) {
    if (!expected.has(i)) {
      drifts.push({
        level: "error",
        code: "PILLAR-TABLE-EXTRA-ROW",
        file: relPath,
        message: `pillar table has row for P${i} but Constitution declares only ${pillarCount} pillars`,
      });
    }
  }

  return drifts;
}

// ── Quality-charter pillar reference check ─────────────────────────

/**
 * Scan agents/shared/quality-charter.md for `CONSTITUTION §2 P{j}` and
 * any bare `P{j}` token that points past the declared range. Reports
 * out-of-band references (j > K) as errors so quality-charter cross-refs
 * cannot point at pillars that no longer exist.
 *
 * In-band refs (j ≤ K) are not flagged — the quality-charter intentionally
 * cross-references P2 for production-readiness measurement multiple
 * times; that pattern is healthy, not drift.
 */
export function checkQualityCharter(
  relPath: string,
  content: string,
  pillarCount: number,
): Drift[] {
  const drifts: Drift[] = [];
  const lines = content.split("\n");
  // Match `CONSTITUTION §2 P{j}` and `CONSTITUTION.md §2 P{j}` and bare
  // `P{j}` only when followed by a non-alphanumeric boundary. We tighten
  // to `CONSTITUTION` context to avoid false positives on P2P / P3 (the
  // letter "P" followed by a digit appears in many other unrelated
  // identifiers across the file).
  const CONSTITUTION_PILLAR_RE = /CONSTITUTION(?:\.md)?\s+§\s*2\s+P(\d+)\b/g;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    let m: RegExpExecArray | null;
    CONSTITUTION_PILLAR_RE.lastIndex = 0;
    while ((m = CONSTITUTION_PILLAR_RE.exec(line)) !== null) {
      const j = Number(m[1]);
      if (j > pillarCount) {
        drifts.push({
          level: "error",
          code: "PILLAR-RANGE-OUT-OF-BAND",
          file: relPath,
          line: i + 1,
          message: `cross-reference "CONSTITUTION §2 P${j}" points past pillar ${pillarCount}; either Constitution lost a pillar or this reference is stale`,
        });
      }
    }
  }
  return drifts;
}

// ── Orchestrator ──────────────────────────────────────────────────

export async function runValidator(opts: RunOptions = {}): Promise<RunResult> {
  const rootDir = opts.rootDir ?? ROOT;
  const constitutionPath = resolve(rootDir, CONSTITUTION_REL);
  const claudeMdPath = resolve(rootDir, CLAUDE_MD_REL);
  const qualityCharterPath = resolve(rootDir, QUALITY_CHARTER_REL);

  // The CONSTITUTION is private and absent in public CI / contributor clones.
  // The authoritative pillar count comes from CONSTITUTION §2; with no source
  // count to cross-check CLAUDE.md + quality-charter against, skip the
  // pillar-count check (exit clean) rather than throw on the missing read.
  if (!existsSync(constitutionPath)) {
    // eslint-disable-next-line no-console
    console.error(
      `[validate-pillar-currency] ${CONSTITUTION_REL} absent — skipping pillar-count cross-check`,
    );
    return { pillarCount: 0, drifts: [], errorCount: 0, warningCount: 0 };
  }

  const constitutionContent = await readFile(constitutionPath, "utf-8");
  const { declaredCount, sectionCount, declaredHeadingLine } =
    parseConstitutionPillars(constitutionContent);

  const drifts: Drift[] = [];

  if (declaredCount !== sectionCount) {
    drifts.push({
      level: "error",
      code: "CONSTITUTION-SELF-DRIFT",
      file: CONSTITUTION_REL,
      line: declaredHeadingLine,
      message: `heading declares ${declaredCount} pillars but ${sectionCount} "### P{i}." sub-headings present`,
    });
  }

  const pillarCount = declaredCount;

  const claudeContent = await readFile(claudeMdPath, "utf-8");
  drifts.push(...checkClaudeMd(CLAUDE_MD_REL, claudeContent, pillarCount));

  const qualityCharterContent = await readFile(qualityCharterPath, "utf-8");
  drifts.push(
    ...checkQualityCharter(QUALITY_CHARTER_REL, qualityCharterContent, pillarCount),
  );

  let errorCount = 0;
  let warningCount = 0;
  for (const d of drifts) {
    if (d.level === "error") errorCount++;
    else warningCount++;
  }
  return { pillarCount, drifts, errorCount, warningCount };
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
    `validate-pillar-currency: P1-P${result.pillarCount} canonical; ${result.errorCount} error(s), ${result.warningCount} warning(s)`,
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
    console.error("validate-pillar-currency failed:", err);
    process.exit(1);
  });
}
