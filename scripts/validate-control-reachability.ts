#!/usr/bin/env node
/**
 * scripts/validate-control-reachability.ts — Cycle 11 D16-3 (High,
 * "documented-but-unwired control" systemic pattern spanning
 * D6/D8/D10/D12/D13/D15).
 *
 * Pillars: P5 (Governance Self-Quality — governance passes its own tests),
 * P4 (Lean Coverage — every file earns existence; dead exports are a finding).
 *
 * D16-3 found 8 tested controls across 6 domains that were dead exports or
 * LLM-prose presented as runtime-enforced, with unit tests calling the dead
 * function directly so `npm test` stayed green (SA16.1-F4). The fix has two
 * coupled halves:
 *
 *   (a) THIS validator — assert that every module a control-status doc cites as
 *       runtime-enforced is reachable from a CLI entry point through ≥1 non-test
 *       importer (transitive). A module the doc claims is `runtime-CLI` but that
 *       no CLI codepath imports is the exact dead-export pattern; the gate fails.
 *   (b) An explicit "Enforcement" column on every control-status doc, drawn from
 *       a controlled vocabulary (ENFORCEMENT_VALUES). The column is what makes a
 *       claim falsifiable: a module can only be labelled `runtime-CLI` if this
 *       gate can prove the reachability the label asserts.
 *
 * This validator supersedes the never-created `scripts/verify-wired.ts` that
 * PRD §1203 cited as a CI check (it did not exist and ran in no workflow — itself
 * an instance of the pattern). It is wired into the D16-1 CI keystone via
 * `npm run validate` (package.json `validate` chain → ci.yml "Content +
 * governance validation gates" step).
 *
 * Relationship to validate-wiring.ts: that gate scans `src/pipeline/` +
 * `src/integrity/` by DIRECTORY and asks "does any non-test file import this
 * module". This gate is DOC-DRIVEN and stronger on the claim axis: it reads the
 * enforcement label a doc asserts and proves the label, including transitive
 * reachability from the CLI entry point (a module imported only by a build-time
 * governance script passes validate-wiring but is correctly NOT `runtime-CLI`
 * here).
 *
 * Enforcement vocabulary (the controlled set; (b)'s column values):
 *
 *   runtime-CLI                  — invoked on a CLI command codepath; MUST be
 *                                  transitively reachable from a CLI entry point.
 *   setup-time-shape-check       — a generator/validator-time structural check,
 *                                  not on a runtime request path.
 *   library-contract-for-downstream — an intentional `@library_export_only`
 *                                  export consumed by downstream packs / agent
 *                                  runtime / build-time governance scripts.
 *   prompt-directive             — an LLM-prose directive enforced by an agent
 *                                  reading the artifact, not by TypeScript.
 *
 * Only `runtime-CLI` carries a reachability obligation. The other three are
 * honest declarations that the control is NOT a CLI-runtime codepath, so the
 * gate exempts them — that honesty is the whole point of half (b).
 *
 * Failure modes (each emits one ERROR finding):
 *
 *   REACH-UNREACHABLE      module labelled `runtime-CLI` is not transitively
 *                          reachable from any CLI entry point via non-test imports
 *   REACH-MISSING-MODULE   a control-status row names a module file that does not
 *                          exist on disk
 *   REACH-BAD-ENFORCEMENT  a control-status row's Enforcement cell is empty or
 *                          not one of ENFORCEMENT_VALUES
 *   REACH-NO-ENFORCEMENT-COL a registered control-status doc table has no
 *                          "Enforcement" column header (half (b) regressed)
 *   REACH-DOC-MISSING      a registered control-status doc file does not exist
 *
 * Usage:
 *   tsx scripts/validate-control-reachability.ts
 *   tsx scripts/validate-control-reachability.ts --json
 *   npm run validate:control-reachability
 */
import { readdir, readFile, stat } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = resolve(__dirname, "..");

// CLI entry points the reachability BFS is seeded from. package.json `bin`
// maps `hatch3r` -> dist/cli/index.js, whose source is src/cli/index.ts.
const CLI_ENTRY_RELS: readonly string[] = ["src/cli/index.ts"];

// Path under `src/` that marks test files — excluded from the importer graph
// (a control reachable only from tests is unreached, the F4 failure mode).
const TESTS_SEGMENT = `${sep}__tests__${sep}`;

// Controlled Enforcement vocabulary (half (b) of D16-3). The ENFORCEMENT_VALUES
// set is the single source of truth the control-status docs draw their column
// values from.
const RUNTIME_CLI = "runtime-CLI";
export const ENFORCEMENT_VALUES: readonly string[] = [
  RUNTIME_CLI,
  "setup-time-shape-check",
  "library-contract-for-downstream",
  "prompt-directive",
];

// ── Control-status doc registry ───────────────────────────────────
//
// Each entry is a doc that presents a module-status table. The table is located
// by a heading regex; its module column and Enforcement column are read by
// header name. Adding a new control-status doc means adding a row here, which is
// the deliberate single place the gate's coverage is declared.
interface ControlStatusDoc {
  /** POSIX path relative to repo root. */
  relPath: string;
  /** Heading line (regex source) immediately preceding the status table. */
  tableHeading: string;
  /** Header cell naming the module column (matched case-insensitively, trimmed). */
  moduleColumn: string;
  /** Header cell naming the enforcement column. */
  enforcementColumn: string;
  /** Directory (POSIX, under src/) the module names resolve into, e.g. "pipeline". */
  moduleDir: string;
}

export const CONTROL_STATUS_DOCS: readonly ControlStatusDoc[] = [
  {
    relPath: "docs/decisions/ADR-001-pipeline-library-architecture.md",
    tableHeading: "All 14 Pipeline Modules",
    moduleColumn: "Module",
    enforcementColumn: "Enforcement",
    moduleDir: "pipeline",
  },
];

// ── Types ─────────────────────────────────────────────────────────

type Severity = "error" | "warning";

export interface Finding {
  level: Severity;
  code: string;
  file: string;
  message: string;
}

/** One parsed control-status row: a module name + its declared enforcement. */
interface ControlRow {
  /** Bare module name (table cell, backticks stripped), e.g. "agentIdentity". */
  module: string;
  /** Enforcement cell value, trimmed. */
  enforcement: string;
  /** POSIX path under src/ the module resolves to, e.g. "pipeline/agentIdentity". */
  modulePath: string;
}

export interface RunOptions {
  /** Override the repo root (test injection). Defaults to the package root. */
  rootDir?: string;
  /** Override the registered docs (test injection). Defaults to CONTROL_STATUS_DOCS. */
  docs?: readonly ControlStatusDoc[];
  /** Override the CLI entry seeds (test injection). Defaults to CLI_ENTRY_RELS. */
  cliEntries?: readonly string[];
}

export interface RunResult {
  findings: Finding[];
  errorCount: number;
  warningCount: number;
  /** Number of control-status rows inspected across all docs. */
  controlsChecked: number;
  /** Number of rows whose enforcement is `runtime-CLI` (reachability-obligated). */
  runtimeCliControls: number;
  /** Size of the transitive non-test import closure from the CLI entry seeds. */
  reachableModules: number;
}

// ── Path helpers ──────────────────────────────────────────────────

function isTestPath(absPath: string): boolean {
  return absPath.includes(TESTS_SEGMENT) || absPath.endsWith(".test.ts");
}

// ── Import-graph construction ─────────────────────────────────────

async function walkTsFiles(absDir: string, out: string[]): Promise<void> {
  let entries: string[];
  try {
    entries = await readdir(absDir);
    // reason: a missing src/ subtree yields no files — the empty walk is the
    // diagnostic (downstream rows still emit REACH-MISSING-MODULE). (P5 channel)
  } catch { // eslint-disable-line silent-failure/no-silent-catch
    return;
  }
  for (const name of entries) {
    const abs = join(absDir, name);
    let s;
    try {
      s = await stat(abs);
    } catch {
      // reason: an unstattable entry is skipped (loop continues); skipping a
      // single inaccessible path is not a swallowed error to channel (P5).
      continue;
    }
    if (s.isDirectory()) {
      await walkTsFiles(abs, out);
      continue;
    }
    if (!s.isFile()) continue;
    if (!name.endsWith(".ts")) continue;
    if (name.endsWith(".d.ts")) continue;
    out.push(abs);
  }
}

/**
 * Resolve a relative import specifier from its containing file to an absolute
 * `.ts` path within `allFiles`, honouring the NodeNext `.js`→`.ts` rewrite and
 * the `<dir>/index.ts` barrel form. Returns null for bare specifiers, paths
 * outside the file set, or unresolved targets.
 */
function resolveSpecifier(importerAbs: string, spec: string, allFiles: ReadonlySet<string>): string | null {
  if (!spec.startsWith(".")) return null;
  const noExt = spec.replace(/\.(js|ts)$/, "");
  const base = resolve(dirname(importerAbs), noExt);
  const candidates = [`${base}.ts`, join(base, "index.ts")];
  for (const c of candidates) {
    if (allFiles.has(c)) return c;
  }
  return null;
}

/**
 * Build the directed import graph over every non-test `.ts` file under `src/`.
 * Node = absolute file path; edge importer→imported for each resolvable
 * relative specifier. Bare (package) specifiers are out of scope.
 */
async function buildImportGraph(srcDir: string): Promise<{ graph: Map<string, Set<string>>; allFiles: Set<string> }> {
  const collected: string[] = [];
  await walkTsFiles(srcDir, collected);
  const nonTest = collected.filter((p) => !isTestPath(p));
  const allFiles = new Set(nonTest);
  const graph = new Map<string, Set<string>>();
  const importRe = /(?:from\s+|import\s*\()\s*['"]([^'"]+)['"]/g;
  for (const abs of nonTest) {
    let raw: string;
    try {
      raw = await readFile(abs, "utf-8");
    } catch {
      // reason: an unreadable source file is skipped (loop continues); a single
      // skipped file is not a swallowed error to channel (P5).
      continue;
    }
    const deps = new Set<string>();
    importRe.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = importRe.exec(raw)) !== null) {
      const resolved = resolveSpecifier(abs, m[1], allFiles);
      if (resolved) deps.add(resolved);
    }
    graph.set(abs, deps);
  }
  return { graph, allFiles };
}

/**
 * Breadth-first transitive closure of the import graph from the CLI entry
 * seeds. The returned set is every non-test module reachable from a CLI entry
 * point — the "is this control on a CLI codepath" oracle for `runtime-CLI` rows.
 */
function reachableFromEntries(
  graph: ReadonlyMap<string, ReadonlySet<string>>,
  seeds: readonly string[],
): Set<string> {
  const reachable = new Set<string>();
  const queue: string[] = [];
  for (const seed of seeds) {
    if (graph.has(seed) && !reachable.has(seed)) {
      reachable.add(seed);
      queue.push(seed);
    }
  }
  while (queue.length > 0) {
    const cur = queue.shift() as string;
    for (const dep of graph.get(cur) ?? []) {
      if (!reachable.has(dep)) {
        reachable.add(dep);
        queue.push(dep);
      }
    }
  }
  return reachable;
}

// ── Control-status table parsing ──────────────────────────────────

interface ParsedTable {
  /** Rows present, or null when the table heading / table was not found. */
  rows: ControlRow[] | null;
  /** True when the table was located but had no "Enforcement" column header. */
  enforcementColumnMissing: boolean;
}

/**
 * Locate the status table under `doc.tableHeading` in `body` and extract one
 * ControlRow per data row, reading the module + enforcement cells by header
 * name. The first pipe-delimited row after the heading is the header; the next
 * is the `|---|` separator; remaining pipe rows are data until the first
 * non-pipe line.
 */
export function parseControlTable(body: string, doc: ControlStatusDoc): ParsedTable {
  const lines = body.split(/\r?\n/);
  const headingRe = new RegExp(doc.tableHeading);
  let i = 0;
  while (i < lines.length && !headingRe.test(lines[i])) i += 1;
  if (i >= lines.length) return { rows: null, enforcementColumnMissing: false };

  // Advance to the first table row (a line whose trimmed form starts with `|`).
  i += 1;
  while (i < lines.length && !lines[i].trim().startsWith("|")) i += 1;
  if (i >= lines.length) return { rows: null, enforcementColumnMissing: false };

  const headerCells = splitRow(lines[i]).map((c) => c.trim());
  const moduleIdx = headerCells.findIndex((c) => c.toLowerCase() === doc.moduleColumn.toLowerCase());
  const enforcementIdx = headerCells.findIndex(
    (c) => c.toLowerCase() === doc.enforcementColumn.toLowerCase(),
  );
  if (enforcementIdx === -1) {
    return { rows: null, enforcementColumnMissing: true };
  }
  if (moduleIdx === -1) {
    // No module column — treat as an unparseable table so the doc registration
    // is surfaced rather than silently passing.
    return { rows: null, enforcementColumnMissing: false };
  }

  // Skip the header row and the `|---|` separator row.
  i += 1;
  if (i < lines.length && /^\s*\|[\s:|-]+\|?\s*$/.test(lines[i])) i += 1;

  const rows: ControlRow[] = [];
  for (; i < lines.length; i += 1) {
    const trimmed = lines[i].trim();
    if (!trimmed.startsWith("|")) break;
    const cells = splitRow(lines[i]);
    const moduleCell = (cells[moduleIdx] ?? "").trim().replace(/`/g, "");
    // Strip backticks from the enforcement cell too: the controlled-vocabulary
    // token is naturally code-formatted in markdown (`runtime-CLI`), so the
    // comparison against ENFORCEMENT_VALUES is on the bare token.
    const enforcementCell = (cells[enforcementIdx] ?? "").trim().replace(/`/g, "");
    if (moduleCell.length === 0) continue;
    rows.push({
      module: moduleCell,
      enforcement: enforcementCell,
      modulePath: `${doc.moduleDir}/${moduleCell}`,
    });
  }
  return { rows, enforcementColumnMissing: false };
}

/**
 * Split a markdown table row into cell strings. Leading/trailing pipes are
 * dropped; interior cells are returned untrimmed (callers trim what they need).
 */
function splitRow(line: string): string[] {
  let s = line.trim();
  if (s.startsWith("|")) s = s.slice(1);
  if (s.endsWith("|")) s = s.slice(0, -1);
  return s.split("|");
}

// ── Core checks ───────────────────────────────────────────────────

async function readFileSafe(absPath: string): Promise<string | null> {
  try {
    return await readFile(absPath, "utf-8");
    // reason: a missing doc is the diagnostic — the caller turns null into a
    // REACH-DOC-MISSING Finding, which IS the channel emission (P5).
  } catch { // eslint-disable-line silent-failure/no-silent-catch
    return null;
  }
}

async function fileExists(absPath: string): Promise<boolean> {
  try {
    await stat(absPath);
    return true;
  } catch { // eslint-disable-line silent-failure/no-silent-catch
    return false;
  }
}

// ── Orchestrator ──────────────────────────────────────────────────

export async function runValidator(opts: RunOptions = {}): Promise<RunResult> {
  const root = opts.rootDir ?? ROOT;
  const docs = opts.docs ?? CONTROL_STATUS_DOCS;
  const cliEntries = opts.cliEntries ?? CLI_ENTRY_RELS;
  const srcDir = join(root, "src");

  const { graph } = await buildImportGraph(srcDir);
  const seeds = cliEntries.map((rel) => join(root, rel));
  const reachable = reachableFromEntries(graph, seeds);

  const findings: Finding[] = [];
  let controlsChecked = 0;
  let runtimeCliControls = 0;

  for (const doc of docs) {
    const absDoc = join(root, doc.relPath);
    const body = await readFileSafe(absDoc);
    if (body === null) {
      findings.push({
        level: "error",
        code: "REACH-DOC-MISSING",
        file: doc.relPath,
        message: `registered control-status doc not found; cannot verify its Enforcement column or module reachability`,
      });
      continue;
    }
    const { rows, enforcementColumnMissing } = parseControlTable(body, doc);
    if (enforcementColumnMissing) {
      findings.push({
        level: "error",
        code: "REACH-NO-ENFORCEMENT-COL",
        file: doc.relPath,
        message: `status table under "${doc.tableHeading}" has no "${doc.enforcementColumn}" column — add it (D16-3 half (b): every control-status doc carries an Enforcement column)`,
      });
      continue;
    }
    if (rows === null) {
      findings.push({
        level: "error",
        code: "REACH-NO-ENFORCEMENT-COL",
        file: doc.relPath,
        message: `could not locate a "${doc.moduleColumn}" + "${doc.enforcementColumn}" status table under "${doc.tableHeading}"`,
      });
      continue;
    }

    for (const row of rows) {
      controlsChecked += 1;
      if (!ENFORCEMENT_VALUES.includes(row.enforcement)) {
        findings.push({
          level: "error",
          code: "REACH-BAD-ENFORCEMENT",
          file: doc.relPath,
          message: `module \`${row.module}\` has Enforcement "${row.enforcement || "(empty)"}" — must be one of: ${ENFORCEMENT_VALUES.join(", ")}`,
        });
        continue;
      }
      const moduleAbs = join(srcDir, `${row.modulePath}.ts`);
      if (!(await fileExists(moduleAbs))) {
        findings.push({
          level: "error",
          code: "REACH-MISSING-MODULE",
          file: doc.relPath,
          message: `module \`${row.module}\` (row in ${doc.relPath}) resolves to src/${row.modulePath}.ts which does not exist`,
        });
        continue;
      }
      if (row.enforcement === RUNTIME_CLI) {
        runtimeCliControls += 1;
        if (!reachable.has(moduleAbs)) {
          findings.push({
            level: "error",
            code: "REACH-UNREACHABLE",
            file: doc.relPath,
            message:
              `module \`${row.module}\` is labelled "${RUNTIME_CLI}" but is not reachable from any CLI entry point ` +
              `(${cliEntries.join(", ")}) through a non-test import chain. ` +
              `Wire it onto a CLI command codepath, or relabel its Enforcement to the accurate value ` +
              `(library-contract-for-downstream / setup-time-shape-check / prompt-directive).`,
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
    controlsChecked,
    runtimeCliControls,
    reachableModules: reachable.size,
  };
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
    console.log(JSON.stringify(result, null, 2));
  } else {
    for (const f of result.findings) {
      const line = formatFinding(f);
      if (f.level === "error") console.error(line);
      else console.warn(line);
    }
    console.log(
      `validate-control-reachability: ${result.controlsChecked} control(s) checked ` +
      `(${result.runtimeCliControls} runtime-CLI, ${result.reachableModules} module(s) reachable from CLI); ` +
      `${result.errorCount} error(s), ${result.warningCount} warning(s)`,
    );
  }
  if (result.errorCount > 0) process.exit(1);
}

// Only auto-run when executed as a script, never when imported by tests.
const isMain = (() => {
  try {
    return resolve(process.argv[1] ?? "") === __filename;
    // reason: process.argv[1] unresolvable under some runners — treating as
    // imported (return false) is the safe default; no error to channel (P5).
  } catch { // eslint-disable-line silent-failure/no-silent-catch
    return false;
  }
})();

if (isMain) {
  main().catch((err) => {
    console.error("validate-control-reachability failed:", err);
    process.exit(1);
  });
}
