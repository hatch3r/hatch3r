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
 *                     session-counter, "today is") anywhere in their cacheable
 *                     static prefix — the first 80 body lines (Cycle 11 D6-10:
 *                     the whole inlined body is the cacheable prefix, not only
 *                     the slice before the first `##` heading).
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
 *                     ambiguity gate, and a Resumability section. All four are
 *                     error-level (Cycle 10 F16.1-H1 for the first three;
 *                     Cycle 11 D6-27 promoted Resumability once its per-command
 *                     retrofit landed — every orchestrator now declares it via
 *                     a Resumability/Subcommand:resume heading or the
 *                     `supports_resume: true` frontmatter flag; the regex was
 *                     tightened so an incidental prose "resume" no longer
 *                     satisfies the contract).
 *   --efficiency-tier Every `orchestrator: true` command and every
 *                     `agents/hatch3r-*.md` agent declares a valid
 *                     `efficiency_tier` (light|standard|deep). Audit Cycle 10
 *                     D6-SA6.6-Finding4 — agents declared all five efficiency
 *                     fields but orchestrator commands omitted efficiency_tier,
 *                     so the SA6.6 audit signal could not triangulate command
 *                     tiers. Error-level: all 23 commands + 30 agents now carry
 *                     the field, so a missing/invalid one is a real regression.
 *   --rule-line-cap   Every `rules/hatch3r-*.md` body+frontmatter line count is
 *                     within the CONSTITUTION §2 P5 ceiling for its precedence:
 *                     `critical`/`high` => 250 lines, `normal`/`low` => 120
 *                     lines (default precedence `normal`). Audit Cycle 11 D5-7 —
 *                     the lean line limits had no CI enforcement, so 5 normal-
 *                     precedence rules drifted over the 120-line cap. Error-
 *                     level: a breach is a P4/P5 lean-coverage regression.
 *   --runtime-efficiency Three cheaply-checkable SA6.5 runtime-efficiency gates
 *                     (Audit Cycle 11 D6-11): (1) planning commands' `agentPipeline`
 *                     excludes `hatch3r-implementer`/`hatch3r-fixer` (plan/act
 *                     split — a planning command must not bundle execution
 *                     agents); (2) every `skills/<name>/SKILL.md` carries a
 *                     non-empty `description:` in frontmatter (skill-body lazy-load
 *                     semantics); (3) Phase 2/3 mutating agents
 *                     (`hatch3r-implementer.md`, `hatch3r-fixer.md`) contain a
 *                     fenced structured-result block (structured outputs over
 *                     prose). The remaining 2 SA6.5 items (lazy-loading,
 *                     dispatch-gating) are prose-reviewed with no CI gate.
 *
 * No flags → all nine modes run. Exit 0 unless >=1 error-level finding;
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
import { existsSync } from "node:fs";
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
const SKILLS_DIR = join(ROOT, "skills");
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
  /** Newline count of the raw file (matches `wc -l` semantics) — Mode H line-cap. */
  rawLineCount: number;
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
  /** Mode G — efficiency_tier presence on orchestrator commands + agents (D6-SA6.6-Finding4). */
  efficiencyTier?: boolean;
  /** Mode H — rule line-cap by precedence (D5-7). */
  ruleLineCap?: boolean;
  /** Mode I — cheaply-checkable SA6.5 runtime-efficiency gates (D6-11). */
  runtimeEfficiency?: boolean;
}

interface RunOptions {
  flags: ModeFlags;
  commandsDir?: string;
  agentsDir?: string;
  /** Rule directory for Mode E + Mode H (`rules/`); test fixtures inject a tmpdir. */
  rulesDir?: string;
  /** Skills directory for Mode I (`skills/`); test fixtures inject a tmpdir. */
  skillsDir?: string;
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
    "--rule-narrative", "--orch-contract", "--efficiency-tier",
    "--rule-line-cap", "--runtime-efficiency",
  ]);
  const requested = new Set(argv.filter((a) => known.has(a)));
  if (requested.size === 0) {
    return {
      triageFirst: true, staticFirst: true, parallelTool: true, proofId: true,
      ruleNarrative: true, orchContract: true, efficiencyTier: true,
      ruleLineCap: true, runtimeEfficiency: true,
    };
  }
  return {
    triageFirst: requested.has("--triage-first"),
    staticFirst: requested.has("--static-first"),
    parallelTool: requested.has("--parallel-tool"),
    proofId: requested.has("--proof-id"),
    ruleNarrative: requested.has("--rule-narrative"),
    orchContract: requested.has("--orch-contract"),
    efficiencyTier: requested.has("--efficiency-tier"),
    ruleLineCap: requested.has("--rule-line-cap"),
    runtimeEfficiency: requested.has("--runtime-efficiency"),
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

// `wc -l` counts trailing newlines; a file with no final newline counts one
// fewer than its visual line count. Match that convention so the validator's
// numbers line up with the CONSTITUTION §2 P5 limits (authored against `wc -l`).
function countNewlines(raw: string): number {
  let n = 0;
  for (let i = 0; i < raw.length; i++) if (raw.charCodeAt(i) === 10) n++;
  return n;
}

async function loadFile(absPath: string, baseDir: string): Promise<ParsedFile> {
  const raw = await readFile(absPath, "utf-8");
  const split = splitFrontmatter(raw);
  return {
    absPath,
    relPath: toPosixRel(absPath, baseDir),
    rawLineCount: countNewlines(raw),
    ...split,
  };
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
//
// The whole inlined artifact body is the LLM-cacheable static prefix — a
// per-run volatile substitution anywhere in it moves the cache breakpoint, not
// only one occurring before the first `##` heading.
//
// Audit Cycle 11 D6-10: the prior implementation scanned ONLY the pre-first-
// `##` window. When the first `##` heading sat on body line 0 (e.g.
// `commands/hatch3r-debug.md`, whose body opens with `## §0 Detect Ambiguity`)
// the stop index was 0 and the loop scanned ZERO lines — a ~95% coverage hole
// that let a volatile token after the first heading pass green. The scan now
// covers the whole body up to STATIC_SCAN_CAP lines, with a two-band match:
//
//   - Preamble band (before the first `##` heading): the bare-word
//     VOLATILE_TOKEN_RE trips. The preamble is the stable lead-in an author
//     writes as static instruction; a bare reference to `timestamp`/`now`/
//     `run-id` there is almost always an actual per-run value, so the strict
//     word match (the historical contract) is retained.
//   - Body band (at/after the first `##` heading): only a TEMPLATE-SUBSTITUTION
//     form trips — `{{timestamp}}`, `{now}`, `${run_id}`, `%session-counter%`.
//     These are what a renderer replaces per run, defeating the cache. Section
//     bodies legitimately *document* dynamic tokens in prose and tables (a
//     field named `timestamp`, a `<run-id>` CLI placeholder, the adverb "now"),
//     so the bare-word match is not applied past the preamble — that is the
//     exact distinction that keeps the full-body scan free of false positives
//     on the canonical corpus while still catching a real `{{timestamp}}`
//     injected mid-body.

const VOLATILE_TOKEN_RE = /\b(timestamp|now|run[-_]?id|session[-_]?counter|today\s+is)\b/i;
// A volatile token wrapped in a template-substitution delimiter — `{{tok}}`,
// `{tok}`, `${tok}` / `$tok`, `%tok%`, `<<tok>>`. The inner token reuses the
// VOLATILE_TOKEN_RE alternation (sans anchors). These are renderer-replaced
// per run and so break the cacheable prefix even inside a section body.
const VOLATILE_SUBST_RE =
  /(\{\{?\s*(?:timestamp|now|run[-_]?id|session[-_]?counter)\s*\}?\}|\$\{?\s*(?:timestamp|now|run[-_]?id|session[-_]?counter)\s*\}?|%\s*(?:timestamp|now|run[-_]?id|session[-_]?counter)\s*%|<<\s*(?:timestamp|now|run[-_]?id|session[-_]?counter)\s*>>)/i;
// Cacheable-prefix scan budget. Raised from the prior 60-line slice ceiling so
// a token deeper in a mid-length static body is still caught; bodies longer
// than this are bounded for scan cost (the head governs breakpoint stability).
const STATIC_SCAN_CAP = 80;

function checkStaticFirst(file: ParsedFile): Finding[] {
  const lines = file.body.split("\n").slice(0, STATIC_SCAN_CAP);
  const firstH2 = lines.findIndex((l) => /^##\s+/.test(l));
  // When there is no heading in the scanned window the whole window is preamble.
  const preambleEnd = firstH2 === -1 ? lines.length : firstH2;
  for (let i = 0; i < lines.length; i++) {
    const inPreamble = i < preambleEnd;
    const m = inPreamble
      ? lines[i].match(VOLATILE_TOKEN_RE)
      : lines[i].match(VOLATILE_SUBST_RE);
    if (m) {
      const where = inPreamble ? "preamble" : "section body (template-substitution form)";
      return [{
        level: "error", code: "P7-STATIC-VIOL", file: file.relPath,
        line: file.bodyStartLine + i,
        message: `volatile token "${m[0].trim()}" in the cacheable static prefix — ${where} (within the first ${STATIC_SCAN_CAP} body lines)`,
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
//
// Audit Cycle 11 D6-9: the directive check was previously run against the
// ENTIRE body, so the ubiquitous "Parallel-safety conditions ..." governance
// boilerplate (28/30 commands ship a clause containing the word "parallel")
// satisfied the gate regardless of actual tool-call topology — a serialized
// multi-tool flow passed green as long as the boilerplate appeared anywhere.
// The directive must now be CO-LOCATED with the tool mentions it governs:
// either the `parallel_tool_default: true` frontmatter flag (an affirmative
// dispatch directive distinct from prose boilerplate) is set, OR a directive
// match falls within PARALLEL_WINDOW lines of a tool-mention line. Distant
// safety boilerplate no longer launders a serialized flow.

const TOOL_MENTION_RE = /(Task tool|tool calls|sub-agent)/gi;
const PARALLEL_DIRECTIVE_RE = /(parallel|in\s*parallel|concurrent|single\s+message|batched)/i;
// A directive within +/- this many lines of a tool mention "governs" it.
const PARALLEL_WINDOW = 3;

const hasParallelDefault = (fm: Record<string, unknown>): boolean =>
  fm.parallel_tool_default === true;

function checkParallelTool(file: ParsedFile): Finding[] {
  const lines = file.body.split("\n");
  const mentionLines: number[] = [];
  let count = 0;
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(TOOL_MENTION_RE);
    if (m) {
      count += m.length;
      mentionLines.push(i);
    }
  }
  if (count < 2) return [];
  // Affirmative frontmatter dispatch directive — distinct from prose boilerplate.
  if (hasParallelDefault(file.frontmatter)) return [];
  // A parallel directive co-located with any tool mention satisfies the gate.
  const directiveNearMention = mentionLines.some((idx) => {
    const lo = Math.max(0, idx - PARALLEL_WINDOW);
    const hi = Math.min(lines.length - 1, idx + PARALLEL_WINDOW);
    for (let j = lo; j <= hi; j++) {
      if (PARALLEL_DIRECTIVE_RE.test(lines[j])) return true;
    }
    return false;
  });
  if (directiveNearMention) return [];
  return [{
    level: "error", code: "P7-PARALLEL-MISS", file: file.relPath,
    message:
      `${count} tool/sub-agent mentions, no parallel directive within ${PARALLEL_WINDOW} lines of a mention ` +
      `(P7 efficiency + P8 fan-out — serialization without a dependency edge is not permitted; ` +
      `co-locate "in parallel" / "single message" / "batched" language with the tool mentions, ` +
      `or set parallel_tool_default: true in frontmatter — distant safety boilerplate does not count)`,
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
// All four are error-level. The first three were verified uniformly present
// at Cycle 10 authoring time. Resumability was warning-level pending the
// per-command retrofit (19/23 commands lacked the section then); Cycle 11
// D6-27 confirmed the retrofit landed (every long-running orchestrator now
// carries the section: a `## Resumability` heading, or — for the thin
// subcommand dispatcher `hatch3r-handoff.md` — a first-class `## Subcommand:
// resume` heading, or the `supports_resume: true` frontmatter flag for a thin
// router that delegates the checkpointed phase to its sub-agents, e.g.
// `hatch3r-spec.md`), so the probe is promoted to error. The probe regex is
// tightened in lockstep: a bare prose mention of the word "resume" no longer
// satisfies the contract — only an `^##`/`^###` Resumability/Subcommand:resume
// HEADING in the body, or the affirmative `supports_resume: true` frontmatter
// flag, counts. (`governance/AUDIT-EXECUTE.md`, fed as an extra orchestrator
// file, satisfies this via its `### Resumability` h3 heading.)

interface OrchContractProbe {
  readonly label: string;
  readonly re: RegExp;
  readonly level: Severity;
  readonly code: string;
  /**
   * Optional frontmatter affirmative-flag escape hatch (Mode C parity with
   * `parallel_tool_default`). When set and the flag is `=== true`, the probe
   * is satisfied without a body-regex match — a thin router that delegates the
   * resumability phase to its sub-agents declares the contract in frontmatter.
   */
  readonly affirmativeFlag?: string;
}

// Resumability is satisfied by a real HEADING, not an incidental prose token:
// an `^##`/`^###` "Resumability" section (optionally numbered as a Step), or
// the `## Subcommand: resume` heading used by the handoff dispatcher.
const RESUME_HEADING_RE =
  /^#{2,3}\s+(?:Step\s+\d+:?\s+)?Resumab\w*|^##\s+Subcommand:\s+resume\b/im;

const ORCH_CONTRACT_PROBES: readonly OrchContractProbe[] = [
  { label: "Cost Estimate block", level: "error", code: "P7-ORCH-COST-MISS",
    re: /Cost\s+(?:Estimate|Preview)|cost[_-]estimate|##\s+Cost/i },
  { label: "Iteration Summary reference", level: "error", code: "P5-ORCH-ITER-MISS",
    re: /Iteration\s+Summary|iteration-summary/i },
  { label: "B1 ambiguity gate", level: "error", code: "P8-ORCH-B1-MISS",
    re: /\bB1\b|ambiguity|user-question-protocol|clarification/i },
  { label: "Resumability section", level: "error", code: "P5-ORCH-RESUME-MISS",
    re: RESUME_HEADING_RE, affirmativeFlag: "supports_resume" },
];

function checkOrchContract(file: ParsedFile): Finding[] {
  if (!isOrchestrator(file.frontmatter)) return [];
  const out: Finding[] = [];
  for (const probe of ORCH_CONTRACT_PROBES) {
    if (probe.affirmativeFlag && file.frontmatter[probe.affirmativeFlag] === true) continue;
    if (!probe.re.test(file.body)) {
      out.push({
        level: probe.level, code: probe.code, file: file.relPath,
        message: `orchestrator command missing ${probe.label} (2.0.0 Constitutional contract; Cycle 10 F16.1-H1)`,
      });
    }
  }
  return out;
}

// ── Mode G: efficiency-tier ─────────────────────────────────────────
//
// Audit Cycle 10 D6-SA6.6-Finding4 — 30/30 agents declared all five
// efficiency frontmatter fields but the orchestrator commands omitted
// `efficiency_tier`, so the SA6.6 audit signal could not triangulate a
// command's tier. This mode asserts the field is present AND valid
// (light|standard|deep) on every `orchestrator: true` command and every
// `agents/hatch3r-*.md` agent. The caller decides which file set to run it
// over (commands are gated on `orchestrator: true` here; agents are gated by
// the runner passing only agent files). Error-level — all 23 commands and 30
// agents carry the field, so a missing/invalid one is a real regression.

const EFFICIENCY_TIER_VALUES: ReadonlySet<string> = new Set(["light", "standard", "deep"]);

function checkEfficiencyTier(file: ParsedFile, requireOrchestrator: boolean): Finding[] {
  // Scope is the canonical command/agent corpus only. The injected
  // `governance/AUDIT-EXECUTE.md` prompt is `orchestrator: true` for the
  // triage/static/parallel modes but is NOT a `commands/hatch3r-*.md`
  // artifact, so it is outside the D6-SA6.6-Finding4 efficiency_tier contract.
  if (!file.relPath.startsWith("commands/hatch3r-") && !file.relPath.startsWith("agents/hatch3r-")) {
    return [];
  }
  if (requireOrchestrator && !isOrchestrator(file.frontmatter)) return [];
  const tier = file.frontmatter.efficiency_tier;
  if (tier === undefined) {
    return [{
      level: "error", code: "P5-EFFICIENCY-TIER-MISS", file: file.relPath,
      message:
        "missing `efficiency_tier` (light|standard|deep) in frontmatter " +
        "(D6-SA6.6-Finding4 — required on orchestrator commands + agents for the SA6.6 efficiency signal)",
    }];
  }
  if (typeof tier !== "string" || !EFFICIENCY_TIER_VALUES.has(tier)) {
    return [{
      level: "error", code: "P5-EFFICIENCY-TIER-INVALID", file: file.relPath,
      message: `invalid \`efficiency_tier\` ${JSON.stringify(tier)}; expected one of light|standard|deep`,
    }];
  }
  return [];
}

// ── Mode H: rule line-cap ───────────────────────────────────────────
//
// Audit Cycle 11 D5-7 — CONSTITUTION §2 P5 sets `rules/*.md` line limits by
// precedence (critical/high => 250, normal/low => 120, default normal) but no
// CI leg enforced them, so 5 normal-precedence rules drifted past the 120-line
// cap. This mode reads each rule's `precedence` frontmatter (defaulting to
// `normal`), resolves the cap, and compares the raw `wc -l` count. The limits
// mirror `scripts/validate-lean-threshold-currency.ts`, which independently
// asserts these same row values stay in sync with the Constitution; this mode
// is the per-file enforcer those row values describe. Error-level — a breach is
// a P4/P5 lean-coverage regression the maintainer must compress or, for a
// genuinely-high rule, promote (which raises the cap to 250).

const RULE_PRECEDENCE_HIGH: ReadonlySet<string> = new Set(["critical", "high"]);
const RULE_PRECEDENCE_LOW: ReadonlySet<string> = new Set(["normal", "low"]);
const RULE_LINE_CAP_HIGH = 250;
const RULE_LINE_CAP_NORMAL = 120;

function checkRuleLineCap(file: ParsedFile): Finding[] {
  if (!file.relPath.startsWith("rules/")) return [];
  const rawPrec = file.frontmatter.precedence;
  const prec = typeof rawPrec === "string" ? rawPrec : "normal";
  // An unrecognized precedence value is out of this mode's scope — the rule
  // assignment-policy validator owns vocabulary checks. Default to the stricter
  // 120-line cap so an unknown value can never silently buy the 250-line bound.
  const isHigh = RULE_PRECEDENCE_HIGH.has(prec);
  const cap = isHigh ? RULE_LINE_CAP_HIGH : RULE_LINE_CAP_NORMAL;
  if (file.rawLineCount <= cap) return [];
  const tier = isHigh ? "critical/high" : RULE_PRECEDENCE_LOW.has(prec) ? "normal/low" : `${prec} (treated as normal/low)`;
  return [{
    level: "error", code: "P4-RULE-LINE-CAP", file: file.relPath,
    message:
      `${file.rawLineCount} lines exceeds the ${cap}-line cap for precedence ${tier} ` +
      `(CONSTITUTION §2 P5; D5-7 — compress the rule, or promote a genuinely-high one to raise the cap to 250)`,
  }];
}

// ── Mode I: runtime-efficiency (SA6.5 cheap gates) ──────────────────
//
// Audit Cycle 11 D6-11 — three of the eight SA6.5 runtime-efficiency checklist
// items are cheaply machine-checkable but had zero enforcement, so they could
// regress silently green. This mode adds them; the remaining 2 (lazy-loading /
// reference-by-pointer, dispatch-gating correctness) are semantic and stay
// prose-reviewed with no CI gate (annotated in the file header). The three:
//
//   (1) Plan/act split — a planning command (`tags:` includes `planning`) must
//       NOT list a code-mutating agent (`hatch3r-implementer`/`hatch3r-fixer`)
//       in its `agentPipeline`. Bundling execution into a planning command
//       collapses the plan/act boundary (SA6.5 plan/act split).
//   (2) Skill-body lazy-load — every `skills/*/SKILL.md` carries a non-empty
//       `description:` in frontmatter that loads independently of the body
//       (SA6.5 skill body lazy-load semantics; Anthropic progressive-disclosure).
//   (3) Structured outputs — the Phase 2/3 mutating agents
//       (`hatch3r-implementer.md`, `hatch3r-fixer.md`) contain a fenced
//       structured-result block so phase handoff is machine-parseable, not
//       free-form prose (SA6.5 structured outputs over prose).

const EXEC_PIPELINE_AGENTS: readonly string[] = ["hatch3r-implementer", "hatch3r-fixer"];
const STRUCTURED_RESULT_REQUIRED_AGENTS: readonly string[] = [
  "agents/hatch3r-implementer.md",
  "agents/hatch3r-fixer.md",
];
const FENCED_BLOCK_RE = /^```/m;

function hasPlanningTag(fm: Record<string, unknown>): boolean {
  const tags = fm.tags;
  return Array.isArray(tags) && tags.some((t) => typeof t === "string" && t === "planning");
}

/** Gate (1): planning command's `agentPipeline` must exclude execution agents. */
function checkPlanActSplit(file: ParsedFile): Finding[] {
  if (!file.relPath.startsWith("commands/hatch3r-")) return [];
  if (!hasPlanningTag(file.frontmatter)) return [];
  const pipeline = file.frontmatter.agentPipeline;
  if (!Array.isArray(pipeline)) return [];
  const offenders = pipeline.filter(
    (a) => typeof a === "string" && EXEC_PIPELINE_AGENTS.includes(a),
  );
  if (offenders.length === 0) return [];
  return [{
    level: "error", code: "P7-PLAN-ACT-SPLIT", file: file.relPath,
    message:
      `planning command lists execution agent(s) ${JSON.stringify(offenders)} in agentPipeline ` +
      `(SA6.5 plan/act split — a planning command must delegate planning, not bundle execution; D6-11)`,
  }];
}

/** Gate (2): every SKILL.md carries a non-empty frontmatter `description:`. */
function checkSkillDescription(file: ParsedFile): Finding[] {
  if (!file.relPath.endsWith("/SKILL.md")) return [];
  const desc = file.frontmatter.description;
  if (typeof desc === "string" && desc.trim().length > 0) return [];
  return [{
    level: "error", code: "P7-SKILL-DESC-MISS", file: file.relPath,
    message:
      "SKILL.md missing a non-empty `description:` in frontmatter " +
      "(SA6.5 skill-body lazy-load — the description must load independently of the body; D6-11)",
  }];
}

/** Gate (3): Phase 2/3 mutating agents contain a fenced structured-result block. */
function checkStructuredResult(file: ParsedFile): Finding[] {
  if (!STRUCTURED_RESULT_REQUIRED_AGENTS.includes(file.relPath)) return [];
  if (FENCED_BLOCK_RE.test(file.body)) return [];
  return [{
    level: "error", code: "P7-STRUCTURED-RESULT-MISS", file: file.relPath,
    message:
      "missing a fenced structured-result block (```...```) in the agent body " +
      "(SA6.5 structured outputs over prose — Phase 2/3 handoff must be machine-parseable; D6-11)",
  }];
}

// ── Orchestrator ──────────────────────────────────────────────────

async function listSkillFiles(dir: string): Promise<string[]> {
  // `skills/<name>/SKILL.md` — one level of subdirectory, then the file.
  let entries: Array<{ name: string; isDirectory: () => boolean }>;
  try {
    entries = await readdir(dir, { withFileTypes: true });
    // An absent skills directory is informational, not an error: test fixtures
    // and partial clones may not seed it. Mirrors `listTopLevelMd` tolerance.
    // eslint-disable-next-line silent-failure/no-silent-catch
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const candidate = join(dir, e.name, "SKILL.md");
    if (existsSync(candidate)) out.push(candidate);
  }
  return out.sort((a, b) => a.localeCompare(b));
}

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

  // Rule files are only loaded when a rule-scoped mode (E narrative or H
  // line-cap) is requested (avoids reading the rules corpus on runs that don't
  // need it).
  let ruleFiles: ParsedFile[] = [];
  if (opts.flags.ruleNarrative || opts.flags.ruleLineCap) {
    const ruleDir = opts.rulesDir ?? RULES_DIR;
    ruleFiles = await loadDir(ruleDir, resolve(ruleDir, ".."), findings);
  }

  // Skill files (`skills/*/SKILL.md`) are only loaded when Mode I is requested.
  const skillFiles: ParsedFile[] = [];
  if (opts.flags.runtimeEfficiency) {
    const skillDir = opts.skillsDir ?? SKILLS_DIR;
    const skillBase = resolve(skillDir, "..");
    for (const abs of await listSkillFiles(skillDir)) {
      const f = await loadFile(abs, skillBase);
      if (f.fmParseFailed) {
        findings.push({
          level: "warning", code: "P7-FM-PARSE", file: f.relPath,
          message: "frontmatter YAML parse failed; skipping further checks for this file",
        });
        continue;
      }
      skillFiles.push(f);
    }
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
  if (opts.flags.efficiencyTier) {
    // Commands: gated on `orchestrator: true`. Agents: every agent file.
    for (const f of commandFiles) findings.push(...checkEfficiencyTier(f, true));
    for (const f of agentFiles) findings.push(...checkEfficiencyTier(f, false));
  }
  if (opts.flags.ruleLineCap) {
    for (const f of ruleFiles) findings.push(...checkRuleLineCap(f));
  }
  if (opts.flags.runtimeEfficiency) {
    // Gate 1 (plan/act): planning commands only. Gate 3 (structured result):
    // the two named mutating agents. Gate 2 (skill description): every SKILL.md.
    for (const f of commandFiles) findings.push(...checkPlanActSplit(f));
    for (const f of agentFiles) findings.push(...checkStructuredResult(f));
    for (const f of skillFiles) findings.push(...checkSkillDescription(f));
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
  // `governance/AUDIT-EXECUTE.md` is private and absent in public CI /
  // contributor clones. Only feed it as an extra orchestrator file when it
  // exists; the command + agent invariant checks always run regardless.
  const auditExecuteAbs = join(ROOT, AUDIT_EXECUTE_REL);
  const extraOrchestratorFiles: string[] = [];
  if (existsSync(auditExecuteAbs)) {
    extraOrchestratorFiles.push(auditExecuteAbs);
  } else {
    // eslint-disable-next-line no-console
    console.error(
      `[validate-efficiency-invariants] ${AUDIT_EXECUTE_REL} absent — skipping AUDIT-EXECUTE orchestrator probe`,
    );
  }
  const { findings, errorCount, warningCount } = await runValidator({
    flags,
    extraOrchestratorFiles,
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
