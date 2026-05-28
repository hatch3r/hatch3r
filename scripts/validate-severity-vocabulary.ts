#!/usr/bin/env node
/**
 * scripts/validate-severity-vocabulary.ts — Cycle 9 H58 (D16-F16.1.3),
 * closes CD-3 enforcement-tier fragmentation code-side.
 *
 * Scans `.md` files under canonical content + governance directories for
 * off-canonical severity terms that appear in a structured severity context
 * (frontmatter `severity:` field, table cells flanked by `|`, list/bullet
 * prefixes, severity-tagged lines). Findings are emitted when the term is
 * NOT one of the canonical 5-tier buckets (Critical | High | Medium | Low |
 * Info) AND the file does not reference the canonical mapping
 * (`governance/audit/templates/severity-mapping.md`).
 *
 * The canonical mapping reference is a documented opt-out — agents like
 * `hatch3r-ui` (WCAG Critical/Major/Minor) and `hatch3r-security`
 * (CVSS Critical/High/Moderate/Low) carry the reference and explicitly map
 * their domain vocabulary back to canonical. Files without that reference
 * must stick to the canonical 5-tier strings in any structured severity
 * context.
 *
 * Failure modes (each emits one ERROR finding per offending occurrence):
 *
 *   SEVERITY-OFF-CANONICAL  Off-canonical severity term (e.g., "Moderate",
 *                           "Major", "Blocker") in a structured severity
 *                           context, no `severity-mapping.md` reference in
 *                           the file.
 *   SEVERITY-MAPPING-MISS   File EMITS at least one off-canonical severity
 *                           term in a structured context but is missing the
 *                           canonical mapping reference. (One per file.)
 *
 * Off-canonical detection is conservative: only structured contexts are
 * considered, never prose. "Critical path" or "minor improvement" in
 * sentence prose is never flagged.
 *
 * Pillars: P5 (Governance Self-Quality), P4 (Lean Coverage).
 *
 * Usage:
 *   `npm run validate:severity-vocabulary`     (wired in package.json)
 *   `tsx scripts/validate-severity-vocabulary.ts`
 *   `tsx scripts/validate-severity-vocabulary.ts --json`
 */
import { readdir, readFile, stat } from "node:fs/promises";
import { dirname, join, posix, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = resolve(__dirname, "..");

// ── Canonical vocabulary ──────────────────────────────────────────

/**
 * Canonical 5-tier severity buckets from `governance/AUDIT.md` §Severity
 * Taxonomy. Case-insensitive matching when comparing structured-context
 * values, but the canonical artifacts (audit findings, regression-gate
 * tables, severity columns) consistently capitalize.
 */
export const CANONICAL_SEVERITIES = [
  "Critical",
  "High",
  "Medium",
  "Low",
  "Info",
] as const;

const CANONICAL_LC = new Set(CANONICAL_SEVERITIES.map((s) => s.toLowerCase()));

/**
 * Off-canonical severity terms encountered across the corpus. Each term
 * has a canonical equivalent documented in
 * `governance/audit/templates/severity-mapping.md`. Files emitting these
 * terms in a structured severity context MUST reference the mapping file
 * so consumers (fixer, reviewer) can round-trip the value to canonical.
 */
export const OFF_CANONICAL_TERMS = [
  "Moderate",
  "Major",
  "Minor",
  "Trivial",
  "Blocker",
  "Showstopper",
  "Severe",
  "Catastrophic",
  "Nominal",
  "Negligible",
] as const;

const OFF_CANONICAL_LC = new Set(OFF_CANONICAL_TERMS.map((s) => s.toLowerCase()));

/**
 * Canonical mapping reference. Files emitting any off-canonical term must
 * cite this path so the fixer / reviewer can map the value back to the
 * canonical 5-tier.
 */
export const MAPPING_REF = "severity-mapping.md";

/**
 * Directories scanned for `.md` artifacts. Mirrors the AUDIT-EXECUTE
 * regression gate scope plus the wider canonical content surface.
 */
export const DEFAULT_SCANNED_DIRS = [
  "agents",
  "checks",
  "commands",
  "rules",
  "skills",
  "hooks",
  "governance",
] as const;

// ── Types ─────────────────────────────────────────────────────────

export type Severity = "error" | "warning";

export interface Finding {
  level: Severity;
  code: string;
  file: string;
  line?: number;
  message: string;
}

export interface RunOptions {
  /** Absolute path to the repo root. Defaults to script's parent directory. */
  rootDir?: string;
  /** Override scanned directories (relative to rootDir). */
  scannedDirs?: readonly string[];
}

export interface RunResult {
  findings: Finding[];
  errorCount: number;
  warningCount: number;
  filesScanned: number;
}

// ── Path helpers ──────────────────────────────────────────────────

function toPosixRel(absPath: string, baseDir: string): string {
  return relative(baseDir, absPath).split(sep).join(posix.sep);
}

async function walkMarkdownFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  let entries: import("node:fs").Dirent[];
  try {
    entries = await readdir(dir, { withFileTypes: true });
    // Missing directories are informational: the orchestrator decides
    // which paths to seed (production repo vs. test tmpdir vs. partial
    // checkouts), so unseeded paths simply yield zero markdown files.
    // No diagnostic channel applies — absence is not a failure to surface.
    // eslint-disable-next-line silent-failure/no-silent-catch
  } catch {
    return out;
  }
  for (const e of entries) {
    const abs = join(dir, e.name);
    if (e.isDirectory()) {
      // Skip the audit workspace directory (transient, not canonical content).
      if (e.name.startsWith(".") || e.name === "node_modules") continue;
      out.push(...(await walkMarkdownFiles(abs)));
    } else if (e.isFile() && e.name.endsWith(".md")) {
      out.push(abs);
    }
  }
  return out;
}

// ── Structured-context detection ──────────────────────────────────

/**
 * A "structured severity context" is a line that emits a severity value
 * in a position consumers parse, not free prose. We match:
 *
 *   - Frontmatter `severity: Foo` (or `severity:` value across YAML scalar)
 *   - Table cells flanked by `|` (markdown tables) where the cell is just
 *     a severity word (possibly bolded)
 *   - List/bullet prefixes like `- **Foo** ...` or `* Foo:` when the cell
 *     starts with a severity word and is followed by a definition delimiter
 *   - Lines like `Severity: Foo`, `Level: Foo`, `Verdict: Foo` (case-insensitive)
 *   - Bracketed tags such as `[CRITICAL]`, `[MEDIUM]` — caller-emitted
 *     check-criteria style
 *
 * Returns the matched severity word and its position in the line. Returns
 * `null` if no structured emission is detected.
 */
export interface StructuredMatch {
  word: string;
  startCol: number;
  reason:
    | "frontmatter"
    | "table-cell"
    | "list-prefix"
    | "labeled-pair"
    | "bracket-tag";
}

const ALL_TERMS_PATTERN = `(?:${[...CANONICAL_SEVERITIES, ...OFF_CANONICAL_TERMS].join("|")})`;
const ALL_TERMS_RE = new RegExp(`\\b${ALL_TERMS_PATTERN}\\b`, "i");

// Frontmatter shape: `severity: Critical` or `level: high`. Spaces optional.
const FRONTMATTER_PAIR_RE = new RegExp(
  `^\\s*(?:severity|level|verdict|priority)\\s*:\\s*['"]?(${ALL_TERMS_PATTERN})['"]?\\s*$`,
  "i",
);

// Labeled prose pair on a single line in body: `Severity: Critical` /
// `Level: High`. Allows wrapping in bold (`**`) or italic (`*`) on both the
// label half and the value half, including the colon being inside the bold
// markers (`**Severity:**`).
const LABELED_PAIR_RE = new RegExp(
  `\\*{0,2}(?:severity|level|verdict|priority)\\s*[:=]\\s*\\*{0,2}\\s*\\*{0,2}(${ALL_TERMS_PATTERN})\\*{0,2}\\b`,
  "i",
);

// Bracket tag: `[CRITICAL]`, `[Medium]` etc.
const BRACKET_TAG_RE = new RegExp(`\\[(${ALL_TERMS_PATTERN})\\]`, "i");

// Markdown table cell: a row where every column boundary is `|`, and at
// least one cell is exactly a severity word (optionally wrapped in `**`).
const TABLE_LINE_RE = /^\s*\|.*\|\s*$/;
// Header/separator row: cells contain only dashes / colons / spaces.
const TABLE_SEPARATOR_RE = /^\s*\|[\s:\-|]+\|\s*$/;
const TABLE_CELL_SEVERITY_RE = new RegExp(
  `^\\s*\\*{0,2}(${ALL_TERMS_PATTERN})\\*{0,2}\\s*$`,
  "i",
);

// List prefix: `- **Critical** ...` / `* Critical: ...` / `1. Critical:`.
const LIST_PREFIX_RE = new RegExp(
  `^\\s*(?:[-*+]|\\d+\\.)\\s+\\*{0,2}(${ALL_TERMS_PATTERN})\\*{0,2}\\s*[:.\\-]`,
  "i",
);

/**
 * A column-header label that identifies the cell beneath it as a severity
 * emission. Matched case-insensitively against the trimmed cell content.
 */
const SEVERITY_COLUMN_HEADER_RE = /^\*{0,2}\s*(severity|level|verdict|priority|criticality)\s*\*{0,2}$/i;

/**
 * Per-line context tracked while scanning a file: which table we are inside
 * (so cells can be qualified against the column headers we already saw),
 * and the most recent severity-related heading (so list items emitted under
 * a "Severity Cataloging" heading get classified differently from list
 * items under "Semantic Versioning").
 */
export interface ScanContext {
  /** Column indices whose header is a severity label, or null when not in a table. */
  tableSeverityColumns: number[] | null;
  /** True when the nearest preceding `##`/`###` heading mentions severity. */
  underSeverityHeading: boolean;
}

const EMPTY_CONTEXT: ScanContext = {
  tableSeverityColumns: null,
  underSeverityHeading: false,
};

/**
 * Parse the cells of a markdown header row. Returns the 0-based column
 * indices whose header label is a severity-related word.
 */
function parseSeverityColumns(line: string): number[] {
  // Strip leading/trailing pipes for clean column indexing.
  const trimmed = line.replace(/^\s*\|/, "").replace(/\|\s*$/, "");
  const cells = trimmed.split("|");
  const cols: number[] = [];
  for (let i = 0; i < cells.length; i++) {
    if (SEVERITY_COLUMN_HEADER_RE.test(cells[i].trim())) cols.push(i);
  }
  return cols;
}

/**
 * Detect structured severity emissions on a line, taking the running
 * `ScanContext` into account. Frontmatter lines are detected when
 * `inFrontmatter` is true. Table cells are flagged only when the line is
 * inside a table whose header row had a severity-labeled column at the
 * same index.
 */
export function findStructuredMatches(
  line: string,
  inFrontmatter: boolean,
  context: ScanContext = EMPTY_CONTEXT,
): StructuredMatch[] {
  const matches: StructuredMatch[] = [];

  if (inFrontmatter) {
    const m = line.match(FRONTMATTER_PAIR_RE);
    if (m) {
      const word = m[1];
      const idx = line.toLowerCase().indexOf(word.toLowerCase());
      matches.push({
        word,
        startCol: idx < 0 ? 0 : idx,
        reason: "frontmatter",
      });
      return matches;
    }
    return matches;
  }

  // Bracket tag: scan all occurrences on the line.
  const bracketRe = new RegExp(BRACKET_TAG_RE.source, "gi");
  let bm: RegExpExecArray | null;
  while ((bm = bracketRe.exec(line)) !== null) {
    matches.push({
      word: bm[1],
      startCol: bm.index + 1, // skip the '['
      reason: "bracket-tag",
    });
  }

  // Labeled pair: a Severity:/Level:/Verdict: cue on the line.
  const lp = line.match(LABELED_PAIR_RE);
  if (lp) {
    const idx = line.toLowerCase().indexOf(lp[1].toLowerCase());
    matches.push({
      word: lp[1],
      startCol: idx < 0 ? 0 : idx,
      reason: "labeled-pair",
    });
  }

  // List prefix: `- **Foo**` or `* Foo:`. Only flagged when we are under a
  // section heading that mentions severity; otherwise the prefix likely
  // names a different domain bucket (SemVer Major/Minor/Patch, release
  // categories, etc.).
  if (context.underSeverityHeading) {
    const list = line.match(LIST_PREFIX_RE);
    if (list) {
      const idx = line.toLowerCase().indexOf(list[1].toLowerCase());
      matches.push({
        word: list[1],
        startCol: idx < 0 ? 0 : idx,
        reason: "list-prefix",
      });
    }
  }

  // Table row: split on `|` and check each cell, but ONLY at the column
  // indices whose header was a severity-related label. This rules out row
  // headers like `| Blocker | Business Impact | Fix Effort |` where the
  // first cell names the row's noun, not its severity.
  if (
    context.tableSeverityColumns !== null &&
    context.tableSeverityColumns.length > 0 &&
    TABLE_LINE_RE.test(line) &&
    !TABLE_SEPARATOR_RE.test(line)
  ) {
    // Match the indexing used when parsing the header row: strip leading
    // and trailing pipes before splitting.
    const trimmedLine = line.replace(/^\s*\|/, "").replace(/\|\s*$/, "");
    const cells = trimmedLine.split("|");
    // Compute each cell's start column inside the ORIGINAL line so we can
    // report meaningful positions.
    const leadingPipeIdx = line.indexOf("|");
    let runningCol = leadingPipeIdx + 1;
    for (let i = 0; i < cells.length; i++) {
      const cell = cells[i];
      if (context.tableSeverityColumns.includes(i)) {
        const cellTrim = cell.trim();
        if (cellTrim.length > 0) {
          const m = cellTrim.match(TABLE_CELL_SEVERITY_RE);
          if (m) {
            const cellInner = cell.indexOf(m[1]);
            const col = cellInner < 0 ? runningCol : runningCol + cellInner;
            matches.push({
              word: m[1],
              startCol: col,
              reason: "table-cell",
            });
          }
        }
      }
      runningCol += cell.length + 1; // +1 for the consumed `|`
    }
  }

  return matches;
}

const HEADING_RE = /^\s*#{1,6}\s+(.*?)\s*$/;
const SEVERITY_HEADING_RE = /\b(severity|criticality)\b/i;

// ── Frontmatter range ─────────────────────────────────────────────

/**
 * Identify the frontmatter range in a markdown file. Returns the 0-based
 * line indices [openLine, closeLine] inclusive, or null when no
 * frontmatter is present. The opening `---` must be on line 0.
 */
export function findFrontmatterRange(
  lines: readonly string[],
): { open: number; close: number } | null {
  if (lines.length < 2 || lines[0].trim() !== "---") return null;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === "---") return { open: 0, close: i };
  }
  return null;
}

// ── Core classifier ───────────────────────────────────────────────

/**
 * Decide whether a matched word is off-canonical. The 5 canonical tiers
 * are always acceptable (case-insensitive); everything else listed in
 * `OFF_CANONICAL_TERMS` is a violation unless the file references the
 * mapping.
 */
export function isOffCanonical(word: string): boolean {
  const lc = word.toLowerCase();
  if (CANONICAL_LC.has(lc)) return false;
  return OFF_CANONICAL_LC.has(lc);
}

export function hasMappingReference(content: string): boolean {
  return content.includes(MAPPING_REF);
}

// ── File scan ─────────────────────────────────────────────────────

export interface FileScanResult {
  /** All off-canonical structured emissions found on the file. */
  offCanonical: { line: number; word: string; reason: StructuredMatch["reason"] }[];
  hasMapping: boolean;
}

export function scanFileContent(content: string): FileScanResult {
  const lines = content.split("\n");
  const frontmatter = findFrontmatterRange(lines);
  const hasMapping = hasMappingReference(content);
  const offCanonical: FileScanResult["offCanonical"] = [];

  // Running scan context: maintained across lines so cells can be
  // qualified against the column headers that introduced their table.
  const context: ScanContext = {
    tableSeverityColumns: null,
    underSeverityHeading: false,
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const inFm =
      frontmatter !== null && i > frontmatter.open && i < frontmatter.close;

    // Update heading context. Frontmatter and lines inside it cannot be
    // markdown headings; outside frontmatter, any `#`-prefixed line resets
    // the running heading context.
    if (!inFm) {
      const h = line.match(HEADING_RE);
      if (h) {
        context.underSeverityHeading = SEVERITY_HEADING_RE.test(h[1]);
        // A heading also closes any preceding table.
        context.tableSeverityColumns = null;
      }
    }

    // Update table context. Header rows are followed by a separator row
    // (`| --- | --- |`). Detect "header + separator" pairs and capture the
    // severity-column indices for subsequent data rows.
    if (
      !inFm &&
      TABLE_LINE_RE.test(line) &&
      !TABLE_SEPARATOR_RE.test(line) &&
      i + 1 < lines.length &&
      TABLE_SEPARATOR_RE.test(lines[i + 1])
    ) {
      context.tableSeverityColumns = parseSeverityColumns(line);
    } else if (!inFm && !TABLE_LINE_RE.test(line) && line.trim() !== "") {
      // A non-table, non-blank line closes the current table context.
      context.tableSeverityColumns = null;
    }

    // Cheap pre-filter: if no severity-like token at all on the line, skip.
    if (!ALL_TERMS_RE.test(line)) continue;

    const matches = findStructuredMatches(line, inFm, context);
    for (const m of matches) {
      if (isOffCanonical(m.word)) {
        offCanonical.push({
          line: i + 1, // 1-based
          word: m.word,
          reason: m.reason,
        });
      }
    }
  }

  return { offCanonical, hasMapping };
}

// ── Orchestrator ──────────────────────────────────────────────────

export async function runValidator(opts: RunOptions = {}): Promise<RunResult> {
  const rootDir = opts.rootDir ?? ROOT;
  const dirs = opts.scannedDirs ?? DEFAULT_SCANNED_DIRS;

  const findings: Finding[] = [];
  let filesScanned = 0;

  for (const dir of dirs) {
    const abs = join(rootDir, dir);
    try {
      const s = await stat(abs);
      if (!s.isDirectory()) continue;
    } catch {
      // Missing scanned dir is informational; the validator is tolerant
      // because the same set is reused across test fixtures and real repos.
      continue;
    }
    const mdFiles = await walkMarkdownFiles(abs);
    for (const file of mdFiles) {
      filesScanned += 1;
      const raw = await readFile(file, "utf-8");
      const relPath = toPosixRel(file, rootDir);
      const { offCanonical, hasMapping } = scanFileContent(raw);

      if (offCanonical.length === 0) continue;

      if (!hasMapping) {
        // One aggregate file-level "missing mapping" finding plus a per-occurrence
        // finding so reviewers see both the systemic gap and every offending line.
        findings.push({
          level: "error",
          code: "SEVERITY-MAPPING-MISS",
          file: relPath,
          message: `emits ${offCanonical.length} off-canonical severity term(s) without referencing \`${MAPPING_REF}\``,
        });
        for (const occ of offCanonical) {
          findings.push({
            level: "error",
            code: "SEVERITY-OFF-CANONICAL",
            file: relPath,
            line: occ.line,
            message: `off-canonical "${occ.word}" in ${occ.reason}; canonical 5-tier is Critical|High|Medium|Low|Info (add a \`${MAPPING_REF}\` reference to document the mapping)`,
          });
        }
      }
      // When the file references the mapping, off-canonical terms are
      // permitted — the consumer round-trips them through the documented
      // table. We log neither errors nor warnings for those occurrences.
    }
  }

  let errorCount = 0;
  let warningCount = 0;
  for (const f of findings) {
    if (f.level === "error") errorCount += 1;
    else warningCount += 1;
  }
  return { findings, errorCount, warningCount, filesScanned };
}

// ── Output ────────────────────────────────────────────────────────

export function formatFinding(f: Finding): string {
  const tag = f.level === "error" ? "ERROR" : "WARN ";
  const where = f.line !== undefined ? `${f.file}:${f.line}` : f.file;
  return `[${tag} ${f.code}] ${where}: ${f.message}`;
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
    console.log(JSON.stringify(result, null, 2));
  } else {
    for (const f of result.findings) {
      const line = formatFinding(f);
      if (f.level === "error") console.error(line);
      else console.warn(line);
    }
    console.log(
      `validate-severity-vocabulary: ${result.filesScanned} file(s) scanned; ${result.errorCount} error(s), ${result.warningCount} warning(s)`,
    );
  }
  if (result.errorCount > 0) process.exit(1);
}

// Only auto-run when executed as a script, never when imported by tests.
const isMain = (() => {
  try {
    return resolve(process.argv[1] ?? "") === __filename;
    // The is-main detector defaults to "not main" if either argument
    // resolution throws. The fallback path is the test-import path; no
    // diagnostic channel applies because the resolution failure is not
    // an operator-visible event (tests intentionally invoke this module).
    // eslint-disable-next-line silent-failure/no-silent-catch
  } catch {
    return false;
  }
})();

if (isMain) {
  main().catch((err) => {
    console.error("validate-severity-vocabulary failed:", err);
    process.exit(1);
  });
}
