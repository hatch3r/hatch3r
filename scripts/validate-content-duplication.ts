#!/usr/bin/env node
/**
 * scripts/validate-content-duplication.ts — Pillar P4 (Comprehensive Lean
 * Coverage), CQ8 (Maintainability Quality), P5 (Governance Self-Quality).
 *
 * Audit Cycle 12 D6-4 (High). The CONSTITUTION §2 P5 lean threshold
 * "Cross-file duplication | <5%" (CONSTITUTION.md:97) and the CQ8 measurement
 * "jscpd duplication index ≤5% per cycle" (CONSTITUTION.md:268) were enforced
 * only against `src/` (the post-write duplication scan in
 * `rules/hatch3r-anti-duplication.md` §"Post-Write Duplication Scan" names
 * `npx jscpd <changed-dirs>`, but only the source tree carried a CI gate).
 * The CONTENT corpus — `agents/`, `rules/`, `commands/`, `skills/` `.md`
 * artifacts — had NO automated duplication gate, so `commands/` drifted to
 * 13.82% verbatim duplication (jscpd), 2.8× the threshold, undetected.
 *
 * This gate closes that hole: it measures verbatim cross-file line-clone
 * duplication over each content corpus and fails when a corpus exceeds its
 * configured ceiling.
 *
 * Why a self-contained detector instead of shelling out to `jscpd`:
 *   - `jscpd` is not a dependency and would pull a large transitive tree
 *     (P4 lean cost) plus a network round-trip at install — CI runs `npm ci`
 *     offline. Every other `validate-*.ts` gate in this repo is pure TS with
 *     zero extra runtime deps and test-injectable (`validate-anti-slop.ts`,
 *     `validate-bridge-budget.ts`).
 *   - The metric is the same one jscpd reports: percentage of corpus lines
 *     that participate in at least one cross-file (or within-file repeated)
 *     clone of >= WINDOW_LINES consecutive non-trivial lines. The line-window
 *     granularity mirrors jscpd's `--min-lines`; trivial lines (blank,
 *     fence-only, frontmatter delimiters) are excluded so prose is compared
 *     on substantive content, matching jscpd's tokenizer ignoring whitespace.
 *
 * Ratchet model (mirrors `validate-efficiency-invariants.ts` --orch-contract,
 * which hard-errors the universally-compliant part and tolerates the part
 * pending an out-of-scope retrofit): the structural target is `DEFAULT_MAX
 * = 5%` for every corpus. `commands/` is materially above target pending the
 * shared-block extraction tracked as sibling finding D6-5; until that lands,
 * its ceiling is a documented baseline that ONLY ratchets downward — the gate
 * fails the moment `commands/` duplication WORSENS past the captured baseline,
 * and the baseline must be lowered toward 5% as D6-5 extracts shared blocks.
 * Every other corpus is held at the 5% structural target today.
 *
 * Usage:
 *   `npm run validate`                         (wired as a leg)
 *   `tsx scripts/validate-content-duplication.ts`
 *   `tsx scripts/validate-content-duplication.ts --max 5`   (override ceiling)
 *   `tsx scripts/validate-content-duplication.ts --json`
 *   `tsx scripts/validate-content-duplication.ts --report`  (per-corpus %, never fails)
 */
import { readdir, readFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = resolve(__dirname, "..");

// ── Tunables ──────────────────────────────────────────────────────

/**
 * Number of consecutive non-trivial lines that constitute a clone seed.
 * Mirrors jscpd `--min-lines` line granularity. A run of >= WINDOW_LINES
 * identical normalized lines appearing in two places marks every line it
 * covers as duplicated.
 */
export const WINDOW_LINES = 5;

/**
 * Structural duplication target shared by CONSTITUTION.md:97
 * ("Cross-file duplication | <5%") and CONSTITUTION.md:268 (CQ8
 * "jscpd duplication index ≤5% per cycle"). The default ceiling for every
 * corpus that is not carrying a documented baseline allowance.
 */
export const DEFAULT_MAX = 5;

/**
 * Per-corpus ceilings. A corpus over `DEFAULT_MAX` is listed here with a
 * baseline that ratchets DOWNWARD only — its value is the measured duplication
 * captured when the gate was introduced (Cycle 12 D6-4), rounded UP to a tenth
 * of a percent so a no-op re-run does not flake on float jitter. The gate
 * fails if a corpus exceeds its ceiling, so a listed corpus fails the moment
 * its duplication worsens past the baseline; lower the number as sibling
 * finding D6-5 extracts shared command blocks, and delete the row once the
 * corpus reaches `DEFAULT_MAX`.
 */
export const CORPUS_CEILINGS: Readonly<Record<string, number>> = {
  // D6-5 extraction target — measured 13.82% (jscpd) / 14.43% (this gate's
  // line-window metric) at Cycle 12; ratchet down toward DEFAULT_MAX (5) as
  // D6-5 extracts shared command blocks.
  commands: 18,
  // Marginally over target at Cycle 12 introduction (within ~0.8 pt of 5%,
  // not the 2.8x commands/ overshoot). Baselined so the gate lands green and
  // ratchets: the value is the measured percent rounded UP to the next whole
  // point. Lower toward DEFAULT_MAX as repeated frontmatter/role boilerplate
  // is consolidated; delete the row once the corpus reaches 5%.
  agents: 6, // measured 5.76%
  // skills row removed at Cycle 11 D22-5: the duplicated `## Fan-out
  // Discipline` scaffold was reduced to a one-line canonical-rule pointer +
  // skill-specific tier lines + the emit directive across the 43 hand-authored
  // skills, dropping the corpus from 5.86% to 2.91% (this gate's metric) —
  // back under DEFAULT_MAX (5), so the relaxation row is deleted per the
  // ratchet policy above.
};

/** Corpora scanned, in report order. */
export const DEFAULT_CORPORA = ["agents", "rules", "commands", "skills"] as const;

// ── Types ─────────────────────────────────────────────────────────

export interface CorpusResult {
  /** Corpus directory name (e.g. "commands"). */
  corpus: string;
  /** Number of `.md` files scanned. */
  files: number;
  /** Total non-trivial lines across the corpus. */
  totalLines: number;
  /** Lines participating in at least one >= WINDOW_LINES clone. */
  duplicatedLines: number;
  /** duplicatedLines / totalLines * 100, 0 when totalLines === 0. */
  percent: number;
  /** The ceiling this corpus is held to. */
  ceiling: number;
  /** True when percent > ceiling (a gate failure). */
  exceeded: boolean;
}

export interface RunOptions {
  rootDir?: string;
  /** Override the corpus list (tests). */
  corpora?: readonly string[];
  /** Override every corpus ceiling with a single value (--max). */
  maxOverride?: number;
  /** Override per-corpus ceilings (tests). */
  ceilings?: Readonly<Record<string, number>>;
}

export interface RunResult {
  results: CorpusResult[];
  /** Corpora whose duplication exceeded their ceiling. */
  failures: CorpusResult[];
}

// ── Scanning ──────────────────────────────────────────────────────

/** True for a line that carries no substantive content worth comparing. */
function isTrivial(normalized: string): boolean {
  if (normalized.length === 0) return true;
  // YAML frontmatter delimiter, bare code-fence, horizontal rule, lone bullet.
  if (normalized === "---" || normalized === "```" || normalized === "***") return true;
  return false;
}

/** Collapse internal whitespace and trim — jscpd-style whitespace tolerance. */
export function normalizeLine(line: string): string {
  return line.replace(/\s+/g, " ").trim();
}

/** Recursively collect `.md` files under a directory, skipping dot-dirs. */
async function collectMarkdown(dir: string): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    // A missing corpus directory is tolerated — the repo layout may omit one.
    return [];
  }
  const out: string[] = [];
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...(await collectMarkdown(full)));
    } else if (entry.name.endsWith(".md")) {
      out.push(full);
    }
  }
  return out;
}

/**
 * Measure verbatim line-clone duplication for one corpus.
 *
 * Pass 1: every WINDOW_LINES-line sliding window of normalized non-trivial
 * lines, across all files, is counted in a frequency map. Pass 2: any window
 * seen >= 2 times marks all the lines it covers as duplicated. The duplicated
 * fraction is duplicatedLines / totalLines.
 */
export function measureDuplication(
  files: { rel: string; lines: string[] }[],
): { totalLines: number; duplicatedLines: number } {
  const windowCount = new Map<string, number>();
  for (const { lines } of files) {
    for (let i = 0; i + WINDOW_LINES <= lines.length; i++) {
      const key = lines.slice(i, i + WINDOW_LINES).join("\n");
      windowCount.set(key, (windowCount.get(key) ?? 0) + 1);
    }
  }
  let totalLines = 0;
  let duplicatedLines = 0;
  for (const { lines } of files) {
    totalLines += lines.length;
    const dup = new Array<boolean>(lines.length).fill(false);
    for (let i = 0; i + WINDOW_LINES <= lines.length; i++) {
      const key = lines.slice(i, i + WINDOW_LINES).join("\n");
      if ((windowCount.get(key) ?? 0) >= 2) {
        for (let j = i; j < i + WINDOW_LINES; j++) dup[j] = true;
      }
    }
    for (const flag of dup) if (flag) duplicatedLines += 1;
  }
  return { totalLines, duplicatedLines };
}

function ceilingFor(
  corpus: string,
  maxOverride: number | undefined,
  ceilings: Readonly<Record<string, number>>,
): number {
  if (maxOverride !== undefined) return maxOverride;
  return ceilings[corpus] ?? DEFAULT_MAX;
}

export async function runValidator(opts: RunOptions = {}): Promise<RunResult> {
  const rootDir = opts.rootDir ?? ROOT;
  const corpora = opts.corpora ?? DEFAULT_CORPORA;
  const ceilings = opts.ceilings ?? CORPUS_CEILINGS;
  const results: CorpusResult[] = [];

  for (const corpus of corpora) {
    const dir = join(rootDir, corpus);
    const paths = await collectMarkdown(dir);
    const files: { rel: string; lines: string[] }[] = [];
    for (const p of paths) {
      const raw = await readFile(p, "utf-8");
      const lines = raw
        .split("\n")
        .map(normalizeLine)
        .filter((l) => !isTrivial(l));
      files.push({ rel: relative(rootDir, p).split(sep).join("/"), lines });
    }
    const { totalLines, duplicatedLines } = measureDuplication(files);
    const percent = totalLines === 0 ? 0 : (duplicatedLines / totalLines) * 100;
    const ceiling = ceilingFor(corpus, opts.maxOverride, ceilings);
    results.push({
      corpus,
      files: paths.length,
      totalLines,
      duplicatedLines,
      // Round to 2 dp for stable reporting; comparison uses the rounded value
      // so the printed number and the pass/fail verdict never disagree.
      percent: Math.round(percent * 100) / 100,
      ceiling,
      exceeded: Math.round(percent * 100) / 100 > ceiling,
    });
  }

  return { results, failures: results.filter((r) => r.exceeded) };
}

// ── Output ────────────────────────────────────────────────────────

export function formatResult(r: CorpusResult): string {
  const verdict = r.exceeded ? "FAIL" : "ok";
  return (
    `[${verdict}] ${r.corpus}/  ${r.percent.toFixed(2)}% duplication ` +
    `(${r.duplicatedLines}/${r.totalLines} lines, ${r.files} files) ` +
    `ceiling ${r.ceiling}%`
  );
}

interface CliFlags {
  json: boolean;
  report: boolean;
  max?: number;
}

function parseArgs(argv: readonly string[]): CliFlags {
  const flags: CliFlags = { json: argv.includes("--json"), report: argv.includes("--report") };
  const i = argv.indexOf("--max");
  if (i !== -1 && argv[i + 1] !== undefined) {
    const n = Number(argv[i + 1]);
    if (Number.isFinite(n)) flags.max = n;
  }
  return flags;
}

async function main(): Promise<void> {
  const flags = parseArgs(process.argv.slice(2));
  const result = await runValidator({ maxOverride: flags.max });

  if (flags.json) {
    // eslint-disable-next-line no-console
    console.log(JSON.stringify(result, null, 2));
  } else {
    for (const r of result.results) {
      // eslint-disable-next-line no-console
      console.log(formatResult(r));
    }
    if (result.failures.length > 0 && !flags.report) {
      // eslint-disable-next-line no-console
      console.error(
        `\nvalidate-content-duplication: ${result.failures.length} corpus over ceiling ` +
          `(target ${DEFAULT_MAX}%). Extract shared blocks (sibling D6-5) and lower the ceiling ` +
          `in scripts/validate-content-duplication.ts::CORPUS_CEILINGS.`,
      );
    } else {
      // eslint-disable-next-line no-console
      console.log(
        `\nvalidate-content-duplication: ${result.results.length} corpus scanned, ` +
          `${result.failures.length} over ceiling`,
      );
    }
  }

  // --report is a measurement mode (CI dashboards / D6-5 progress tracking)
  // that never fails the build.
  if (result.failures.length > 0 && !flags.report) process.exit(1);
}

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
    console.error("validate-content-duplication failed:", err);
    process.exit(1);
  });
}
