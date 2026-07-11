#!/usr/bin/env node
/**
 * scripts/validate-learnings-consultation-keys.ts — Cycle 12 D6-SA6.5-01
 * ("the conditional learnings-consultation is mis-keyed on retired
 * `area`/`tags`/`category` fields in 9 commands — a silent, corpus-wide no-op
 * against canonically-written learnings").
 *
 * Pillars: P7 (Speed & Token Efficiency — the SA6.5 lazy-load only fires when
 *          the match predicate can be true), P5 (Governance Self-Quality —
 *          a purpose-built gate so a future half-migration cannot pass green),
 *          P4 (Lean Coverage — single-source-of-truth on the match schema).
 *
 * Problem this closes: the learnings schema was unified — `rules/hatch3r-
 * learning-system.md` retires `category`/`area`/`tags` as match keys in favor
 * of `topic` (lookup) + `applies-to` (path-glob binding). The writer
 * (`skills/hatch3r-learn`) and the reader agents (`hatch3r-implementer`,
 * `-researcher`, `-learnings-loader`) migrated, but a set of orchestrator
 * COMMANDS kept instructing "Match by area and tags", which matches ZERO rows
 * of any canonically-written learning — the consultation silently no-ops. The
 * runtime injection/structure gate (`src/content/learningsValidation.ts`) does
 * NOT catch this — it validates learning FILES, not the framework's consulting
 * artifacts. This gate binds those artifacts to the canonical match keys.
 *
 * Check performed:
 *
 *   Scan every `.md` under commands/, agents/, skills/, rules/. A line is a
 *   FINDING when it is a learnings-consultation MATCH directive keyed on a
 *   retired field (`area`/`tags`/`category`) AND no canonical key
 *   (`applies-to`/`topic`) appears within a ±3-line window. A migrated line
 *   naming `applies-to`/`topic` — with or without a transitional legacy
 *   fallback — is NOT flagged.
 *
 * ERROR-level by design (unlike the staleness gates): a mis-keyed consultation
 * is a definite defect (a guaranteed no-op), not a drift-over-time warning, so
 * a hit fails the run. The default (no flags) exits non-zero on any finding.
 *
 * Usage:
 *   npm run validate:efficiency        (chained)
 *   tsx scripts/validate-learnings-consultation-keys.ts
 *   tsx scripts/validate-learnings-consultation-keys.ts --json
 */
import { readdir, readFile, stat } from "node:fs/promises";
import { dirname, join, posix, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = resolve(__dirname, "..");

/** Shipped content dirs that carry consultation directives. */
const DEFAULT_SCAN_DIRS = ["commands", "agents", "skills", "rules"];

/** Repo-relative POSIX path — a portable, cross-OS diagnostic id. */
function toPosixRel(absPath: string, baseDir: string): string {
  return relative(baseDir, absPath).split(sep).join(posix.sep);
}

// ── Detection patterns ─────────────────────────────────────────────

/**
 * Learnings-consultation MATCH directives keyed on a retired field. Each
 * bundles a match verb (`match by`, `matching`, `scan ... frontmatter`,
 * `for ... /`) with a retired key (`area(s)`/`tag(s)`), so an unrelated
 * `area:*` issue-label mention (no match verb) is never matched. The
 * learnings-context gate below further constrains these to consultation blocks.
 */
const RETIRED_MATCH_PATTERNS: readonly RegExp[] = [
  /\bmatch(?:ing|ed)?\s+by\b[^.\n]*\b(?:areas?|tags?)\b/i,
  /\bmatching\s+[`']?(?:areas?|tags?)\b/i,
  /\bfor\s+(?:matching\s+)?[`']?(?:areas?|tags?)[`']?\s*(?:\/|\bor\b|\band\b)\s*[`']?(?:areas?|tags?)\b/i,
  /[`'](?:areas?|tags?)[`']\s+and\s+[`'](?:areas?|tags?)[`']/i,
  /\bscan\b[^.\n]*\bfrontmatter\b[^.\n]*\b(?:areas?|tags?)\b/i,
];

/** A line references the learnings system (used as a ±3-line context gate). */
const LEARNINGS_SIGNAL = /\blearnings?\b|\.hatch3r\/learnings\//i;

/** The canonical match keys — their presence in the window clears a line. */
const CANONICAL_KEY = /\bapplies-to\b|\btopic\b/i;

/** How many lines above/below a candidate to search for context + escape keys. */
const WINDOW = 3;

// ── Types ───────────────────────────────────────────────────────────

export interface Finding {
  /** Repo-relative POSIX path of the offending file. */
  file: string;
  /** 1-based line number of the mis-keyed directive. */
  line: number;
  /** The offending line text (trimmed). */
  text: string;
  message: string;
}

export interface RunOptions {
  /** Override repo root; defaults to the script root. */
  rootDir?: string;
  /** Override the scanned dirs (relative to rootDir). */
  scanDirs?: readonly string[];
}

export interface RunResult {
  findings: Finding[];
  /** Number of `.md` files inspected. */
  checkedFiles: number;
}

// ── Discovery ───────────────────────────────────────────────────────

/** Recursively list every `.md` file under `absDir`. Missing dir → []. */
async function listMarkdown(absDir: string): Promise<string[]> {
  let entries: import("node:fs").Dirent[];
  try {
    entries = await readdir(absDir, { withFileTypes: true });
  } catch { // eslint-disable-line silent-failure/no-silent-catch
    return []; // Missing dir — skipped, not a fault.
  }
  const out: string[] = [];
  for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const abs = join(absDir, e.name);
    if (e.isDirectory()) {
      out.push(...(await listMarkdown(abs)));
    } else if (e.isFile() && e.name.endsWith(".md")) {
      out.push(abs);
    }
  }
  return out;
}

// ── Core check ──────────────────────────────────────────────────────

/**
 * Scan one file body for mis-keyed learnings-consultation directives. Pure —
 * exported so tests exercise the detection without touching the filesystem.
 */
export function scanBody(body: string, file: string): Finding[] {
  const lines = body.split("\n");
  const findings: Finding[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!RETIRED_MATCH_PATTERNS.some((re) => re.test(line))) continue;

    const ctxStart = Math.max(0, i - WINDOW);
    const winEnd = Math.min(lines.length, i + WINDOW + 1);
    const window = lines.slice(ctxStart, winEnd);

    // Learnings context: this line or a nearby line references learnings.
    if (!window.some((l) => LEARNINGS_SIGNAL.test(l))) continue;
    // Escape: a canonical key in the window means the line is migrated.
    if (window.some((l) => CANONICAL_KEY.test(l))) continue;

    findings.push({
      file,
      line: i + 1,
      text: line.trim(),
      message:
        `learnings-consultation directive keyed on retired \`area\`/\`tags\` ` +
        `without \`applies-to\`/\`topic\` (D6-SA6.5-01). The learn skill emits ` +
        `only \`topic\`/\`applies-to\`, so this scan matches zero rows and ` +
        `silently no-ops. Migrate to the canonical match keys per ` +
        `rules/hatch3r-learning-system.md (a transitional \`area\`/\`tags\` ` +
        `fallback is fine once \`applies-to\`/\`topic\` is named).`,
    });
  }
  return findings;
}

export async function runValidator(opts: RunOptions = {}): Promise<RunResult> {
  const rootDir = opts.rootDir ?? ROOT;
  const scanDirs = opts.scanDirs ?? DEFAULT_SCAN_DIRS;
  const findings: Finding[] = [];
  let checkedFiles = 0;

  for (const dir of scanDirs) {
    const absDir = join(rootDir, dir);
    const files = await listMarkdown(absDir);
    for (const abs of files) {
      let raw: string;
      try {
        raw = await readFile(abs, "utf-8");
      } catch { // eslint-disable-line silent-failure/no-silent-catch
        continue; // Vanished file — not a gate fault.
      }
      checkedFiles += 1;
      const rel = abs.startsWith(rootDir) ? toPosixRel(abs, rootDir) : abs;
      findings.push(...scanBody(raw, rel));
    }
  }

  return { findings, checkedFiles };
}

// ── Output ──────────────────────────────────────────────────────────

export function formatFinding(f: Finding): string {
  return `[ERROR LEARN-CONSULT-KEY] ${f.file}:${f.line}: ${f.message}\n    > ${f.text}`;
}

async function main(): Promise<void> {
  const json = process.argv.slice(2).includes("--json");
  const result = await runValidator();
  if (json) {
    // eslint-disable-next-line no-console
    console.log(JSON.stringify(result, null, 2));
  } else {
    for (const f of result.findings) {
      // eslint-disable-next-line no-console
      console.error(formatFinding(f));
    }
    // eslint-disable-next-line no-console
    console.log(
      `validate-learnings-consultation-keys: ${result.checkedFiles} file(s) ` +
        `checked; ${result.findings.length} mis-keyed directive(s)`,
    );
  }
  if (result.findings.length > 0) process.exit(1);
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
    console.error("validate-learnings-consultation-keys failed:", err);
    process.exit(1);
  });
}
