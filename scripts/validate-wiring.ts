#!/usr/bin/env node
/**
 * scripts/validate-wiring.ts — Cycle 9 D16-F16.1.1 wiring sweep
 * ("implemented-but-unwired" cross-domain pattern spanning D6/D7/D8/D12).
 *
 * Pillars: P4 (Lean Coverage), P5 (Governance Self-Quality).
 *
 * Scans every `*.ts` module under `src/pipeline/` and `src/integrity/`
 * (the two directories named in the F16.1.1 recommendation) and asserts
 * that each module is either:
 *
 *   (a) imported by at least one non-test file in `src/` — meaning the
 *       module is wired into a production caller (CLI command, adapter,
 *       workspace helper, etc.); OR
 *
 *   (b) marked as a deliberate library-only export via the in-file
 *       JSDoc tag `@library_export_only` (a single-line directive
 *       inside the top-of-file block comment).
 *
 * Modules that are imported only by tests under `src/__tests__/` count
 * as unwired — that is the exact F16.1.1 pattern this gate prevents.
 *
 * Failure modes (each emits one ERROR finding):
 *
 *   WIRING-UNWIRED         module is not imported by any non-test file
 *                          and does not declare `@library_export_only`
 *
 * The validator emits a one-line summary plus per-finding diagnostics
 * on stderr, mirroring `scripts/validate-fanout-emission.ts`. CI wires
 * the script via `npm run validate:wiring`. C9-H75 lands the CI gate
 * after this validator ships.
 *
 * Usage:
 *   tsx scripts/validate-wiring.ts
 *   tsx scripts/validate-wiring.ts --json
 *   npm run validate:wiring
 */
import { readdir, readFile, stat } from "node:fs/promises";
import { dirname, join, posix, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = resolve(__dirname, "..");
const SRC_DIR = join(ROOT, "src");
const TESTS_REL = "src/__tests__";

// Directories whose `.ts` modules must each have at least one
// non-test importer (or `@library_export_only`).
const SCANNED_DIRS: readonly string[] = ["src/pipeline", "src/integrity"];

// File names that are not pipeline modules themselves and should be
// skipped by the scanner (e.g. a future `index.ts` barrel). Empty for
// now; reserved so adding a barrel later does not break the gate.
const SKIPPED_BASENAMES: ReadonlySet<string> = new Set<string>([]);

// Single supported JSDoc tag for library-only declaration. Mirrors the
// CONSTITUTION P4 lean-threshold row added in this cycle.
const LIBRARY_TAG = "@library_export_only";

// ── Legacy-import guard (Cycle 10 F16.1-H3, D16 cross-domain) ──────
//
// Modules removed in the 1.9.0 hard cut (`src/adapters/zed`) and the
// SHA-256-integrity removal (`src/integrity/`) must never be re-imported by
// production code. This guard fails on any *import specifier* under `src/`
// (excluding tests) that resolves to a removed module path. It deliberately
// does NOT flag the `.agents/` string literal: `.agents/` survives as a
// legitimate backward-compatible probe target in `src/workspace/detect.ts`,
// `src/workspace/sync.ts`, and `src/detect/repoAnalyzer.ts` (pre-1.9 layout
// detection), so a string-literal sweep would false-positive on intentional
// migration shims. Import specifiers, by contrast, point at code that no
// longer exists — any match is genuinely dead/regressed.
//
// Each forbidden entry is a substring matched against the resolved import
// specifier (after stripping a `.js`/`.ts` suffix and a leading `./`).
const FORBIDDEN_IMPORT_SUBSTRINGS: readonly { needle: string; reason: string }[] = [
  { needle: "/integrity/", reason: "src/integrity/ was removed (drift detection replaced SHA-256 manifest integrity; Cycle 10 F19.2.1)" },
  { needle: "integrity/index", reason: "src/integrity/index was removed (Cycle 10 F19.2.1)" },
  { needle: "adapters/zed", reason: "the zed adapter was removed in the 1.9.0 hard cut (3 adapters: claude, cursor, copilot)" },
];

// ── Types ─────────────────────────────────────────────────────────

type Severity = "error" | "warning";

export interface Finding {
  level: Severity;
  code: string;
  file: string;
  message: string;
}

interface ScannedModule {
  /** Absolute path on disk. */
  absPath: string;
  /** POSIX-style path relative to repo root. */
  relPath: string;
  /** Path under `src/`, no leading `./`, used for import-spec matching. */
  importPath: string;
  /** Basename without `.ts`, used for prefix-import matching. */
  moduleName: string;
  /** Raw file contents. */
  raw: string;
  /** True when the file declares `@library_export_only` in its leading block comment. */
  libraryExportOnly: boolean;
}

export interface RunOptions {
  /** Optional override for the repo root; defaults to the script root. */
  rootDir?: string;
  /** Optional override for the scanned directories (POSIX relative to rootDir). */
  scannedDirs?: readonly string[];
}

export interface RunResult {
  findings: Finding[];
  errorCount: number;
  warningCount: number;
  scannedModules: number;
  /** Modules that satisfy clause (a) — at least one non-test importer. */
  wiredModules: number;
  /** Modules that satisfy clause (b) — `@library_export_only` declared. */
  libraryOnlyModules: number;
}

// ── Path helpers ──────────────────────────────────────────────────

function toPosixRel(absPath: string, baseDir: string): string {
  return relative(baseDir, absPath).split(sep).join(posix.sep);
}

// ── Discovery ─────────────────────────────────────────────────────

async function walkTsFiles(absDir: string): Promise<string[]> {
  const out: string[] = [];
  let entries: string[];
  try {
    entries = await readdir(absDir);
  } catch {
    return out;
  }
  for (const name of entries.sort((a, b) => a.localeCompare(b))) {
    const abs = join(absDir, name);
    let s;
    try {
      s = await stat(abs);
    } catch {
      continue;
    }
    if (s.isDirectory()) {
      // Recurse one level — the scanned dirs are flat today, but a
      // future sub-directory should not bypass the gate silently.
      const nested = await walkTsFiles(abs);
      out.push(...nested);
      continue;
    }
    if (!s.isFile()) continue;
    if (!name.endsWith(".ts")) continue;
    if (name.endsWith(".d.ts")) continue;
    if (SKIPPED_BASENAMES.has(name)) continue;
    out.push(abs);
  }
  return out;
}

// ── Library-only tag detection ────────────────────────────────────

/**
 * Return true if the file declares `@library_export_only` inside its
 * leading `/** ... *\/` block comment. Tag detection is restricted to
 * the first block comment to keep the directive a deliberate top-of-file
 * declaration (matching the CONSTITUTION P4 row added this cycle).
 *
 * The check is order-of-bytes only — no JS parser is required, which
 * keeps the validator dependency-free and aligned with the rest of
 * `scripts/`.
 */
export function detectLibraryExportOnly(raw: string): boolean {
  const trimmed = raw.replace(/^﻿/, "");
  const openIdx = trimmed.indexOf("/**");
  if (openIdx === -1) return false;
  // Allow a leading shebang or single-line comments before the block
  // comment, but only if those lines do not contain executable code.
  const beforeOpen = trimmed.slice(0, openIdx);
  if (/^[^\s/#].*$/m.test(beforeOpen)) return false;
  const closeIdx = trimmed.indexOf("*/", openIdx + 3);
  if (closeIdx === -1) return false;
  const block = trimmed.slice(openIdx, closeIdx);
  // Tag must appear as a standalone token; require a non-word boundary
  // immediately after so `@library_export_only_v2` does not match.
  const re = new RegExp(`${LIBRARY_TAG}(?![A-Za-z0-9_])`);
  return re.test(block);
}

// ── Importer scan ─────────────────────────────────────────────────

/**
 * Walk every `*.ts` file under `src/` (excluding tests) and return the
 * union of relative POSIX paths that the file imports.
 *
 * The match is intentionally syntactic: we look for the substring
 * `<dir>/<module>` inside `from "..."`, `from '...'`, or
 * `import("...")` forms. ESM imports under this project always carry
 * a `.js` suffix (TypeScript NodeNext), so we strip both `.js` and
 * absent extensions when comparing against the scanned module name.
 */
async function collectNonTestImporters(
  rootDir: string,
  srcDir: string,
  scannedDirs: readonly string[],
): Promise<Map<string, string[]>> {
  // Map: scanned module key ("pipeline/observability") -> array of
  // importer file paths (POSIX relative to repo root, for diagnostics).
  const result = new Map<string, string[]>();
  const importerFiles = await collectImporterFiles(rootDir, srcDir);

  // Single regex per file scan: capture the path between `from
  // "..."` / `from '...'` / `import("...")` quotes.
  const importRe = /(?:from\s+|import\s*\()\s*['"]([^'"]+)['"]/g;

  for (const abs of importerFiles) {
    let raw: string;
    try {
      raw = await readFile(abs, "utf-8");
    } catch {
      continue;
    }
    const relFromRepo = toPosixRel(abs, rootDir);
    importRe.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = importRe.exec(raw)) !== null) {
      const spec = m[1];
      if (!spec.startsWith(".")) continue; // skip bare specifiers
      const resolved = resolveImportToKey(abs, spec, srcDir, scannedDirs);
      if (!resolved) continue;
      const arr = result.get(resolved);
      if (arr) {
        if (!arr.includes(relFromRepo)) arr.push(relFromRepo);
      } else {
        result.set(resolved, [relFromRepo]);
      }
    }
  }
  return result;
}

async function collectImporterFiles(rootDir: string, srcDir: string): Promise<string[]> {
  const out: string[] = [];
  await walkAll(srcDir, out);
  // Filter out test files — tests are explicitly excluded by the
  // F16.1.1 acceptance criterion ("imported by at least one caller
  // outside `src/__tests__/`").
  const testRelAbs = join(rootDir, TESTS_REL);
  return out.filter((p) => !p.startsWith(testRelAbs + sep) && p !== testRelAbs);
}

async function walkAll(absDir: string, out: string[]): Promise<void> {
  let entries: string[];
  try {
    entries = await readdir(absDir);
  } catch {
    return;
  }
  for (const name of entries) {
    const abs = join(absDir, name);
    let s;
    try {
      s = await stat(abs);
    } catch {
      continue;
    }
    if (s.isDirectory()) {
      await walkAll(abs, out);
      continue;
    }
    if (!s.isFile()) continue;
    if (!name.endsWith(".ts")) continue;
    if (name.endsWith(".d.ts")) continue;
    out.push(abs);
  }
}

/**
 * Resolve an import specifier relative to its containing file and
 * return a normalised key of the form `pipeline/<module>` or
 * `integrity/<module>` when the import lands inside a scanned dir.
 * Returns null otherwise — those imports are not in scope.
 */
function resolveImportToKey(
  importerAbs: string,
  spec: string,
  srcDir: string,
  scannedDirs: readonly string[],
): string | null {
  // Trim the optional `.js` ESM suffix to land on the source module name.
  const noExt = spec.endsWith(".js")
    ? spec.slice(0, -3)
    : spec.endsWith(".ts")
      ? spec.slice(0, -3)
      : spec;
  const fromDir = dirname(importerAbs);
  const absResolved = resolve(fromDir, noExt);
  const relFromSrc = toPosixRel(absResolved, srcDir);
  // Reject paths that escape `src/` — they cannot point to a scanned module.
  if (relFromSrc.startsWith("..")) return null;
  // Match only files inside a scanned directory.
  for (const dirRel of scannedDirs) {
    const dirKey = dirRel.replace(/^src\//, "");
    const prefix = `${dirKey}/`;
    if (relFromSrc === dirKey) return null; // bare dir; not a module
    if (relFromSrc.startsWith(prefix)) {
      return relFromSrc; // e.g. "pipeline/observability"
    }
  }
  return null;
}

// ── Module ingestion ──────────────────────────────────────────────

async function ingestModules(rootDir: string, scannedDirs: readonly string[]): Promise<ScannedModule[]> {
  const out: ScannedModule[] = [];
  for (const dirRel of scannedDirs) {
    const absDir = join(rootDir, dirRel);
    const files = await walkTsFiles(absDir);
    for (const abs of files) {
      const raw = await readFile(abs, "utf-8");
      const relPath = toPosixRel(abs, rootDir);
      const importPath = toPosixRel(abs, join(rootDir, "src")).replace(/\.ts$/, "");
      const moduleName = relPath.replace(/^.*\//, "").replace(/\.ts$/, "");
      out.push({
        absPath: abs,
        relPath,
        importPath,
        moduleName,
        raw,
        libraryExportOnly: detectLibraryExportOnly(raw),
      });
    }
  }
  return out;
}

// ── Legacy-import scan ────────────────────────────────────────────

/**
 * Walk every non-test `*.ts` file under `src/` and emit one ERROR finding per
 * import specifier that resolves to a removed module path
 * (`FORBIDDEN_IMPORT_SUBSTRINGS`). Matches both `from "..."` and `import("...")`
 * forms, relative and bare. Comments are not import statements, so the
 * `from`/`import(` anchors keep documentation references (e.g. a `.agents/`
 * mention in a JSDoc block) out of scope.
 */
async function scanLegacyImports(rootDir: string, srcDir: string): Promise<Finding[]> {
  const findings: Finding[] = [];
  const files = await collectImporterFiles(rootDir, srcDir);
  const importRe = /(?:from\s+|import\s*\()\s*['"]([^'"]+)['"]/g;
  for (const abs of files) {
    let raw: string;
    try {
      raw = await readFile(abs, "utf-8");
    } catch {
      continue;
    }
    const relFromRepo = toPosixRel(abs, rootDir);
    importRe.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = importRe.exec(raw)) !== null) {
      const spec = m[1].replace(/\.(js|ts)$/, "").replace(/^\.\//, "");
      for (const forbidden of FORBIDDEN_IMPORT_SUBSTRINGS) {
        if (spec.includes(forbidden.needle)) {
          findings.push({
            level: "error",
            code: "WIRING-LEGACY-IMPORT",
            file: relFromRepo,
            message: `imports removed module path "${m[1]}" — ${forbidden.reason}`,
          });
        }
      }
    }
  }
  return findings;
}

// ── Core check ────────────────────────────────────────────────────

export async function runValidator(opts: RunOptions = {}): Promise<RunResult> {
  const rootDir = opts.rootDir ?? ROOT;
  const scannedDirs = opts.scannedDirs ?? SCANNED_DIRS;

  const modules = await ingestModules(rootDir, scannedDirs);
  const importers = await collectNonTestImportersForRoot(rootDir, scannedDirs);

  const findings: Finding[] = [];
  let wiredModules = 0;
  let libraryOnlyModules = 0;

  findings.push(...(await scanLegacyImports(rootDir, join(rootDir, "src"))));

  for (const m of modules) {
    const wired = (importers.get(m.importPath) ?? []).length > 0;
    if (wired) {
      wiredModules += 1;
      continue;
    }
    if (m.libraryExportOnly) {
      libraryOnlyModules += 1;
      continue;
    }
    findings.push({
      level: "error",
      code: "WIRING-UNWIRED",
      file: m.relPath,
      message:
        `module is not imported by any non-test file in src/ and does not declare ${LIBRARY_TAG}. ` +
        `Wire it into a CLI command / adapter / workspace path, or add ${LIBRARY_TAG} ` +
        `to the top-of-file block comment with a justification.`,
    });
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
    scannedModules: modules.length,
    wiredModules,
    libraryOnlyModules,
  };
}

async function collectNonTestImportersForRoot(
  rootDir: string,
  scannedDirs: readonly string[],
): Promise<Map<string, string[]>> {
  const srcDir = join(rootDir, "src");
  return collectNonTestImporters(rootDir, srcDir, scannedDirs);
}

// ── Output ────────────────────────────────────────────────────────

export function formatFinding(f: Finding): string {
  const tag = f.level === "error" ? "ERROR" : "WARN ";
  return `[${tag} ${f.code}] ${f.file}: ${f.message}`;
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
    for (const f of result.findings) {
      const line = formatFinding(f);
      // eslint-disable-next-line no-console
      if (f.level === "error") console.error(line);
      else console.warn(line);
    }
    // eslint-disable-next-line no-console
    console.log(
      `validate-wiring: ${result.scannedModules} module(s) scanned ` +
      `(${result.wiredModules} wired, ${result.libraryOnlyModules} library-only); ` +
      `${result.errorCount} error(s), ${result.warningCount} warning(s)`,
    );
  }
  if (result.errorCount > 0) process.exit(1);
}

// Only auto-run when executed as a script.
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
    console.error("validate-wiring failed:", err);
    process.exit(1);
  });
}
