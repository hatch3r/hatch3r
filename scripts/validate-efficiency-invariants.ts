#!/usr/bin/env node
/**
 * scripts/validate-efficiency-invariants.ts — Pillar P7 (Efficiency-First)
 *
 * Four flag-mode invariants over canonical agent + command artifacts and
 * the governance audit-execute prompt:
 *
 *   --triage-first    Orchestrator commands (and `governance/AUDIT-EXECUTE.md`)
 *                     declare a `triage_tiers` array (subset of [1,2,3]) and
 *                     contain a Triage/Tier/Scale heading.
 *   --static-first    Orchestrator commands, agents, and AUDIT-EXECUTE.md do
 *                     not reference volatile tokens (timestamp, now, run-id,
 *                     session-counter, "today is") before their first `##`
 *                     heading.
 *   --parallel-tool   Files with >=2 tool/sub-agent mentions include a
 *                     parallel-execution directive (error since Cycle 9 D6-M9
 *                     — multi-tool serialization without a dependency edge
 *                     violates P7 efficiency and P8 fan-out discipline).
 *   --proof-id        Phase 2 (`hatch3r-implementer.md`) and Phase 3
 *                     (`hatch3r-fixer.md`) code-mutating agents declare a
 *                     `Delegation proof ID` field in their structured-result
 *                     section (P8 B2 forgery-resistant attestation; audit
 *                     Cycle 10 F5.1-H1).
 *   --rule-narrative  Rule bodies (`rules/hatch3r-*.md`) must not justify
 *                     serializing independent work with a token/context-cost
 *                     rationale (P8 dominates P7). Catches the affirmative
 *                     "cap/serialize ... for context cost" construction while
 *                     allowing the negated correct form ("cost never
 *                     serializes ..."). Audit Cycle 10 F16.1-H6 — a validator
 *                     must check rule narrative text against the principle it
 *                     enforces, not only its frontmatter.
 *   --orch-contract   Orchestrator commands (`orchestrator: true`) carry the
 *                     four 2.0.0 Constitutional contracts: a Cost Estimate
 *                     block, an Iteration Summary reference, a §0 B1
 *                     ambiguity gate, and a Resumability section. The first
 *                     three are error-level (uniformly present); Resumability
 *                     is warning-level pending the per-command retrofit
 *                     (Cycle 10 F16.1-H1 — 19/23 commands still lack it; the
 *                     command retrofit lands in a separate work unit, so a
 *                     hard error here would block on out-of-scope debt).
 *
 * No flags → all six modes run. Exit 0 unless >=1 error-level finding;
 * warnings never block. The audit-cycle prompt (`governance/AUDIT.md`,
 * `governance/RE-ENVISION.md`, `commands/hatch3r-audit-cycle*.md`) remains
 * hard-exempt; `governance/AUDIT-EXECUTE.md` is no longer exempt as of
 * 2026-04 — it carries `triage_tiers` and is checked alongside commands.
 *
 * Pillars: P7 (Efficiency-First), P8 (Clarification & Fan-out Discipline,
 * via --proof-id), P5 (Governance Self-Quality).
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
const RULES_DIR = join(ROOT, "rules");
const AUDIT_EXECUTE_REL = "governance/AUDIT-EXECUTE.md";

// ── Audit-cycle exempt list (hard-coded) ──────────────────────────
//
// RE-ENVISION.md exemption confirmed 2026-05-18 after redesign from vision-only
// dialog to holistic governance sparring engine. The redesigned prompt still
// runs interactively (one theme block at a time, 5 hard-stop ASK gates) and
// fans out 10 layer SAs in parallel at §2 — but the body remains framework-owner
// dialog, not an orchestrator pipeline. Static-first/triage-first/parallel-tool
// invariants don't apply to one-at-a-time interactive flows. Per CONSTITUTION
// §2 P7 the audit-cycle file list is hard-exempt; RE-ENVISION inherits that.

const AUDIT_EXEMPT_PATHS: readonly string[] = [
  "governance/AUDIT.md",
  "governance/RE-ENVISION.md",
];

const AUDIT_EXEMPT_GLOBS: readonly string[] = [
  "commands/hatch3r-audit-cycle*.md",
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
  proofId: boolean;
  /** Mode E — rule-narrative cost-as-serialization-rationale scan (F16.1-H6). */
  ruleNarrative?: boolean;
  /** Mode F — orchestrator-command Constitutional-contract scan (F16.1-H1). */
  orchContract?: boolean;
}

interface RunOptions {
  flags: ModeFlags;
  commandsDir?: string;
  agentsDir?: string;
  /** Rule directory for Mode E (`rules/`); test fixtures inject a tmpdir. */
  rulesDir?: string;
  /**
   * Absolute paths to extra orchestrator-style files outside `commandsDir` /
   * `agentsDir` (typically `governance/AUDIT-EXECUTE.md`). Each is loaded as
   * a command file: triage-first / static-first / parallel-tool checks all
   * apply when its frontmatter has `orchestrator: true`. Missing files are
   * silently skipped so tests don't need to seed them.
   */
  extraOrchestratorFiles?: string[];
}

interface RunResult {
  findings: Finding[];
  errorCount: number;
  warningCount: number;
}

// ── CLI parsing ───────────────────────────────────────────────────

function parseArgs(argv: readonly string[]): ModeFlags {
  const known = new Set([
    "--triage-first", "--static-first", "--parallel-tool", "--proof-id",
    "--rule-narrative", "--orch-contract",
  ]);
  const requested = new Set(argv.filter((a) => known.has(a)));
  if (requested.size === 0) {
    return {
      triageFirst: true, staticFirst: true, parallelTool: true, proofId: true,
      ruleNarrative: true, orchContract: true,
    };
  }
  return {
    triageFirst: requested.has("--triage-first"),
    staticFirst: requested.has("--static-first"),
    parallelTool: requested.has("--parallel-tool"),
    proofId: requested.has("--proof-id"),
    ruleNarrative: requested.has("--rule-narrative"),
    orchContract: requested.has("--orch-contract"),
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
//
// Audit Cycle 9 D6-M9 (Wave 3): promoted from warning to error. Multi-tool
// agents shipping without a parallel-execution directive serialize work that
// has no dependency edge — P7 (Efficiency) AND P8 B2 (fan-out discipline)
// both reject this pattern. The promotion is safe because every canonical
// agent and command in `agents/` and `commands/` carries a parallel-tool
// directive (`parallel_tool_default: true` frontmatter, "in parallel" body
// language, or both); validation in this repo runs clean.

const TOOL_MENTION_RE = /(Task tool|tool calls|sub-agent)/gi;
const PARALLEL_DIRECTIVE_RE = /(parallel|in\s*parallel|concurrent|single\s+message|batched)/i;

function checkParallelTool(file: ParsedFile): Finding[] {
  const matches = file.body.match(TOOL_MENTION_RE);
  const count = matches ? matches.length : 0;
  if (count < 2 || PARALLEL_DIRECTIVE_RE.test(file.body)) return [];
  return [{
    level: "error", code: "P7-PARALLEL-MISS", file: file.relPath,
    message:
      `${count} tool/sub-agent mentions, no parallel directive nearby ` +
      `(P7 efficiency + P8 fan-out — serialization without a dependency edge is not permitted; ` +
      `add "in parallel" / "single message" / "batched" language or set parallel_tool_default: true ` +
      `in frontmatter)`,
  }];
}

// ── Mode D: proof-id ──────────────────────────────────────────────
//
// Audit Cycle 10 F5.1-H1 — both Phase 2 (implementer) and Phase 3 (fixer)
// code-mutating agents MUST declare a `Delegation proof ID` field in their
// structured-result section so the orchestrator's End-of-Turn Delegation
// Attestation can quote a forgery-resistant token per file mutated. The
// validator asserts the literal string `Delegation proof ID` appears in
// each agent's body; the surrounding format/JSON-shape is enforced by the
// agent file's own contract, not by this regex check.

const PROOF_ID_REQUIRED_AGENTS: readonly string[] = [
  "agents/hatch3r-implementer.md",
  "agents/hatch3r-fixer.md",
];

const PROOF_ID_FIELD_RE = /Delegation proof ID/;

function checkProofId(file: ParsedFile): Finding[] {
  if (!PROOF_ID_REQUIRED_AGENTS.includes(file.relPath)) return [];
  if (PROOF_ID_FIELD_RE.test(file.body)) return [];
  return [{
    level: "error",
    code: "P8-PROOF-ID-MISS",
    file: file.relPath,
    message:
      "missing `Delegation proof ID` field in structured-result section " +
      "(P8 B2 forgery-resistant attestation required for Phase 2/3 mutating agents)",
  }];
}

// ── Mode E: rule-narrative ─────────────────────────────────────────
//
// Audit Cycle 10 F16.1-H6 — a validator must verify a rule's narrative text
// against the principle it enforces, not only its frontmatter. CONSTITUTION
// §2 P8 establishes that P8 (fan-out) dominates P7 (efficiency): token cost
// is never a valid reason to serialize independent work. A rule body that
// justifies serializing / capping / throttling parallelism *with* a
// token-or-context-cost rationale contradicts that principle.
//
// The check is intentionally negation-aware. The correct, principle-aligned
// phrasing — "token cost never serializes independent work", "NOT
// per-orchestrator context cost", "cost does not govern WHETHER to
// parallelize" — must NOT trip. Only the affirmative violation forms trip:
//   (A) `<cost noun> … <serialize/cap verb>`  with no intervening/leading negator
//   (B) `<serialize/cap verb> … (because|to reduce|for) … <cost noun>` (un-negated)
// Verified zero false positives across the full `rules/hatch3r-*.md` corpus
// at authoring time (6703 lines scanned).

const RN_COST =
  "(?:token cost|context cost|per-orchestrator (?:concurrent )?context cost|" +
  "concurrent context cost|context-window cost|context window cost)";
const RN_SERIAL =
  "(?:serializ\\w*|cap(?:ping|s|ped)?|throttl\\w*|" +
  "reduce[ds]? (?:the )?(?:fan-?out|parallel\\w*)|" +
  "limit(?:s|ed|ing)? (?:the )?(?:fan-?out|parallel\\w*))";
const RN_NEG = "(?:never|not|n.t|no longer|cannot|without|nor )";

function checkRuleNarrative(file: ParsedFile): Finding[] {
  // Only scans rule artifacts; commands/agents are handled by other modes.
  if (!file.relPath.startsWith("rules/")) return [];
  const out: Finding[] = [];
  const lines = file.body.split("\n");
  const reA = new RegExp(RN_COST + "([^.]{0,80}?)" + RN_SERIAL, "i");
  const reB = new RegExp(
    RN_SERIAL + "([^.]{0,80}?)" +
    "(?:because|due to|in order to (?:reduce|save|lower|cut|limit)|" +
    "to (?:reduce|save|lower|cut|limit)|for)([^.]{0,40}?)" + RN_COST,
    "i",
  );
  const negRe = new RegExp(RN_NEG, "i");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    let m = reA.exec(line);
    if (m) {
      const between = m[1] ?? "";
      const pre = line.slice(Math.max(0, m.index - 30), m.index).trim();
      const negPre =
        new RegExp(RN_NEG + "\\s*$|—\\s*$|-\\s*$", "i").test(pre) || /\bNOT\b\s*$/i.test(pre);
      if (!negRe.test(between) && !negPre) {
        out.push({
          level: "error", code: "P8-RULE-NARRATIVE-VIOL", file: file.relPath,
          line: file.bodyStartLine + i,
          message:
            "rule narrative justifies serializing/capping parallelism with a " +
            "token/context-cost rationale; P8 dominates P7 — token cost never " +
            "serializes independent work (CONSTITUTION §2 P8)",
        });
        continue; // one finding per line is enough
      }
    }
    m = reB.exec(line);
    if (m) {
      const win = (m[1] ?? "") + (m[2] ?? "");
      if (!negRe.test(win)) {
        out.push({
          level: "error", code: "P8-RULE-NARRATIVE-VIOL", file: file.relPath,
          line: file.bodyStartLine + i,
          message:
            "rule narrative serializes/caps parallelism for a token/context-cost " +
            "reason; P8 dominates P7 (CONSTITUTION §2 P8)",
        });
      }
    }
  }
  return out;
}

// ── Mode F: orchestrator-contract ──────────────────────────────────
//
// Audit Cycle 10 F16.1-H1 — the four 2.0.0 Constitutional contracts each
// landed on only 1-3 of the orchestrator commands at audit time. This mode
// asserts every `orchestrator: true` command carries all four:
//   - Cost Estimate block      (P7 cost-visibility)
//   - Iteration Summary ref    (closed-loop reporting)
//   - §0 B1 ambiguity gate     (P8 clarification-default)
//   - Resumability section     (mid-flight resume contract)
//
// Severity split: the first three are error-level — verified uniformly
// present across all 23 orchestrator commands, so a missing one is a real
// regression. Resumability is warning-level: 19/23 commands still lack the
// section at authoring time and the per-command retrofit is a separate work
// unit, so emitting an error here would block `npm run validate` on
// out-of-scope debt. Promote Resumability to error once the retrofit lands.

interface OrchContractProbe {
  readonly label: string;
  readonly re: RegExp;
  readonly level: Severity;
  readonly code: string;
}

const ORCH_CONTRACT_PROBES: readonly OrchContractProbe[] = [
  { label: "Cost Estimate block", level: "error", code: "P7-ORCH-COST-MISS",
    re: /Cost\s+(?:Estimate|Preview)|cost[_-]estimate|##\s+Cost/i },
  { label: "Iteration Summary reference", level: "error", code: "P5-ORCH-ITER-MISS",
    re: /Iteration\s+Summary|iteration-summary/i },
  { label: "B1 ambiguity gate", level: "error", code: "P8-ORCH-B1-MISS",
    re: /\bB1\b|ambiguity|user-question-protocol|clarification/i },
  { label: "Resumability section", level: "warning", code: "P5-ORCH-RESUME-MISS",
    re: /Resumab\w+|##\s+Resume|\bresume\b/i },
];

function checkOrchContract(file: ParsedFile): Finding[] {
  if (!isOrchestrator(file.frontmatter)) return [];
  const out: Finding[] = [];
  for (const probe of ORCH_CONTRACT_PROBES) {
    if (!probe.re.test(file.body)) {
      out.push({
        level: probe.level, code: probe.code, file: file.relPath,
        message: `orchestrator command missing ${probe.label} (2.0.0 Constitutional contract; Cycle 10 F16.1-H1)`,
      });
    }
  }
  return out;
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

async function loadExtraFile(absPath: string, baseDir: string, sink: Finding[]): Promise<ParsedFile | null> {
  try {
    const f = await loadFile(absPath, baseDir);
    if (isAuditExempt(f.relPath)) return null;
    if (f.fmParseFailed) {
      sink.push({
        level: "warning", code: "P7-FM-PARSE", file: f.relPath,
        message: "frontmatter YAML parse failed; skipping further checks for this file",
      });
      return null;
    }
    return f;
    // Missing extra files are silently skipped — the caller (production main
    // or tests) decides which paths to seed; absence is informational, not an
    // error. No diagnostic channel applies because the validator is
    // explicitly tolerant of unseeded paths.
    // eslint-disable-next-line silent-failure/no-silent-catch
  } catch {
    return null;
  }
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

  // Rule files are only loaded when Mode E is requested (avoids reading the
  // 55-file rules corpus on runs that don't need it).
  let ruleFiles: ParsedFile[] = [];
  if (opts.flags.ruleNarrative) {
    const ruleDir = opts.rulesDir ?? RULES_DIR;
    ruleFiles = await loadDir(ruleDir, resolve(ruleDir, ".."), findings);
  }

  for (const abs of opts.extraOrchestratorFiles ?? []) {
    // baseDir is two levels up from the file (e.g., parent of `governance/`),
    // so relPath comes out as `governance/AUDIT-EXECUTE.md` — the same shape
    // the audit-exempt list expects.
    const baseDir = resolve(abs, "../..");
    const extra = await loadExtraFile(abs, baseDir, findings);
    if (extra) commandFiles.push(extra);
  }

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
  if (opts.flags.proofId) {
    for (const f of agentFiles) findings.push(...checkProofId(f));
  }
  if (opts.flags.ruleNarrative) {
    for (const f of ruleFiles) findings.push(...checkRuleNarrative(f));
  }
  if (opts.flags.orchContract) {
    for (const f of commandFiles) findings.push(...checkOrchContract(f));
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
  const { findings, errorCount, warningCount } = await runValidator({
    flags,
    extraOrchestratorFiles: [join(ROOT, AUDIT_EXECUTE_REL)],
  });
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
