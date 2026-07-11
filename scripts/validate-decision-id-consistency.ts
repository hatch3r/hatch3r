#!/usr/bin/env node
/**
 * scripts/validate-decision-id-consistency.ts — F24.4-D24-5 (Cycle 11 D24 High).
 *
 * CONSTITUTION §6 "Key Design Decisions" register integrity gate. The §6 table
 * carries a leftmost `#` ordinal column plus in-body `Decision N` provenance
 * references inside the Rationale cells (the governance-evolution cycle that introduced
 * the row — see the §6 citation key, F24.4-H2). Two integrity classes had no
 * code gate:
 *
 *   - Ordinal collisions / gaps in the `#` column (the "canonical-ID
 *     collision" the finding leads with).
 *   - An in-body `Decision N` provenance pointer that resolves to no row.
 *
 * Checks (CI gate):
 *
 *   1. ORDINAL DENSITY: the §6 `#` column is exactly the contiguous sequence
 *      1..N (N = row count), each value appearing once. A duplicate or a gap
 *      is an error.
 *   2. PROVENANCE RESOLVABILITY: every `Decision N` reference inside the §6
 *      Rationale cells resolves to an ordinal in range 1..N.
 *   3. CORPUS CITATION PASS (D10-SA10.2-01, Cycle 12): scan the shipped
 *      canonical corpus (`rules/`, `agents/`, `commands/`, `skills/`,
 *      `hooks/`) for `Decision N` citations and validate each against the
 *      current §6 register:
 *        3a. DECISION-CITATION-DANGLING (error) — a cited ordinal outside
 *            1..N resolves to no row.
 *        3b. DECISION-CITATION-LEGACY (warning) — a citation matches a known
 *            legacy→canonical remap from the 2026-07-09 renumbering (EVOLVE
 *            run a2a16b59): legacy 23 (recap-contract iteration summary,
 *            now row 28) and legacy 24 (cost visibility, now row 29). The
 *            legacy ordinal collides with an unrelated live row (23 = spec
 *            agents, 24 = impact-gating), so the check is context-anchored:
 *            it fires only when the citing line matches the remap's topic
 *            keywords, never on correct citations of the live rows.
 *        3c. DECISION-REMAP-STALE (error) — self-guard: each remap's
 *            canonical row text must still match its topic keywords; a
 *            future renumbering that moves the rows again fails THIS
 *            validator until LEGACY_REMAPS is updated, instead of the map
 *            silently mis-flagging.
 *      Warnings do not affect the exit code — remaining legacy citations are
 *      drained through the audit cycle without breaking the gate.
 *
 * Scope note (tracked remainder): the finding's full remediation — single-key
 * renumbering of the in-body provenance IDs to one authority + PRD-title parity
 * + cross-file homonym sweep — routes through a CONSTITUTION §8 amendment (the
 * §6 citation key documents this as the open cross-file remainder). The
 * gitignored PRD is not available to CI, so PRD-title parity is out of scope
 * here. This gate locks the two always-checkable classes so future edits to the
 * register cannot reintroduce an ordinal collision or a dangling provenance
 * pointer; check 3 extends the same register authority outward to the corpus
 * that cites it (the citation-currency gap the 2026-07-09 renumbering left
 * open — deferred "as its owning wave lands" with no owner or gate).
 *
 * Usage:
 *   npm run validate:efficiency        (chained)
 *   tsx scripts/validate-decision-id-consistency.ts
 *   tsx scripts/validate-decision-id-consistency.ts --json
 *
 * Pillars: P5 (Governance Self-Quality), P4 (Lean Coverage).
 */
import { existsSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import { dirname, join, posix, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = resolve(__dirname, "..");

const CONSTITUTION_REL = "governance/CONSTITUTION.md";

/**
 * Shipped canonical corpus dirs whose `Decision N` citations resolve against
 * the §6 register (check 3). Matches the ship-verbatim subset of
 * `src/adapters/canonical.ts::readCanonicalFiles`.
 */
const CORPUS_DIRS = ["rules", "agents", "commands", "skills", "hooks"] as const;

/**
 * Legacy→canonical remaps from the 2026-07-09 §6 renumbering (EVOLVE run
 * a2a16b59). `contextRe` anchors the legacy check to the remap's topic so a
 * correct citation of the LIVE row bearing the legacy number (23 = spec
 * agents, 24 = impact-gated registration) never warns. `canonicalRowRe` is
 * the check-3c self-guard: it must match the canonical row's current table
 * text, otherwise the remap itself is stale and the validator errors.
 */
const LEGACY_REMAPS: ReadonlyArray<{
  legacy: number;
  canonical: number;
  topic: string;
  contextRe: RegExp;
  canonicalRowRe: RegExp;
}> = [
  {
    legacy: 23,
    canonical: 28,
    topic: "recap-contract iteration summary",
    contextRe: /recap|iteration summary|validation gate/i,
    canonicalRowRe: /recap/i,
  },
  {
    legacy: 24,
    canonical: 29,
    topic: "cost visibility",
    contextRe: /cost/i,
    canonicalRowRe: /cost visibility/i,
  },
];

export interface DecisionDrift {
  level: "error" | "warning";
  code: string;
  message: string;
}

export interface RunOptions {
  rootDir?: string;
}

export interface RunResult {
  /** True when the private CONSTITUTION was absent and the check skipped. */
  skipped: boolean;
  drifts: DecisionDrift[];
  rowCount: number;
  errorCount: number;
  warningCount: number;
}

/**
 * Slice the `## 6. Key Design Decisions` section body (up to the next `## `
 * header). Returns "" if the section is absent.
 */
export function sliceDecisionSection(body: string): string {
  const lines = body.split("\n");
  let start = -1;
  let end = lines.length;
  for (let i = 0; i < lines.length; i++) {
    if (/^##\s+6\.\s+Key Design Decisions/.test(lines[i])) {
      start = i;
      continue;
    }
    if (start !== -1 && /^##\s+\d+\./.test(lines[i]) && i > start) {
      end = i;
      break;
    }
  }
  if (start === -1) return "";
  return lines.slice(start, end).join("\n");
}

/** Extract the ordered list of `#`-column ordinals from the §6 table rows. */
export function parseRowOrdinals(section: string): number[] {
  const ordinals: number[] = [];
  for (const line of section.split("\n")) {
    // A data row begins `| <int> |` — the separator row (`|---|`) and the
    // header row (`| # |`) do not match a leading integer cell.
    const m = line.match(/^\|\s*(\d+)\s*\|/);
    if (m) ordinals.push(Number(m[1]));
  }
  return ordinals;
}

/** Map each §6 ordinal to its full table-row text (for the remap self-guard). */
export function parseRowTexts(section: string): Map<number, string> {
  const rows = new Map<number, string>();
  for (const line of section.split("\n")) {
    const m = line.match(/^\|\s*(\d+)\s*\|/);
    if (m) rows.set(Number(m[1]), line);
  }
  return rows;
}

// ── Check 3: corpus citation pass (D10-SA10.2-01) ─────────────────

const CITATION_RE = /Decision\s+#?(\d+)(?:\/(\d+))?/g;

function toPosixRel(absPath: string, baseDir: string): string {
  return relative(baseDir, absPath).split(sep).join(posix.sep);
}

/** Recursively list `.md`/`.mdc` files under a directory (absent dir → []). */
async function listCorpusFiles(dir: string): Promise<string[]> {
  let entries: import("node:fs").Dirent[];
  try {
    entries = await readdir(dir, { recursive: true, withFileTypes: true });
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (!entry.name.endsWith(".md") && !entry.name.endsWith(".mdc")) continue;
    const parent =
      entry.parentPath ?? (entry as unknown as { path: string }).path ?? dir;
    out.push(join(parent, entry.name));
  }
  return out.sort((a, b) => a.localeCompare(b));
}

/**
 * Scan one corpus file's lines for `Decision N` citations; emit
 * DECISION-CITATION-DANGLING (error) for out-of-range ordinals and
 * DECISION-CITATION-LEGACY (warning) for context-matched legacy ids.
 */
export function checkCorpusFileCitations(
  relPath: string,
  content: string,
  maxOrdinal: number,
): DecisionDrift[] {
  const drifts: DecisionDrift[] = [];
  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    CITATION_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = CITATION_RE.exec(line)) !== null) {
      const cited = Number(m[1]);
      const hedge = m[2] !== undefined ? Number(m[2]) : undefined;
      for (const ref of hedge === undefined ? [cited] : [cited, hedge]) {
        if (ref < 1 || ref > maxOrdinal) {
          drifts.push({
            level: "error",
            code: "DECISION-CITATION-DANGLING",
            message: `${relPath}:${i + 1}: "Decision ${ref}" resolves to no §6 row (valid range 1..${maxOrdinal}) (D10-SA10.2-01)`,
          });
        }
      }
      for (const remap of LEGACY_REMAPS) {
        if (cited !== remap.legacy) continue;
        if (!remap.contextRe.test(line)) continue;
        const cite = hedge === undefined ? `Decision ${cited}` : `Decision ${cited}/${hedge}`;
        drifts.push({
          level: "warning",
          code: "DECISION-CITATION-LEGACY",
          message:
            `${relPath}:${i + 1}: "${cite}" cites the legacy pre-2026-07-09 id for ${remap.topic}; ` +
            `the canonical row is Decision ${remap.canonical} (row ${remap.legacy} is now an unrelated decision) (D10-SA10.2-01)`,
        });
      }
    }
  }
  return drifts;
}

export async function runValidator(opts: RunOptions = {}): Promise<RunResult> {
  const rootDir = opts.rootDir ?? ROOT;
  const drifts: DecisionDrift[] = [];

  // Governance corpus is private (governance privatization initiative,
  // 2026-06-03) and absent in public clones / contributor CI. With no
  // CONSTITUTION §6 register to inspect, skip the whole check (exit clean) —
  // mirroring scripts/validate-governance-total.ts.
  const constitutionPath = join(rootDir, CONSTITUTION_REL);
  if (!existsSync(constitutionPath)) {
    // The corpus pass (check 3) also skips here: its remap self-guard (3c)
    // needs the §6 table, and running the legacy map unverified in public CI
    // would emit warnings that nothing can prove current.
    return { skipped: true, drifts: [], rowCount: 0, errorCount: 0, warningCount: 0 };
  }

  const body = await readFile(constitutionPath, "utf-8");
  const section = sliceDecisionSection(body);
  if (section === "") {
    drifts.push({
      level: "error",
      code: "DECISION-SECTION-MISSING",
      message: `${CONSTITUTION_REL}: "## 6. Key Design Decisions" section not found`,
    });
    return { skipped: false, drifts, rowCount: 0, errorCount: drifts.length, warningCount: 0 };
  }

  const ordinals = parseRowOrdinals(section);
  const n = ordinals.length;

  // Check 1 — ordinal density (contiguous 1..N, each once).
  const seen = new Map<number, number>();
  for (const o of ordinals) seen.set(o, (seen.get(o) ?? 0) + 1);
  for (const [o, count] of seen) {
    if (count > 1) {
      drifts.push({
        level: "error",
        code: "DECISION-ORDINAL-DUPLICATE",
        message: `§6 Decision register: ordinal ${o} appears ${count} times in the # column — ordinals must be unique (F24.4-D24-5)`,
      });
    }
  }
  for (let expected = 1; expected <= n; expected++) {
    if (!seen.has(expected)) {
      drifts.push({
        level: "error",
        code: "DECISION-ORDINAL-GAP",
        message: `§6 Decision register: ordinal ${expected} missing from the # column (rows = ${n}); the column must be contiguous 1..${n} (F24.4-D24-5)`,
      });
    }
  }

  // Check 2 — in-body `Decision N` provenance pointers resolve to a real row.
  const maxOrdinal = n;
  const refRe = /Decision\s+#?(\d+)/g;
  let m: RegExpExecArray | null;
  while ((m = refRe.exec(section)) !== null) {
    const ref = Number(m[1]);
    if (ref < 1 || ref > maxOrdinal) {
      drifts.push({
        level: "error",
        code: "DECISION-PROVENANCE-DANGLING",
        message: `§6 Decision register: in-body "Decision ${ref}" reference resolves to no row (valid range 1..${maxOrdinal}) (F24.4-D24-5)`,
      });
    }
  }

  // Check 3c — remap self-guard: each canonical row must still carry its
  // topic text; otherwise the LEGACY_REMAPS table itself has rotted.
  const rowTexts = parseRowTexts(section);
  for (const remap of LEGACY_REMAPS) {
    const rowText = rowTexts.get(remap.canonical);
    if (rowText === undefined || !remap.canonicalRowRe.test(rowText)) {
      drifts.push({
        level: "error",
        code: "DECISION-REMAP-STALE",
        message:
          `§6 row ${remap.canonical} no longer matches ${remap.canonicalRowRe} (${remap.topic}); ` +
          `the LEGACY_REMAPS table in scripts/validate-decision-id-consistency.ts is stale — update it before trusting corpus warnings (D10-SA10.2-01)`,
      });
    }
  }

  // Check 3a/3b — corpus citation pass over the shipped canonical dirs.
  for (const dir of CORPUS_DIRS) {
    const files = await listCorpusFiles(join(rootDir, dir));
    for (const absPath of files) {
      const content = await readFile(absPath, "utf-8");
      drifts.push(
        ...checkCorpusFileCitations(toPosixRel(absPath, rootDir), content, maxOrdinal),
      );
    }
  }

  let errorCount = 0;
  let warningCount = 0;
  for (const d of drifts) {
    if (d.level === "error") errorCount += 1;
    else warningCount += 1;
  }
  return { skipped: false, drifts, rowCount: n, errorCount, warningCount };
}

// ── Output formatting ─────────────────────────────────────────────

export function formatDrift(d: DecisionDrift): string {
  const tag = d.level === "error" ? "ERROR" : "WARN ";
  return `[${tag} ${d.code}] ${d.message}`;
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
  if (result.skipped) {
    // eslint-disable-next-line no-console
    if (flags.json) console.log(JSON.stringify(result, null, 2));
    // eslint-disable-next-line no-console
    else
      console.log(
        `validate-decision-id-consistency: skipped — ${CONSTITUTION_REL} absent (private-corpus public CI)`,
      );
    return;
  }
  if (flags.json) {
    // eslint-disable-next-line no-console
    console.log(JSON.stringify(result, null, 2));
  } else {
    for (const d of result.drifts) {
      // eslint-disable-next-line no-console
      if (d.level === "error") console.error(formatDrift(d));
      else console.warn(formatDrift(d));
    }
    // eslint-disable-next-line no-console
    console.log(
      `validate-decision-id-consistency: ${result.rowCount} decision row(s), ${result.errorCount} error(s), ${result.warningCount} warning(s)`,
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
    console.error("validate-decision-id-consistency failed:", err);
    process.exit(1);
  });
}
