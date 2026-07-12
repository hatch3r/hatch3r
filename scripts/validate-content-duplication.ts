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
 *     granularity mirrors jscpd's `--min-lines`; the leading YAML frontmatter
 *     block (`stripFrontmatter`) and trivial lines (blank, fence-only,
 *     frontmatter/HR delimiters) are excluded so prose is compared on
 *     substantive BODY content, matching jscpd's tokenizer ignoring whitespace.
 *   - jscpd's markdown mode tokenizes fenced code blocks independently by
 *     language (github.com/kucherenko/jscpd FORMATS.md), so two unrelated
 *     artifacts that each embed a JSON or CSS block are reported as a cross-file
 *     "clone" on shared structural tokens (`{ } " : ,`) — a false positive whose
 *     first-file and second-file line spans are unequal (Cycle 12 D22-SA22.2-06:
 *     a 61-line vs 15-line span between `design-system-detection.md` and
 *     `findings-ledger.md`). This detector compares normalized whole lines, not
 *     language-tokenized fence contents, so it does not fabricate those matches;
 *     it agrees with jscpd where real line-for-line duplication exists (commands/)
 *     and diverges only on the fence artifact. Cite THIS gate's `--report` for
 *     corpus duplication percentages, not raw `jscpd --format markdown`.
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
 *
 * Known blind spot (Cycle 12 D6-SA6.2-04, Info — recorded, no gate change this
 * cycle): a clone shorter than WINDOW_LINES consecutive non-trivial lines is
 * never counted, so the single- and double-line "constant-framing" class (a
 * one-line Tier-calibration intro, a one-line threshold sentence) is invisible
 * to this metric — the reported percentages are a floor for that class, not the
 * true figure. This matches jscpd's own default (`minLines: 5`), which skips
 * sub-window clones too, so the gate is faithful to the clone model, not
 * defective. Lowering the window to 1 line is NOT the fix: it would false-
 * positive on the intended DRY pointer lines ("Follow the shared protocol in
 * `agents/shared/...`", "See ... §External Knowledge") that appear 9-10x BY
 * DESIGN. Gating the constant-framing class directly needs a pointer-aware
 * exclusion; until then the correct remedy is lifting a repeated block to a
 * shared companion at the source (the D6-SA6.2-01 frame-lift), not a window change.
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
  // D6-5 / D22-4 extraction target. Measured 13.82% (jscpd) / 14.43% (this
  // gate's line-window metric, frontmatter INCLUDED) at Cycle 12; D22-4 lifted
  // the seven recurring orchestration scaffold blocks (§0 Detect Ambiguity,
  // Confidence Propagation Contract, Checkpoint Contract, Per-Turn Pipeline-
  // State Header, End-of-Turn Delegation Attestation, Cost Estimate, Effort
  // Override) into `commands/shared/orchestration-frame.md` and replaced the
  // inline copies with one-line pointers. Cycle 12 D22-SA22.2-05 then excluded
  // YAML frontmatter from the metric (`stripFrontmatter`, above), re-basing the
  // commands measurement to 6.41% (662/10335 body lines) — the residual is
  // command-specific recurring body patterns plus the identical pointer lines
  // themselves; reaching DEFAULT_MAX (5) needs command-shape consolidation or a
  // pointer-aware exclusion, both tracked under sibling finding D6-5. Ceiling
  // ratcheted 12 -> 7 (ceil of the 6.41% ex-frontmatter measurement) to re-lock
  // the gain under the new metric — leaving it at 12 would silently tolerate a
  // 5.6 pt regression the metric change had removed. The gate fails the moment
  // the corpus regresses past 7%; lower further toward 5 as D6-5 collapses the
  // remaining inline restatement, and delete the row once it reaches DEFAULT_MAX.
  commands: 7,
  // agents row removed at Cycle 12 D22-SA22.2-05: it existed only to absorb the
  // near-identical CQ-specialist frontmatter (`phase_4_trigger`/`efficiency_tier`/
  // `wall_clock_advisory_ms`), which the adapter reads per-artifact and cannot be
  // pointerized. Excluding frontmatter from the metric (`stripFrontmatter`, above)
  // dropped agents/ from 5.41% to 0.38% (22/5734 body lines) — back under
  // DEFAULT_MAX (5), so the relaxation row is deleted per the ratchet policy.
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

/**
 * Strip a leading YAML frontmatter block — the lines delimited by an opening
 * `---` on line 1 and the next `---` line, inclusive — from raw file content,
 * returning the body that follows.
 *
 * Frontmatter is per-artifact config (`id`/`type`/`description`/`tags`, plus the
 * CQ-specialist `phase_4_trigger`/`efficiency_tier`/`wall_clock_advisory_ms`/
 * `parallel_tool_default` blocks). The adapter reads each artifact's frontmatter
 * directly — `src/adapters/canonical.ts` ships bodies verbatim and frontmatter is
 * per-file config, not pointerizable prose — so a near-identical config block
 * repeated across N specialist agents has no shared-companion extraction path the
 * way body prose does. Counting it as duplication produces an irreducible floor
 * that no legitimate extraction can drive down: agents/ measured 5.41% WITH
 * frontmatter but 0.18% body-only (Cycle 12 D22-SA22.2-05). Excluding the block
 * makes the metric reflect EXTRACTABLE duplication, which is what the
 * CONSTITUTION §2 P5 "Cross-file duplication | <5%" target is meant to gate.
 *
 * A file whose first line is not `---`, or that opens with `---` but has no
 * closing `---`, has no recognizable frontmatter and is returned unchanged (the
 * `skills/**` `references/*.md` reference files carry no frontmatter and are left
 * intact).
 */
export function stripFrontmatter(raw: string): string {
  const lines = raw.split("\n");
  if (lines[0]?.trim() !== "---") return raw;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i]?.trim() === "---") {
      return lines.slice(i + 1).join("\n");
    }
  }
  // Opening delimiter with no close — not valid frontmatter; leave content intact.
  return raw;
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
      const lines = stripFrontmatter(raw)
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
