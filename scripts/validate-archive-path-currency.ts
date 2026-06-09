#!/usr/bin/env node
/**
 * scripts/validate-archive-path-currency.ts — Cycle 11 D10-31
 * (archive path doc drift: docs cited a `.hatch3r/archive/<tool>/` path that
 * the code never writes).
 *
 * The single source of truth for the tool-output archive directory is
 * `ARCHIVE_DIR` in `src/types.ts` (`.hatch3r-archive`). `archiveToolOutputs`
 * (src/archive/index.ts) writes to `<ARCHIVE_DIR>/<tool>/<timestamp>-<runId>/`
 * — note the hyphen in `.hatch3r-archive` AND the timestamp level. The docs at
 * `website/docs/getting-started/supported-tools.md` drifted to
 * `.hatch3r/archive/<tool>/` (slash, no timestamp), so the documented recovery
 * `mv .hatch3r/archive/<tool>/* …` glob pointed at a path that does not exist
 * (D10-31). This gate keeps the corrected docs from regressing.
 *
 * The forbidden literal is derived from `ARCHIVE_DIR` itself
 * (`ARCHIVE_DIR.replace("-", "/")` = `.hatch3r/archive`) so the gate tracks the
 * constant: if `ARCHIVE_DIR` is ever renamed, the needle moves with it and the
 * probe keeps checking the live source-of-truth rather than a hard-coded
 * string. The correct path `.hatch3r-archive` does not contain the substring
 * `.hatch3r/archive`, so accurate doc usage never trips this check.
 *
 * Scanned surface: every `*.md` under `docs/` and `website/docs/`. The
 * generated Docusaurus output under `website/build/` is NOT scanned (it is
 * rebuilt from the `.md` sources, so flagging it would double-count and reds a
 * green baseline until the next build). The `governance/` tree is also not
 * scanned: audit records (AUDIT-REPORT.md, domain checklists) legitimately
 * quote the drifted path when describing or checking for this very drift.
 *
 * Failure mode (one ERROR per offending occurrence):
 *
 *   ARCHIVE-PATH-DRIFT  Doc cites the non-existent `.hatch3r/archive/...`
 *                       path. The real archive dir is `<ARCHIVE_DIR>/<tool>/
 *                       <timestamp>/`; the supported restore is
 *                       `hatch3r rollback --session=config-<timestamp>`.
 *
 * Pillars: P1 (CLI UI/UX — a recovery command users copy/paste must reference a
 *          real path), P5 (Governance Self-Quality — self-detectable doc/code
 *          drift), P4 (Lean Coverage — single-source-of-truth path string).
 *
 * Usage:
 *   `npm run validate:archive-path`            (wired in package.json)
 *   `tsx scripts/validate-archive-path-currency.ts`
 *   `tsx scripts/validate-archive-path-currency.ts --json`
 *   `tsx scripts/validate-archive-path-currency.ts --root <dir>`
 */
import { readdir, readFile, stat } from "node:fs/promises";
import { dirname, join, posix, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { ARCHIVE_DIR } from "../src/types.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = resolve(__dirname, "..");

// ── Path drift definition ─────────────────────────────────────────

/**
 * The forbidden drifted literal, derived from the live `ARCHIVE_DIR` constant
 * so the gate tracks renames of the source of truth. `.hatch3r-archive` becomes
 * `.hatch3r/archive` when the separating hyphen is mistyped as a path
 * separator — the exact drift D10-31 remediates.
 */
export const DRIFTED_PATH = ARCHIVE_DIR.replace("-", "/");

/**
 * Directories whose `*.md` documentation files are scanned. The Docusaurus
 * build output (`website/build`) is intentionally excluded — it is regenerated
 * from these sources.
 */
export const DEFAULT_DOC_DIRS = ["docs", join("website", "docs")] as const;

// ── Types ─────────────────────────────────────────────────────────

export type Severity = "error" | "warning";

export interface Finding {
  level: Severity;
  code: string;
  file: string;
  line: number;
  message: string;
}

export interface RunOptions {
  /** Absolute path to the repo root. Defaults to the script's parent dir. */
  rootDir?: string;
  /** Override scanned directories (relative to rootDir). */
  docDirs?: readonly string[];
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

/** Recursively collect every `*.md` file under `dir`. */
async function listMarkdown(dir: string): Promise<string[]> {
  let entries: string[];
  try {
    entries = await readdir(dir);
    // A missing doc dir is informational: the same set is reused across test
    // fixtures and real repos, so an unseeded path simply yields zero files.
    // eslint-disable-next-line silent-failure/no-silent-catch
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const name of entries.sort((a, b) => a.localeCompare(b))) {
    const full = join(dir, name);
    let s;
    try {
      s = await stat(full);
    } catch {
      continue;
    }
    if (s.isDirectory()) {
      out.push(...(await listMarkdown(full)));
    } else if (s.isFile() && name.endsWith(".md")) {
      out.push(full);
    }
  }
  return out;
}

// ── Per-line detection ────────────────────────────────────────────

export interface FileScanResult {
  hits: { line: number }[];
}

/**
 * Scan one file's content for the drifted archive-path literal. Every
 * occurrence is reported with its 1-based line number.
 */
export function scanFileContent(content: string): FileScanResult {
  const lines = content.split(/\r?\n/);
  const hits: FileScanResult["hits"] = [];
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes(DRIFTED_PATH)) {
      hits.push({ line: i + 1 });
    }
  }
  return { hits };
}

// ── Orchestrator ──────────────────────────────────────────────────

export async function runValidator(opts: RunOptions = {}): Promise<RunResult> {
  const rootDir = opts.rootDir ?? ROOT;
  const dirs = opts.docDirs ?? DEFAULT_DOC_DIRS;

  const findings: Finding[] = [];
  let filesScanned = 0;

  for (const dir of dirs) {
    const abs = join(rootDir, dir);
    const files = await listMarkdown(abs);
    for (const file of files) {
      const relPath = toPosixRel(file, rootDir);
      filesScanned += 1;
      const raw = await readFile(file, "utf-8");
      const { hits } = scanFileContent(raw);
      for (const hit of hits) {
        findings.push({
          level: "error",
          code: "ARCHIVE-PATH-DRIFT",
          file: relPath,
          line: hit.line,
          message:
            `doc cites the non-existent path "${DRIFTED_PATH}/..." — the real tool-output archive is ` +
            `"${ARCHIVE_DIR}/<tool>/<timestamp>/" (src/types.ts ARCHIVE_DIR + src/archive/index.ts), and ` +
            `the supported restore is "hatch3r rollback --session=config-<timestamp>" (the archive is gitignored ` +
            `and removed by "hatch3r clean"). Fix the path to "${ARCHIVE_DIR}/" with the timestamp level (D10-31).`,
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
  return `[${tag} ${f.code}] ${f.file}:${f.line}: ${f.message}`;
}

interface CliFlags {
  json: boolean;
  /** Override repo root (test fixture seam, mirrors RunOptions.rootDir). */
  root?: string;
}

function parseArgs(argv: readonly string[]): CliFlags {
  const flags: CliFlags = { json: argv.includes("--json") };
  const i = argv.indexOf("--root");
  if (i !== -1 && argv[i + 1] !== undefined) {
    flags.root = resolve(argv[i + 1]);
  }
  return flags;
}

async function main(): Promise<void> {
  const flags = parseArgs(process.argv.slice(2));
  const result = await runValidator(flags.root ? { rootDir: flags.root } : {});
  if (flags.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    for (const f of result.findings) {
      const line = formatFinding(f);
      if (f.level === "error") console.error(line);
      else console.warn(line);
    }
    console.log(
      `validate-archive-path-currency: ${result.filesScanned} file(s) scanned; ${result.errorCount} error(s), ${result.warningCount} warning(s)`,
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
    // diagnostic channel applies because tests intentionally import this module.
    // eslint-disable-next-line silent-failure/no-silent-catch
  } catch {
    return false;
  }
})();

if (isMain) {
  main().catch((err) => {
    console.error("validate-archive-path-currency failed:", err);
    process.exit(1);
  });
}
