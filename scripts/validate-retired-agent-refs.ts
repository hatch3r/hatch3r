#!/usr/bin/env node
/**
 * scripts/validate-retired-agent-refs.ts — Cycle 11 D5-16
 * (cross-artifact terminology consistency).
 *
 * The 2.0.0 hard-cut (CONSTITUTION §6 Decision 12) retired three pre-2.0.0
 * meta-agent ids and folded their scope into the CQ-vector specialists. The
 * frontmatter `agentPipeline:` lists were updated, but ~20 operational lines
 * across 10 artifacts still named the retired ids in dispatch, menu, and
 * result-table contexts — a drift that points a reader at an agent file that
 * no longer exists. This gate keeps the scrub from regressing.
 *
 * Retired id → canonical id:
 *
 *   test-writer       → hatch3r-testability   (CQ5)
 *   security-auditor  → hatch3r-security      (CQ3)
 *   perf-profiler     → hatch3r-performance   (CQ7)
 *
 * Scans `.md`/`.mdc` files under the runtime content directories (agents,
 * checks, commands, rules, skills, hooks) for word-bounded occurrences of a
 * retired id. Each occurrence emits one ERROR finding naming the canonical
 * replacement, EXCEPT:
 *
 *   1. Legacy notes — a line that co-occurs with `legacy` OR `retired`
 *      (case-insensitive) is a documented historical reference that
 *      intentionally cites the old id to explain the retirement (e.g.
 *      "absorbs legacy security-auditor scope" in
 *      `rules/hatch3r-agent-orchestration.md`, or "the perf-profiler delegate
 *      was retired in 2.0.0" in `agents/hatch3r-performance.md`). Preserved.
 *   2. Exempt files — `agents/shared/severity-mapping.md` enumerates the
 *      historical vocabulary-owning roles (reference doc, governed by the
 *      severity-vocabulary SSoT), not live dispatch targets; its frontmatter
 *      description and pillar-service prose name the old roles as history.
 *
 * Scope note: the `governance/` audit machinery (AUDIT.md prompt, domain
 * checklists, AUDIT-REPORT.md, archived past-cycle reports) is intentionally
 * out of scan scope. Those records legitimately quote the retired ids when
 * describing or checking for this very drift; scrubbing them would erase the
 * diagnostic record. D5-16 targets operational lines in runtime content
 * artifacts only (every one of the 10 artifacts the finding lists lives under
 * the runtime content dirs above).
 *
 * Failure mode (one ERROR per offending occurrence):
 *
 *   RETIRED-AGENT-REF  Retired meta-agent id in an operational context.
 *                      Replace with the canonical CQ-specialist id.
 *
 * Pillars: P5 (Governance Self-Quality), P4 (Lean Coverage).
 *
 * Usage:
 *   `npm run validate:retired-agent-refs`     (wired in package.json)
 *   `tsx scripts/validate-retired-agent-refs.ts`
 *   `tsx scripts/validate-retired-agent-refs.ts --json`
 */
import { readdir, readFile, stat } from "node:fs/promises";
import { dirname, join, posix, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = resolve(__dirname, "..");

// ── Retired-id map ────────────────────────────────────────────────

/**
 * Pre-2.0.0 meta-agent ids and their canonical CQ-specialist replacements.
 * The retired strings are never substrings of any canonical id (e.g.
 * `hatch3r-testability` does not contain `test-writer`), so a word-bounded
 * match is unambiguous.
 */
export const RETIRED_ID_MAP: Readonly<Record<string, string>> = {
  "test-writer": "hatch3r-testability",
  "security-auditor": "hatch3r-security",
  "perf-profiler": "hatch3r-performance",
};

export const RETIRED_IDS = Object.keys(RETIRED_ID_MAP);

/**
 * Per-line opt-out cue. A line that mentions `legacy` or `retired` is treated
 * as a historical note that intentionally cites the retired id to document the
 * 2.0.0 retirement; it is not a live dispatch reference. Matched
 * case-insensitively.
 */
export const LEGACY_CUE_RE = /\b(?:legacy|retired)\b/i;

/**
 * Files exempt from the scan in full. `severity-mapping.md` is the canonical
 * severity-vocabulary SSoT; its frontmatter description and pillar-service
 * prose enumerate the historical vocabulary-owning roles (reference doc),
 * not live agent-dispatch targets. Paths are repo-root-relative POSIX.
 */
export const EXEMPT_FILES: ReadonlySet<string> = new Set([
  "agents/shared/severity-mapping.md",
]);

/**
 * Directories scanned for `.md`/`.mdc` artifacts: the runtime content surface
 * only. `governance/` is deliberately excluded (see the Scope note in the file
 * header) — audit records quote the retired ids as diagnostic data.
 */
export const DEFAULT_SCANNED_DIRS = [
  "agents",
  "checks",
  "commands",
  "rules",
  "skills",
  "hooks",
] as const;

/**
 * Extensions scanned. `.mdc` is included so the Cursor rule twins are kept
 * in lockstep with their `.md` source.
 */
const SCANNED_EXTENSIONS = [".md", ".mdc"] as const;

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

function hasScannedExtension(name: string): boolean {
  return SCANNED_EXTENSIONS.some((ext) => name.endsWith(ext));
}

async function walkContentFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  let entries: import("node:fs").Dirent[];
  try {
    entries = await readdir(dir, { withFileTypes: true });
    // Missing directories are informational: the same dir set is reused
    // across test fixtures and real repos (the private `governance/` tree is
    // absent in public clones), so an unseeded path simply yields zero files.
    // eslint-disable-next-line silent-failure/no-silent-catch
  } catch {
    return out;
  }
  for (const e of entries) {
    const abs = join(dir, e.name);
    if (e.isDirectory()) {
      // Skip dotfile dirs (e.g. the transient .audit-workspace) and deps.
      if (e.name.startsWith(".") || e.name === "node_modules") continue;
      out.push(...(await walkContentFiles(abs)));
    } else if (e.isFile() && hasScannedExtension(e.name)) {
      out.push(abs);
    }
  }
  return out;
}

// ── Per-line detection ────────────────────────────────────────────

/**
 * Build the word-bounded retired-id matcher. Hyphens are not word
 * characters, so a plain `\b` on each side of the hyphenated id correctly
 * isolates `test-writer` from a longer run while still matching it inside
 * parenthesized lists and bullet prose.
 */
const RETIRED_PATTERN = `(?:${RETIRED_IDS.join("|")})`;
const RETIRED_RE = new RegExp(`\\b${RETIRED_PATTERN}\\b`, "g");

export interface LineHit {
  id: string;
  startCol: number;
}

/**
 * Return every retired-id occurrence on a single line. The `legacy` opt-out
 * is applied by the caller (it depends on the whole line), so this function
 * reports raw occurrences only.
 */
export function findRetiredIdsOnLine(line: string): LineHit[] {
  const hits: LineHit[] = [];
  RETIRED_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = RETIRED_RE.exec(line)) !== null) {
    hits.push({ id: m[0], startCol: m.index });
  }
  return hits;
}

export interface FileScanResult {
  hits: { line: number; id: string }[];
}

/**
 * Scan one file's content. Lines that match the `legacy` cue are skipped
 * (documented historical notes). All other retired-id occurrences are
 * reported with their 1-based line number.
 */
export function scanFileContent(content: string): FileScanResult {
  const lines = content.split("\n");
  const hits: FileScanResult["hits"] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Cheap pre-filter: skip lines with no retired-id substring at all.
    if (!RETIRED_IDS.some((id) => line.includes(id))) continue;
    if (LEGACY_CUE_RE.test(line)) continue; // documented legacy note
    for (const hit of findRetiredIdsOnLine(line)) {
      hits.push({ line: i + 1, id: hit.id });
    }
  }
  return { hits };
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
      // Missing scanned dir is informational: the same set is reused across
      // test fixtures and real repos, so an unseeded path yields zero files
      // while the remaining content dirs continue to be scanned. No operator
      // channel applies — absence is not a failure to surface.
      continue;
    }
    const files = await walkContentFiles(abs);
    for (const file of files) {
      const relPath = toPosixRel(file, rootDir);
      if (EXEMPT_FILES.has(relPath)) continue;
      filesScanned += 1;
      const raw = await readFile(file, "utf-8");
      const { hits } = scanFileContent(raw);
      for (const hit of hits) {
        const canonical = RETIRED_ID_MAP[hit.id];
        findings.push({
          level: "error",
          code: "RETIRED-AGENT-REF",
          file: relPath,
          line: hit.line,
          message: `retired agent id "${hit.id}" in an operational context — replace with canonical "${canonical}" (2.0.0 hard-cut, CONSTITUTION §6 Decision 12). If this is a historical note, mention "legacy" on the line to opt out.`,
        });
      }
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
      `validate-retired-agent-refs: ${result.filesScanned} file(s) scanned; ${result.errorCount} error(s), ${result.warningCount} warning(s)`,
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
    // diagnostic channel applies because the resolution failure is not an
    // operator-visible event (tests intentionally invoke this module).
    // eslint-disable-next-line silent-failure/no-silent-catch
  } catch {
    return false;
  }
})();

if (isMain) {
  main().catch((err) => {
    console.error("validate-retired-agent-refs failed:", err);
    process.exit(1);
  });
}
