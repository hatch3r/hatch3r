#!/usr/bin/env node
/**
 * scripts/validate-decision-id-consistency.ts — F24.4-D24-5 (Cycle 11 D24 High).
 *
 * CONSTITUTION §6 "Key Design Decisions" register integrity gate. The §6 table
 * carries a leftmost `#` ordinal column plus in-body `Decision N` provenance
 * references inside the Rationale cells (the RE-ENVISION cycle that introduced
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
 *
 * Scope note (tracked remainder): the finding's full remediation — single-key
 * renumbering of the in-body provenance IDs to one authority + PRD-title parity
 * + cross-file homonym sweep — routes through a CONSTITUTION §8 amendment (the
 * §6 citation key documents this as the open cross-file remainder). The
 * gitignored PRD is not available to CI, so PRD-title parity is out of scope
 * here. This gate locks the two always-checkable classes so future edits to the
 * register cannot reintroduce an ordinal collision or a dangling provenance
 * pointer.
 *
 * Usage:
 *   npm run validate:efficiency        (chained)
 *   tsx scripts/validate-decision-id-consistency.ts
 *   tsx scripts/validate-decision-id-consistency.ts --json
 *
 * Pillars: P5 (Governance Self-Quality), P4 (Lean Coverage).
 */
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = resolve(__dirname, "..");

const CONSTITUTION_REL = "governance/CONSTITUTION.md";

export interface DecisionDrift {
  level: "error";
  code: string;
  message: string;
}

export interface RunOptions {
  rootDir?: string;
}

export interface RunResult {
  drifts: DecisionDrift[];
  rowCount: number;
  errorCount: number;
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

export async function runValidator(opts: RunOptions = {}): Promise<RunResult> {
  const rootDir = opts.rootDir ?? ROOT;
  const drifts: DecisionDrift[] = [];

  const body = await readFile(join(rootDir, CONSTITUTION_REL), "utf-8");
  const section = sliceDecisionSection(body);
  if (section === "") {
    drifts.push({
      level: "error",
      code: "DECISION-SECTION-MISSING",
      message: `${CONSTITUTION_REL}: "## 6. Key Design Decisions" section not found`,
    });
    return { drifts, rowCount: 0, errorCount: drifts.length };
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

  return { drifts, rowCount: n, errorCount: drifts.length };
}

// ── Output formatting ─────────────────────────────────────────────

export function formatDrift(d: DecisionDrift): string {
  return `[ERROR ${d.code}] ${d.message}`;
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
    for (const d of result.drifts) {
      // eslint-disable-next-line no-console
      console.error(formatDrift(d));
    }
    // eslint-disable-next-line no-console
    console.log(
      `validate-decision-id-consistency: ${result.rowCount} decision row(s), ${result.errorCount} error(s)`,
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
