#!/usr/bin/env node
/**
 * scripts/validate-pricing-currency.ts — Cycle 11 D6-22
 * ("currency gate absence: no currency gate guards embedded pricing while
 * CLI-tool versions DO have version-pinned tests — rates drift indefinitely
 * with no failing check; D6-6 is the realized drift").
 *
 * Pillars: P3 (Adapter & External Tool Currency — embedded per-token rates are
 *          re-fetched on a bounded window, same discipline as CLI/MCP version
 *          and CVE feeds), P2 (Scientific & Practical Quality — measurable,
 *          dated provenance), P5 (Governance Self-Quality).
 *
 * Problem this closes: `skills/hatch3r-cost-tracking/SKILL.md` carries an
 * embedded named-model price table (model id + input/output per 1M + an
 * `accessed` date column). Anthropic re-prices between model releases, so the
 * realized D6-6 drift (a 3-5x-stale tier table) sat in the corpus with no
 * failing check. The CLI-tool and MCP version surfaces already have currency
 * gates (`scripts/check-cli-cves.ts`, `scripts/check-mcp-cves.ts`,
 * version-pinned skill tests); pricing had none. This gate restores parity:
 * it parses every embedded price table's `accessed:` dates and flags any row
 * older than a 90-day window.
 *
 * Window rationale (90 days): the cost-tracking skill's own Step 2a sets a
 * 30-day re-fetch RECOMMENDATION for an author actively running a cost report.
 * This CI gate is the looser hard backstop — 90 days is the same staleness
 * window P3 applies to platform/tool currency research per audit cycle
 * (`governance/audit/domains/D02`/`D09` per-cycle re-verification), so a row
 * untouched across a normal release cadence still surfaces here before it
 * drifts as far as D6-6 did. A row inside 30 days is fresh; 30-90 days is
 * tolerated silently; >90 days is flagged.
 *
 * WARNING-LEVEL by design (the fix column specifies "warning/failing"): this
 * gate emits WARN findings and exits 0 by default so a price row crossing the
 * 90-day line in the middle of an unrelated change set never reds the green
 * baseline (the same exit-0 contract as `validate-references-currency.ts`).
 * `--strict` promotes every staleness warning to an error and exits non-zero —
 * the mode a dedicated P3 currency cycle (or a release gate) runs to FAIL on
 * stale pricing. The default warning stream is the always-on backstop that
 * makes drift visible in CI rather than silent (the D6-22 root cause).
 *
 * Check performed:
 *
 *   For every scanned skill containing a markdown price table (a table whose
 *   header row carries both an `accessed` column AND a price-signal column —
 *   `input`, `output`, `rate`, `per 1M`, `per million`, or `$`), each data
 *   row's `accessed` cell must hold an ISO date (YYYY-MM-DD) no older than the
 *   window. A row with a stale date is PRICING-STALE; a price-table row whose
 *   `accessed` cell has no parseable ISO date is PRICING-NO-DATE (a price with
 *   no provenance date is unverifiable). A table with an `accessed` column but
 *   no price-signal column is ignored (not a price table).
 *
 * Usage:
 *   npm run validate:efficiency        (chained, warning-level)
 *   tsx scripts/validate-pricing-currency.ts
 *   tsx scripts/validate-pricing-currency.ts --strict   (fail on stale)
 *   tsx scripts/validate-pricing-currency.ts --json
 */
import { readdir, readFile, stat } from "node:fs/promises";
import { dirname, join, posix, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = resolve(__dirname, "..");

// Canonical skills tree. Each `skills/<name>/SKILL.md` is one artifact.
const DEFAULT_SKILLS_DIR = "skills";

/** Default staleness window in days (see the window rationale in the header). */
export const DEFAULT_WINDOW_DAYS = 90;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Repo-relative path in POSIX (`/`) form regardless of host OS. The `file`
 * field is a portable, cross-OS diagnostic id (and the surface tests match on),
 * so a Windows `\` separator must never leak into it.
 */
function toPosixRel(absPath: string, baseDir: string): string {
  return relative(baseDir, absPath).split(sep).join(posix.sep);
}

// An ISO date (YYYY-MM-DD) anywhere in a cell.
const ISO_DATE_RE = /(\d{4})-(\d{2})-(\d{2})/;

/**
 * Header tokens that mark a price column. A price table is a markdown table
 * whose header carries an `accessed` column AND at least one of these. Kept to
 * the vocabulary the cost-tracking table actually uses (`input (per 1M)`,
 * `output (per 1M)`) plus the obvious synonyms, so the gate does not
 * false-positive on a non-price table that happens to have an `accessed`
 * column.
 */
const PRICE_HEADER_RE = /\b(input|output|rate|per\s*1m|per\s*million)\b|\$/i;
const ACCESSED_HEADER_RE = /\baccessed\b/i;

// ── Types ─────────────────────────────────────────────────────────

type Severity = "error" | "warning";

export interface Finding {
  level: Severity;
  code: string;
  /** Repo-relative path of the offending skill file. */
  file: string;
  /** 1-based line number of the offending table row. */
  line: number;
  message: string;
}

export interface RunOptions {
  /** Override repo root; defaults to the script root. */
  rootDir?: string;
  /** Override the skills directory (relative to rootDir). */
  skillsDir?: string;
  /** Staleness window in days. Defaults to {@link DEFAULT_WINDOW_DAYS}. */
  windowDays?: number;
  /** Reference "now" timestamp (ms) for deterministic tests. Defaults to Date.now(). */
  nowTs?: number;
  /** Promote staleness warnings to errors (fail mode). Default false. */
  strict?: boolean;
}

export interface RunResult {
  findings: Finding[];
  errorCount: number;
  warningCount: number;
  /** Number of SKILL.md files inspected. */
  checkedSkills: number;
  /** Number of price tables found across all skills. */
  priceTables: number;
  /** Number of price-table data rows inspected. */
  priceRows: number;
}

// ── Discovery ─────────────────────────────────────────────────────

/**
 * List every `skills/<name>/SKILL.md` under the skills dir. A missing skills
 * dir yields an empty list (skipped, not a fault) so tests can point at a
 * tmpdir with no skills.
 */
async function listSkillFiles(absSkillsDir: string): Promise<string[]> {
  let entries: string[];
  try {
    entries = await readdir(absSkillsDir);
  } catch { // eslint-disable-line silent-failure/no-silent-catch
    // Missing skills dir — return empty (skipped, not a fault).
    return [];
  }
  const out: string[] = [];
  for (const name of entries.sort((a, b) => a.localeCompare(b))) {
    const dir = join(absSkillsDir, name);
    let s;
    try {
      s = await stat(dir);
    } catch { // eslint-disable-line silent-failure/no-silent-catch
      // Unreadable entry — skip it.
      continue;
    }
    if (!s.isDirectory()) continue;
    const skillPath = join(dir, "SKILL.md");
    try {
      const fs = await stat(skillPath);
      if (fs.isFile()) out.push(skillPath);
    } catch { // eslint-disable-line silent-failure/no-silent-catch
      // No SKILL.md in this directory — skip silently.
    }
  }
  return out;
}

// ── Price-table parsing ────────────────────────────────────────────

/** Split a markdown table row into trimmed cells (leading/trailing `|` dropped). */
function splitRow(line: string): string[] {
  let s = line.trim();
  if (s.startsWith("|")) s = s.slice(1);
  if (s.endsWith("|")) s = s.slice(0, -1);
  return s.split("|").map((c) => c.trim());
}

/** A markdown table is a `|`-delimited line followed by a `---` separator row. */
function isSeparatorRow(line: string): boolean {
  const cells = splitRow(line);
  if (cells.length === 0) return false;
  return cells.every((c) => /^:?-{1,}:?$/.test(c));
}

interface PriceRow {
  /** 1-based line number of the data row. */
  line: number;
  /** The `accessed` cell text. */
  accessedCell: string;
}

interface PriceTable {
  /** 0-based index of the `accessed` column. */
  accessedCol: number;
  rows: PriceRow[];
}

/**
 * Find every price table in a body and return its data rows. A price table is
 * a markdown table whose header row carries both an `accessed` column and a
 * price-signal column. Returns the `accessed`-column index and each data row's
 * `accessed` cell + line number. Non-price tables (no price-signal column) are
 * skipped. The `accessed` column index is captured from the header so the
 * check reads the correct cell even when column order varies.
 */
function findPriceTables(body: string): PriceTable[] {
  const lines = body.split("\n");
  const tables: PriceTable[] = [];
  for (let i = 0; i < lines.length - 1; i++) {
    const header = lines[i];
    // A header candidate is a pipe row immediately followed by a separator row.
    if (!header.includes("|")) continue;
    if (!isSeparatorRow(lines[i + 1])) continue;

    const headerCells = splitRow(header);
    const accessedCol = headerCells.findIndex((c) => ACCESSED_HEADER_RE.test(c));
    if (accessedCol === -1) continue;
    const hasPriceCol = headerCells.some((c) => PRICE_HEADER_RE.test(c));
    if (!hasPriceCol) continue;

    // Walk data rows from after the separator to the first non-table line.
    const rows: PriceRow[] = [];
    let j = i + 2;
    for (; j < lines.length; j++) {
      const row = lines[j];
      if (!row.includes("|") || row.trim() === "") break;
      if (isSeparatorRow(row)) continue;
      const cells = splitRow(row);
      // Bold-row sub-notes or short rows that do not reach the accessed column
      // are not price data rows.
      if (cells.length <= accessedCol) continue;
      rows.push({ line: j + 1, accessedCell: cells[accessedCol] });
    }
    tables.push({ accessedCol, rows });
    // Resume scanning after this table to avoid re-detecting its data rows.
    i = j - 1;
  }
  return tables;
}

/** Parse an ISO date into a comparable UTC timestamp, or null if none found. */
function parseIsoDate(text: string): { ts: number; iso: string } | null {
  const m = text.match(ISO_DATE_RE);
  if (!m) return null;
  const iso = `${m[1]}-${m[2]}-${m[3]}`;
  const ts = Date.parse(`${iso}T00:00:00Z`);
  if (Number.isNaN(ts)) return null;
  return { ts, iso };
}

// ── Core check ────────────────────────────────────────────────────

export async function runValidator(opts: RunOptions = {}): Promise<RunResult> {
  const rootDir = opts.rootDir ?? ROOT;
  const skillsRel = opts.skillsDir ?? DEFAULT_SKILLS_DIR;
  const absSkillsDir = join(rootDir, skillsRel);
  const windowDays = opts.windowDays ?? DEFAULT_WINDOW_DAYS;
  const nowTs = opts.nowTs ?? Date.now();
  const staleLevel: Severity = opts.strict ? "error" : "warning";

  const skillFiles = await listSkillFiles(absSkillsDir);
  const findings: Finding[] = [];
  let priceTables = 0;
  let priceRows = 0;

  for (const abs of skillFiles) {
    let raw: string;
    try {
      raw = await readFile(abs, "utf-8");
    } catch { // eslint-disable-line silent-failure/no-silent-catch
      // Unreadable SKILL.md — skip it (a vanished file is not a gate fault).
      continue;
    }
    const rel = abs.startsWith(rootDir) ? toPosixRel(abs, rootDir) : abs;
    const tables = findPriceTables(raw);
    priceTables += tables.length;

    for (const table of tables) {
      for (const row of table.rows) {
        priceRows += 1;
        const parsed = parseIsoDate(row.accessedCell);
        if (!parsed) {
          findings.push({
            level: staleLevel,
            code: "PRICING-NO-DATE",
            file: rel,
            line: row.line,
            message:
              `price-table row has no parseable \`accessed:\` ISO date in its ` +
              `accessed cell (D6-22). A per-token rate without a provenance ` +
              `date is unverifiable — add an "accessed YYYY-MM-DD" cell.`,
          });
          continue;
        }
        const ageDays = Math.floor((nowTs - parsed.ts) / MS_PER_DAY);
        if (ageDays > windowDays) {
          findings.push({
            level: staleLevel,
            code: "PRICING-STALE",
            file: rel,
            line: row.line,
            message:
              `price-table row \`accessed: ${parsed.iso}\` is ${ageDays} day(s) ` +
              `old (> ${windowDays}-day window, D6-22). Re-fetch the vendor's ` +
              `current pricing and update the row's rates + accessed date.`,
          });
        }
      }
    }
  }

  let errorCount = 0;
  let warningCount = 0;
  for (const f of findings) {
    if (f.level === "error") errorCount += 1;
    else warningCount += 1;
  }

  return {
    findings,
    errorCount,
    warningCount,
    checkedSkills: skillFiles.length,
    priceTables,
    priceRows,
  };
}

// ── Output ────────────────────────────────────────────────────────

export function formatFinding(f: Finding): string {
  const tag = f.level === "error" ? "ERROR" : "WARN ";
  const loc = f.line > 0 ? `${f.file}:${f.line}` : f.file;
  return `[${tag} ${f.code}] ${loc}: ${f.message}`;
}

interface CliFlags {
  json: boolean;
  strict: boolean;
}

function parseArgs(argv: readonly string[]): CliFlags {
  return { json: argv.includes("--json"), strict: argv.includes("--strict") };
}

async function main(): Promise<void> {
  const flags = parseArgs(process.argv.slice(2));
  const result = await runValidator({ strict: flags.strict });
  if (flags.json) {
    // eslint-disable-next-line no-console
    console.log(JSON.stringify(result, null, 2));
  } else {
    for (const f of result.findings) {
      const line = formatFinding(f);
      // eslint-disable-next-line no-console
      if (f.level === "error") console.error(line);
      // eslint-disable-next-line no-console
      else console.warn(line);
    }
    // eslint-disable-next-line no-console
    console.log(
      `validate-pricing-currency: ${result.checkedSkills} skill(s) checked ` +
        `(${result.priceTables} price table(s), ${result.priceRows} row(s)); ` +
        `${result.errorCount} error(s), ${result.warningCount} warning(s)`,
    );
  }
  // Default (warning) mode exits 0; --strict promotes staleness to errors,
  // which exit non-zero here.
  if (result.errorCount > 0) process.exit(1);
}

// Only auto-run when executed as a script, never when imported by tests.
const isMain = (() => {
  try {
    return resolve(process.argv[1] ?? "") === __filename;
  } catch { // eslint-disable-line silent-failure/no-silent-catch
    return false;
  }
})();

if (isMain) {
  main().catch((err) => {
    // eslint-disable-next-line no-console
    console.error("validate-pricing-currency failed:", err);
    process.exit(1);
  });
}
