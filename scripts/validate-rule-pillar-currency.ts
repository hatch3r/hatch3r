#!/usr/bin/env node
/**
 * scripts/validate-rule-pillar-currency.ts — Cycle 9 H78
 *
 * Enforces that framework-dev rule files in `.claude/rules/` stay in sync
 * with the authoritative pillar count declared in `governance/CONSTITUTION.md`
 * §2. The rule files that codify the Pillar Compliance Test must reference
 * the same range and the same total pillar count as the Constitution; drift
 * (e.g., Constitution declares 8 pillars while a rule still says "P1-P7")
 * is a governance inconsistency that systematically under-credits the
 * out-of-date pillars during Pillar Compliance Test application.
 *
 * Checks performed (CI gate):
 *
 *   1. Parse the heading `## N. The K Binding Pillars` in CONSTITUTION §2 and
 *      verify `K` matches the number of `### P{i}.` sub-headings underneath
 *      (i.e., the count claimed in the heading matches the count present).
 *
 *   2. `.claude/rules/pillar-compliance.md` must reference the same range
 *      (`P1-P{K}`) in the "Which pillar(s) does this change serve?" prompt
 *      and must list "The K pillars: …" matching the Constitution's
 *      pillar enumeration count.
 *
 *   3. `.claude/rules/content-authoring.md` must reference the same range
 *      (`P1-P{K}`) in the "Pillar alignment" item.
 *
 *   4. No stale `P1-P{K-1}`, `P1-P{K-2}`, … fragments may appear inside
 *      either rule body — that pattern is the canonical drift shape this
 *      gate guards against.
 *
 * Pillars: P5 (Governance Self-Quality), P8 (Clarification & Fan-out
 * Discipline — explicitly: P8 must be recognized by rules that codify
 * the Pillar Compliance Test).
 *
 * Usage: `npm run validate:rule-parity` (umbrella wires this script after
 * the body/scope parity check). Exits 0 on currency, 1 on any drift with
 * a per-file diagnostic.
 */
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = resolve(__dirname, "..");

const CONSTITUTION_REL = "governance/CONSTITUTION.md";
const PILLAR_COMPLIANCE_REL = ".claude/rules/pillar-compliance.md";
const CONTENT_AUTHORING_REL = ".claude/rules/content-authoring.md";

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

// ── Constitution parsing ──────────────────────────────────────────

/**
 * Locate the "## N. The K Binding Pillars" heading in the Constitution and
 * return K together with the count of `### P{i}.` sub-headings that follow
 * up to the next `## ` boundary. The two numbers MUST agree; the function
 * returns both so the caller can report a Constitution-internal drift
 * before any rule-file check runs.
 */
export function parseConstitutionPillars(content: string): {
  declaredCount: number;
  sectionCount: number;
  declaredHeadingLine: number;
} {
  const lines = content.split("\n");
  // Match "## 2. The 8 Binding Pillars" or any other section number / count.
  // Capture group 1 = section number (e.g. "2"), 2 = pillar count (e.g. "8").
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
      `validate-rule-pillar-currency: could not locate "## N. The K Binding Pillars" heading in CONSTITUTION.md`,
    );
  }

  // Count `### P{i}.` sub-headings between this heading and the next `## ` heading.
  const SECTION_RE = /^###\s+P(\d+)\.\s+/;
  let sectionCount = 0;
  for (let i = headingIdx + 1; i < lines.length; i++) {
    if (/^##\s+/.test(lines[i])) break;
    if (SECTION_RE.test(lines[i])) sectionCount++;
  }

  return {
    declaredCount,
    sectionCount,
    declaredHeadingLine: headingIdx + 1, // 1-based line number
  };
}

// ── Rule-file currency checks ─────────────────────────────────────

/**
 * Verify `.claude/rules/pillar-compliance.md` references P1-P{K} and "The K
 * pillars" matching the authoritative count. Returns one drift per
 * violation: missing canonical range, missing canonical count, or a stale
 * P1-P{j} fragment for any j < K.
 */
export function checkPillarComplianceFile(
  relPath: string,
  content: string,
  pillarCount: number,
): Drift[] {
  const drifts: Drift[] = [];
  const lines = content.split("\n");

  const canonicalRange = `P1-P${pillarCount}`;
  const canonicalCountPhrase = `The ${pillarCount} pillars`;

  // (a) Canonical range must appear at least once.
  const hasRange = content.includes(canonicalRange);
  if (!hasRange) {
    drifts.push({
      level: "error",
      code: "PILLAR-RANGE-MISS",
      file: relPath,
      message: `missing canonical range "${canonicalRange}"; rule must reference the same range as CONSTITUTION §2`,
    });
  }

  // (b) Canonical "The K pillars: …" phrase must appear (summary line).
  if (!content.includes(canonicalCountPhrase)) {
    drifts.push({
      level: "error",
      code: "PILLAR-COUNT-MISS",
      file: relPath,
      message: `missing canonical phrase "${canonicalCountPhrase}: …"; rule must enumerate the same total count as CONSTITUTION §2`,
    });
  }

  // (c) No stale P1-P{j} fragment for any j < K may appear.
  drifts.push(...findStalePillarRanges(relPath, lines, pillarCount));

  // (d) No stale "The j pillars" / "The j Binding Pillars" phrase for j < K.
  drifts.push(...findStalePillarCounts(relPath, lines, pillarCount));

  return drifts;
}

/**
 * Verify `.claude/rules/content-authoring.md` references P1-P{K} in its
 * Pillar alignment item. Returns one drift per violation.
 */
export function checkContentAuthoringFile(
  relPath: string,
  content: string,
  pillarCount: number,
): Drift[] {
  const drifts: Drift[] = [];
  const lines = content.split("\n");

  const canonicalRange = `P1-P${pillarCount}`;
  if (!content.includes(canonicalRange)) {
    drifts.push({
      level: "error",
      code: "PILLAR-RANGE-MISS",
      file: relPath,
      message: `missing canonical range "${canonicalRange}"; Pillar alignment item must reference the same range as CONSTITUTION §2`,
    });
  }

  drifts.push(...findStalePillarRanges(relPath, lines, pillarCount));

  return drifts;
}

/**
 * Scan a file's lines for stale `P1-P{j}` ranges where j ≠ K. The current
 * canonical range (`P1-P{K}`) is excluded; any other range is reported with
 * its 1-based line number to make the fix obvious.
 */
function findStalePillarRanges(
  relPath: string,
  lines: string[],
  pillarCount: number,
): Drift[] {
  const drifts: Drift[] = [];
  // Match `P1-P{j}` (case-sensitive; the pillar tokens are uppercase in our
  // governance corpus). Word boundaries on both sides prevent matches inside
  // longer identifiers.
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
  return drifts;
}

/**
 * Scan a file's lines for stale "The j pillars" or "The j Binding Pillars"
 * phrases where j ≠ K. Catches the canonical drift shape on the summary line
 * of pillar-compliance.md.
 */
function findStalePillarCounts(
  relPath: string,
  lines: string[],
  pillarCount: number,
): Drift[] {
  const drifts: Drift[] = [];
  const STALE_COUNT_RE = /\bThe\s+(\d+)\s+(Binding\s+)?pillars\b/gi;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    let m: RegExpExecArray | null;
    STALE_COUNT_RE.lastIndex = 0;
    while ((m = STALE_COUNT_RE.exec(line)) !== null) {
      const j = Number(m[1]);
      if (j !== pillarCount) {
        drifts.push({
          level: "error",
          code: "PILLAR-COUNT-STALE",
          file: relPath,
          line: i + 1,
          message: `stale phrase "The ${j} ${m[2] ?? ""}pillars" found; expected count ${pillarCount}`,
        });
      }
    }
  }
  return drifts;
}

// ── Orchestrator ──────────────────────────────────────────────────

export async function runValidator(opts: RunOptions = {}): Promise<RunResult> {
  const rootDir = opts.rootDir ?? ROOT;
  const constitutionPath = join(rootDir, CONSTITUTION_REL);
  const pillarCompliancePath = join(rootDir, PILLAR_COMPLIANCE_REL);
  const contentAuthoringPath = join(rootDir, CONTENT_AUTHORING_REL);

  const constitutionContent = await readFile(constitutionPath, "utf-8");
  const { declaredCount, sectionCount, declaredHeadingLine } =
    parseConstitutionPillars(constitutionContent);

  const drifts: Drift[] = [];

  // Constitution-internal sanity: heading count must match the section count.
  if (declaredCount !== sectionCount) {
    drifts.push({
      level: "error",
      code: "CONSTITUTION-SELF-DRIFT",
      file: CONSTITUTION_REL,
      line: declaredHeadingLine,
      message: `heading declares ${declaredCount} pillars but ${sectionCount} "### P{i}." sub-headings present`,
    });
  }

  // The authoritative pillar count is the Constitution heading; downstream
  // rules are checked against it. If the Constitution itself is incoherent
  // we still run downstream checks against the heading number — but the
  // CONSTITUTION-SELF-DRIFT error above blocks the gate regardless.
  const pillarCount = declaredCount;

  const pillarComplianceContent = await readFile(pillarCompliancePath, "utf-8");
  drifts.push(
    ...checkPillarComplianceFile(
      PILLAR_COMPLIANCE_REL,
      pillarComplianceContent,
      pillarCount,
    ),
  );

  const contentAuthoringContent = await readFile(contentAuthoringPath, "utf-8");
  drifts.push(
    ...checkContentAuthoringFile(
      CONTENT_AUTHORING_REL,
      contentAuthoringContent,
      pillarCount,
    ),
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
    `validate-rule-pillar-currency: P1-P${result.pillarCount} canonical; ${result.errorCount} error(s), ${result.warningCount} warning(s)`,
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
    console.error("validate-rule-pillar-currency failed:", err);
    process.exit(1);
  });
}
