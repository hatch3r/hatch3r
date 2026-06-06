#!/usr/bin/env node
/**
 * scripts/validate-fanout-path-currency.ts — Cycle 11 D7-32
 * (dangling fan-out-discipline path on the shipped corpus).
 *
 * The fan-out discipline ships to end-user repos as the canonical runtime twin
 * `rules/hatch3r-fan-out-discipline.md` (+ `.mdc`). The framework-dev mirror
 * `.claude/rules/fan-out-discipline.md` is NOT shipped — adapters read from the
 * canonical `rules/` tree via `src/adapters/canonical.ts::readCanonicalFiles`,
 * never from `.claude/`. A shipped artifact (agent, skill, command, rule, hook,
 * check) that cites the `.claude/rules/fan-out-discipline.md` path therefore
 * points the end-user reader at a file that does not exist in their repo — a
 * cross-reference-integrity defect on the published surface (D7-SA7.6-F3). The
 * Cycle 11 D7-32 fix rewrote all such citations to the runtime path; this gate
 * keeps the redirect from regressing.
 *
 * Scans `.md`/`.mdc` files under the runtime content directories (agents,
 * checks, commands, rules, skills, hooks) for the framework-dev path literal
 * `.claude/rules/fan-out-discipline`. Each occurrence emits one ERROR finding
 * naming the runtime replacement, EXCEPT:
 *
 *   Framework-dev meta-references — a line that co-occurs with `framework-dev`
 *   (case-insensitive) is a documented statement *about* the non-shipped mirror
 *   (e.g. `agents/hatch3r-creator.md` explains that the framework-dev
 *   attestation rule "is not loaded" in end-user contexts). Such a line cites
 *   the `.claude/` path deliberately to describe what the user surface does NOT
 *   carry; rewriting it to the runtime twin would invert its meaning. Preserved.
 *
 * Scope note (D7-32 vs the broader `.claude/rules/` sweep): this gate targets
 * the fan-out-discipline path specifically, the exact citation drift D7-32
 * remediates and the only `.claude/rules/` reference whose runtime twin made
 * every shipped citation redirectable. Other `.claude/rules/*` files cited by
 * the shipped corpus (`capability-lifecycle`, `cli-ux-standards`,
 * `content-authoring`, `commit-conventions`, …) have no runtime twin to point
 * at and are genuine framework-dev gate references; a corpus-wide
 * "no shipped file cites `.claude/rules/`" sweep is a distinct, larger finding
 * and is intentionally out of this gate's scope so it never reds a green
 * baseline.
 *
 * The `governance/` tree is intentionally not scanned: audit records
 * (AUDIT-REPORT.md, domain checklists, archived cycles) legitimately quote the
 * `.claude/` path when describing or checking for this very drift; scrubbing
 * them would erase the diagnostic record.
 *
 * Failure mode (one ERROR per offending occurrence):
 *
 *   FANOUT-PATH-FRAMEWORK-DEV  Framework-dev fan-out-discipline path on the
 *                              shipped surface. Replace with the runtime twin
 *                              `rules/hatch3r-fan-out-discipline.md`.
 *
 * Pillars: P5 (Governance Self-Quality — self-detectable cross-ref drift),
 *          P4 (Lean Coverage — single-source-of-truth path on the user surface),
 *          P8 (Clarification & Fan-out Discipline — the rule whose citations
 *          this gate keeps reachable).
 *
 * Usage:
 *   `npm run validate:fanout-path`            (wired in package.json)
 *   `tsx scripts/validate-fanout-path-currency.ts`
 *   `tsx scripts/validate-fanout-path-currency.ts --json`
 */
import { readdir, readFile, stat } from "node:fs/promises";
import { dirname, join, posix, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = resolve(__dirname, "..");

// ── Path drift definition ─────────────────────────────────────────

/**
 * The framework-dev path literal that must not appear on the shipped surface,
 * and its canonical runtime twin. Matched as a plain substring (no `.md`/`.mdc`
 * suffix in the needle) so a citation of either extension is caught.
 */
export const FRAMEWORK_DEV_PATH = ".claude/rules/fan-out-discipline";
export const RUNTIME_TWIN_PATH = "rules/hatch3r-fan-out-discipline.md";

/**
 * Per-line opt-out cue. A line that mentions `framework-dev` is treated as a
 * documented meta-reference that intentionally cites the non-shipped mirror to
 * explain what the user surface does not load; it is not a live runtime
 * cross-reference. Matched case-insensitively.
 */
export const META_REFERENCE_CUE_RE = /framework-dev/i;

/**
 * Directories scanned for `.md`/`.mdc` artifacts: the runtime content surface
 * only. `governance/` is deliberately excluded (see the Scope note in the file
 * header) — audit records quote the framework-dev path as diagnostic data.
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
 * Extensions scanned. `.mdc` is included so the Cursor rule twins are kept in
 * lockstep with their `.md` source.
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
    // Missing directories are informational: the same dir set is reused across
    // test fixtures and real repos (the private `governance/` tree is absent in
    // public clones), so an unseeded path simply yields zero files.
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

export interface FileScanResult {
  hits: { line: number }[];
}

/**
 * Scan one file's content. Lines that match the `framework-dev` cue are skipped
 * (documented meta-references to the non-shipped mirror). All other occurrences
 * of the framework-dev path are reported with their 1-based line number.
 */
export function scanFileContent(content: string): FileScanResult {
  const lines = content.split("\n");
  const hits: FileScanResult["hits"] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.includes(FRAMEWORK_DEV_PATH)) continue;
    if (META_REFERENCE_CUE_RE.test(line)) continue; // documented meta-reference
    hits.push({ line: i + 1 });
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
      filesScanned += 1;
      const raw = await readFile(file, "utf-8");
      const { hits } = scanFileContent(raw);
      for (const hit of hits) {
        findings.push({
          level: "error",
          code: "FANOUT-PATH-FRAMEWORK-DEV",
          file: relPath,
          line: hit.line,
          message: `shipped artifact cites the framework-dev path "${FRAMEWORK_DEV_PATH}.md" — replace with the runtime twin "${RUNTIME_TWIN_PATH}" (D7-32 / D7-SA7.6-F3; the framework-dev mirror is not shipped to user repos). If this line deliberately describes the non-shipped mirror, mention "framework-dev" on the line to opt out.`,
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
      `validate-fanout-path-currency: ${result.filesScanned} file(s) scanned; ${result.errorCount} error(s), ${result.warningCount} warning(s)`,
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
    console.error("validate-fanout-path-currency failed:", err);
    process.exit(1);
  });
}
