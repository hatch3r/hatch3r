#!/usr/bin/env node
/**
 * scripts/validate-efficiency-invariants.ts — Pillar P7 (Efficiency-First)
 *
 * Three flag-mode invariants over canonical agent + command artifacts:
 *
 *   --triage-first   Orchestrator commands declare a `triage_tiers` array
 *                    (subset of [1,2,3]) and contain a Triage/Tier/Scale
 *                    heading.
 *   --static-first   Orchestrator commands and agents do not reference
 *                    volatile tokens (timestamp, now, run-id,
 *                    session-counter, "today is") before their first `##`
 *                    heading.
 *   --parallel-tool  Files with >=2 tool/sub-agent mentions include a
 *                    parallel-execution directive (warning only).
 *
 * No flags → all three modes run. Exit 0 unless >=1 error-level finding;
 * warnings never block. Audit-cycle files are hard-exempt throughout.
 *
 * Pillars: P7 (Efficiency-First), P5 (Governance Self-Quality).
 *
 * Usage: `npm run validate:efficiency` (umbrella entry wired by sub-agent 2d).
 */
import { readdir, readFile } from "node:fs/promises";
import { dirname, join, posix, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = resolve(__dirname, "..");
const COMMANDS_DIR = join(ROOT, "commands");
const AGENTS_DIR = join(ROOT, "agents");

// ── Audit-cycle exempt list (hard-coded) ──────────────────────────

const AUDIT_EXEMPT_PATHS: readonly string[] = [
  "governance/AUDIT.md",
  "governance/AUDIT-EXECUTE.md",
  "governance/RE-ENVISION.md",
];

const AUDIT_EXEMPT_GLOBS: readonly string[] = [
  "commands/hatch3r-audit*.md",
];

// ── Types ─────────────────────────────────────────────────────────

type Severity = "error" | "warning";

interface Finding {
  level: Severity;
  code: string;
  file: string;
  message: string;
  line?: number;
}

interface ParsedFile {
  absPath: string;
  relPath: string;
  frontmatter: Record<string, unknown>;
  fmParseFailed: boolean;
  body: string;
  bodyStartLine: number;
}

interface ModeFlags {
  triageFirst: boolean;
  staticFirst: boolean;
  parallelTool: boolean;
}

interface RunOptions {
  flags: ModeFlags;
  commandsDir?: string;
  agentsDir?: string;
}

interface RunResult {
  findings: Finding[];
  errorCount: number;
  warningCount: number;
}

// ── CLI parsing ───────────────────────────────────────────────────

function parseArgs(argv: readonly string[]): ModeFlags {
  const known = new Set(["--triage-first", "--static-first", "--parallel-tool"]);
  const requested = new Set(argv.filter((a) => known.has(a)));
  if (requested.size === 0) {
    return { triageFirst: true, staticFirst: true, parallelTool: true };
  }
  return {
    triageFirst: requested.has("--triage-first"),
    staticFirst: requested.has("--static-first"),
    parallelTool: requested.has("--parallel-tool"),
  };
}

// ── Path / exempt-list helpers ────────────────────────────────────

function toPosixRel(absPath: string, baseDir: string): string {
  return relative(baseDir, absPath).split(sep).join(posix.sep);
}

// Single supported glob shape: `prefix*suffix`. No `minimatch` dep available.
function matchesExemptGlob(relPath: string, glob: string): boolean {
  const i = glob.indexOf("*");
  if (i === -1) return relPath === glob;
  return relPath.startsWith(glob.slice(0, i)) && relPath.endsWith(glob.slice(i + 1));
}

function isAuditExempt(relPath: string): boolean {
  if (AUDIT_EXEMPT_PATHS.includes(relPath)) return true;
  return AUDIT_EXEMPT_GLOBS.some((g) => matchesExemptGlob(relPath, g));
}

// ── Frontmatter parsing ───────────────────────────────────────────

function splitFrontmatter(raw: string): {
  frontmatter: Record<string, unknown>;
  fmParseFailed: boolean;
  body: string;
  bodyStartLine: number;
} {
  if (!raw.startsWith("---\n") && !raw.startsWith("---\r\n")) {
    return { frontmatter: {}, fmParseFailed: false, body: raw, bodyStartLine: 1 };
  }
  const afterOpen = raw.indexOf("\n", 3) + 1;
  if (afterOpen <= 0) return { frontmatter: {}, fmParseFailed: true, body: raw, bodyStartLine: 1 };
  const closeIdx = raw.indexOf("\n---", afterOpen - 1);
  if (closeIdx === -1) return { frontmatter: {}, fmParseFailed: true, body: raw, bodyStartLine: 1 };
  const fmRaw = raw.slice(afterOpen, closeIdx);
  const afterClose = raw.indexOf("\n", closeIdx + 4);
  const body = afterClose === -1 ? "" : raw.slice(afterClose + 1);
  const headLen = afterClose === -1 ? raw.length : afterClose + 1;
  const bodyStartLine = raw.slice(0, headLen).split("\n").length;
  let frontmatter: Record<string, unknown> = {};
  let fmParseFailed = false;
  try {
    const parsed = parseYaml(fmRaw);
    if (parsed && typeof parsed === "object") frontmatter = parsed as Record<string, unknown>;
  } catch {
    fmParseFailed = true;
  }
  return { frontmatter, fmParseFailed, body, bodyStartLine };
}

// ── Discovery ─────────────────────────────────────────────────────

async function listTopLevelMd(dir: string): Promise<string[]> {
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return [];
  }
  return entries
    .filter((n) => n.startsWith("hatch3r-") && n.endsWith(".md"))
    .sort((a, b) => a.localeCompare(b))
    .map((n) => join(dir, n));
}

async function loadFile(absPath: string, baseDir: string): Promise<ParsedFile> {
  const raw = await readFile(absPath, "utf-8");
  const split = splitFrontmatter(raw);
  return { absPath, relPath: toPosixRel(absPath, baseDir), ...split };
}

// ── Frontmatter helpers ───────────────────────────────────────────

const isOrchestrator = (fm: Record<string, unknown>): boolean => fm.orchestrator === true;

function hasTriageTiersArray(fm: Record<string, unknown>): boolean {
  const v = fm.triage_tiers;
  if (!Array.isArray(v) || v.length === 0) return false;
  return v.every((n) => Number.isInteger(n) && [1, 2, 3].includes(n as number));
}

const TRIAGE_HEADING_RE =
  /^##\s+(Step\s+\d+:?\s+)?(Triage|Scale Assessment|Tier(\s+Assessment|\s+Selection)?)/im;

// ── Mode A: triage-first ──────────────────────────────────────────

function checkTriageFirst(file: ParsedFile): Finding[] {
  if (!isOrchestrator(file.frontmatter)) return [];
  const out: Finding[] = [];
  if (!hasTriageTiersArray(file.frontmatter)) {
    out.push({
      level: "error", code: "P7-TRIAGE-MISS", file: file.relPath,
      message: "missing `triage_tiers` array (subset of [1,2,3]) in frontmatter",
    });
  }
  if (!TRIAGE_HEADING_RE.test(file.body)) {
    out.push({
      level: "error", code: "P7-TRIAGE-MISS", file: file.relPath,
      message: "missing Triage/Tier/Scale Assessment heading in body",
    });
  }
  return out;
}

// ── Mode B: static-first ──────────────────────────────────────────

const VOLATILE_TOKEN_RE = /\b(timestamp|now|run[-_]?id|session[-_]?counter|today\s+is)\b/i;

function checkStaticFirst(file: ParsedFile): Finding[] {
  const lines = file.body.split("\n").slice(0, 60);
  const firstH2 = lines.findIndex((l) => /^##\s+/.test(l));
  const stopAt = firstH2 === -1 ? lines.length : firstH2;
  for (let i = 0; i < stopAt; i++) {
    const m = lines[i].match(VOLATILE_TOKEN_RE);
    if (m) {
      return [{
        level: "error", code: "P7-STATIC-VIOL", file: file.relPath,
        line: file.bodyStartLine + i,
        message: `volatile token "${m[0]}" before first heading`,
      }];
    }
  }
  return [];
}

// ── Mode C: parallel-tool ─────────────────────────────────────────

const TOOL_MENTION_RE = /(Task tool|tool calls|sub-agent)/gi;
const PARALLEL_DIRECTIVE_RE = /(parallel|in\s*parallel|concurrent|single\s+message|batched)/i;

function checkParallelTool(file: ParsedFile): Finding[] {
  const matches = file.body.match(TOOL_MENTION_RE);
  const count = matches ? matches.length : 0;
  if (count < 2 || PARALLEL_DIRECTIVE_RE.test(file.body)) return [];
  return [{
    level: "warning", code: "P7-PARALLEL-MISS", file: file.relPath,
    message: `${count} tool/sub-agent mentions, no parallel directive nearby`,
  }];
}

// ── Orchestrator ──────────────────────────────────────────────────

async function loadDir(dir: string, baseDir: string, sink: Finding[]): Promise<ParsedFile[]> {
  const out: ParsedFile[] = [];
  for (const p of await listTopLevelMd(dir)) {
    const f = await loadFile(p, baseDir);
    if (isAuditExempt(f.relPath)) continue;
    if (f.fmParseFailed) {
      sink.push({
        level: "warning", code: "P7-FM-PARSE", file: f.relPath,
        message: "frontmatter YAML parse failed; skipping further checks for this file",
      });
      continue;
    }
    out.push(f);
  }
  return out;
}

export async function runValidator(opts: RunOptions): Promise<RunResult> {
  const cmdDir = opts.commandsDir ?? COMMANDS_DIR;
  const agtDir = opts.agentsDir ?? AGENTS_DIR;
  // baseDir is each directory's parent: matches the audit exempt-list
  // shape (`commands/...`, `governance/...`) under both production
  // (repo root) and test (tmpdir) layouts.
  const cmdBase = resolve(cmdDir, "..");
  const agtBase = resolve(agtDir, "..");

  const findings: Finding[] = [];
  const commandFiles = await loadDir(cmdDir, cmdBase, findings);
  const agentFiles = await loadDir(agtDir, agtBase, findings);

  if (opts.flags.triageFirst) {
    for (const f of commandFiles) findings.push(...checkTriageFirst(f));
  }
  if (opts.flags.staticFirst) {
    for (const f of commandFiles) {
      if (isOrchestrator(f.frontmatter)) findings.push(...checkStaticFirst(f));
    }
    for (const f of agentFiles) findings.push(...checkStaticFirst(f));
  }
  if (opts.flags.parallelTool) {
    for (const f of agentFiles) findings.push(...checkParallelTool(f));
    for (const f of commandFiles) {
      if (isOrchestrator(f.frontmatter)) findings.push(...checkParallelTool(f));
    }
  }

  let errorCount = 0, warningCount = 0;
  for (const f of findings) {
    if (f.level === "error") errorCount++;
    else warningCount++;
  }
  return { findings, errorCount, warningCount };
}

// ── Output ────────────────────────────────────────────────────────

export function formatFinding(f: Finding): string {
  const tag = f.level === "error" ? "ERROR" : "WARN ";
  const where = f.line !== undefined ? `${f.file}:${f.line}` : f.file;
  return `[${tag} ${f.code}] ${where}: ${f.message}`;
}

async function main(): Promise<void> {
  const flags = parseArgs(process.argv.slice(2));
  const { findings, errorCount, warningCount } = await runValidator({ flags });
  for (const f of findings) {
    const line = formatFinding(f);
    // eslint-disable-next-line no-console
    if (f.level === "error") console.error(line); else console.warn(line);
  }
  // eslint-disable-next-line no-console
  console.log(`validate-efficiency-invariants: ${errorCount} error(s), ${warningCount} warning(s)`);
  if (errorCount > 0) process.exit(1);
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
    console.error("validate-efficiency-invariants failed:", err);
    process.exit(1);
  });
}
