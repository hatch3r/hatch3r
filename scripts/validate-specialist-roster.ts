#!/usr/bin/env node
/**
 * scripts/validate-specialist-roster.ts — Pillar P4 (Comprehensive Lean
 * Coverage / Single Source of Truth), P5 (Governance Self-Quality).
 *
 * Finding F7.3-H3 (D7, High): the Phase 4 specialist roster was duplicated in
 * 5+ locations (orchestration rule prose + table, implementer.md, reviewer.md,
 * each command's `agentPipeline`). Wave 1 (F7.3-C1) promoted
 * `src/pipeline/pipelineContext.ts::SPECIALIST_TRIGGER_TABLE` to the single
 * source of truth. This script is the regression-preventing CI gate the
 * finding requires: it imports the SSOT constant and asserts every prose /
 * frontmatter dispatch surface still names the same specialists, so a future
 * diff that adds a specialist to the code constant without updating the
 * dispatch surfaces (F-1's exact failure mode — 9 agents added, 0 dispatch
 * surfaces updated) fails CI.
 *
 * Surfaces checked (per F7.3-H3 recommendation steps 2-4):
 *
 *   2. `rules/hatch3r-agent-orchestration.md` "Phase 4 Specialist Trigger
 *      Table" markdown table — its specialist-ID set must equal the SSOT set
 *      (bidirectional: no extra, no missing).
 *   3. Agent Roster — every SSOT specialist has an `agents/<id>.md` file; and
 *      `agents/hatch3r-implementer.md` + `agents/hatch3r-reviewer.md` Phase 4
 *      specialist enumerations name every SSOT specialist.
 *   4. Full-pipeline orchestrator commands (workflow / revision / board-pickup)
 *      `agentPipeline:` frontmatter includes every always-mode + evaluate-mode
 *      + mandatory-on-match specialist (a full-pipeline orchestrator must be
 *      able to dispatch a hard-mandate Tier 2/3 specialist). Conditional-mode
 *      specialists are excluded from the strict-match (a command may
 *      legitimately omit a conditional specialist).
 *      `quick-change` is exempt from the evaluate-mode (docs-writer) check — it
 *      is the documented Tier-1 carve-out that intentionally skips docs-writer
 *      (`commands/hatch3r-quick-change.md` "intentionally skips"), but is still
 *      held to the always-mode (test-writer / security-auditor) floor.
 *   5. Watchdog coverage (D8-12) — every SSOT specialist + the four core
 *      4-phase pipeline agents (researcher / implementer / fixer / reviewer)
 *      declares the watchdog directive via EITHER a numeric
 *      `wall_clock_advisory_ms` frontmatter field OR a body reference to the
 *      shared carrier `agents/shared/quality-specialist-frame.md`.
 *   6. CQ specialist trigger-table single-source (D16-12 / D6-15 / D22-6) — the
 *      9-row `## Specialist Delegation` CQ trigger table (`| CQ<n> ... |
 *      hatch3r-<x> | <trigger prose> |`) was hand-copied verbatim into THREE
 *      agent files (implementer.md, reviewer.md, fixer.md); the prior gate
 *      opened only implementer + reviewer and checked specialist-id PRESENCE,
 *      never the trigger column and never fixer, so the three copies could (and
 *      per the D16-12 finding did) drift. D22-6 extracted the table to the
 *      single source `agents/shared/cq-specialist-roster.md` and replaced the
 *      three copies with a one-line pointer. This check now: (a) asserts the
 *      shared roster holds the 9 CQ rows (table-loss guard); (b) asserts each of
 *      the three agents points at the shared roster instead of re-inlining the
 *      table; (c) if an agent DOES re-inline CQ rows (a regression that copies
 *      the table back), asserts every inlined row is byte-identical to the
 *      shared source. The single source makes the former three-way drift
 *      structurally impossible while the gate keeps any reintroduced copy honest.
 *   7. Reverse phase_4_trigger coverage (D22-SA22.1-01) — every agent file whose
 *      frontmatter carries a `phase_4_trigger:` key (the shape the 9 CQ
 *      specialists use to declare SPECIALIST_TRIGGER_TABLE membership) must be a
 *      SSOT specialist OR a documented supporting-analyst exemption
 *      (SUPPORTING_ANALYST_PHASE4_ALLOWLIST). The forward checks iterate the
 *      SSOT and are structurally blind to an agent carrying the
 *      membership-signalling key while absent from the table; this reverse check
 *      closes that gap so a false "specialist" signal fails CI.
 *
 * Failure modes (each emits one ERROR finding):
 *
 *   ROSTER-RULE-MISSING    specialist in SSOT but absent from the rule table
 *   ROSTER-RULE-EXTRA      specialist in the rule table but absent from SSOT
 *   ROSTER-AGENT-FILE      SSOT specialist has no `agents/<id>.md` file
 *   ROSTER-IMPL-MISSING    SSOT specialist not named in implementer.md Phase 4
 *   ROSTER-REVIEW-MISSING  SSOT specialist not named in reviewer.md Phase 4
 *   ROSTER-CMD-MISSING     always/evaluate/mandatory-on-match specialist absent
 *                          from a command's agentPipeline
 *   ROSTER-WATCHDOG-MISSING  SSOT specialist or core pipeline agent declares
 *                          no watchdog directive (field or shared-frame ref)
 *   ROSTER-CQ-TABLE-DRIFT  the shared CQ roster is missing its rows, an agent
 *                          neither points at the shared roster nor inlines the
 *                          table, or a reintroduced inline copy diverges from
 *                          the shared source (implementer / reviewer / fixer)
 *   ROSTER-PHASE4-EXTRA    an agent carries `phase_4_trigger` frontmatter but is
 *                          neither a SPECIALIST_TRIGGER_TABLE member nor a
 *                          documented supporting-analyst exemption
 *
 * Warnings (non-blocking):
 *
 *   ROSTER-CMD-FM-PARSE    a command's frontmatter YAML failed to parse
 *
 * Pillars: P4 (Single Source of Truth), P5 (Governance Self-Quality).
 *
 * Usage: `npm run validate:specialist-roster`
 *        `tsx scripts/validate-specialist-roster.ts`
 *        `tsx scripts/validate-specialist-roster.ts --json`
 */
import { readFile, readdir } from "node:fs/promises";
import { access } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";

import { SPECIALIST_TRIGGER_TABLE } from "../src/pipeline/pipelineContext.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = resolve(__dirname, "..");
const AGENTS_DIR = join(ROOT, "agents");
const RULE_FILE = join(ROOT, "rules", "hatch3r-agent-orchestration.md");
const IMPLEMENTER_FILE = join(AGENTS_DIR, "hatch3r-implementer.md");
const REVIEWER_FILE = join(AGENTS_DIR, "hatch3r-reviewer.md");
const FIXER_FILE = join(AGENTS_DIR, "hatch3r-fixer.md");
const CQ_ROSTER_FILE = join(AGENTS_DIR, "shared", "cq-specialist-roster.md");

// ── CQ trigger-table single-source policy (D16-12 / D6-15 / D22-6) ─
//
// The 9-row `## Specialist Delegation` CQ trigger table was hand-copied verbatim
// into these three agent files; D22-6 extracted it to the single source
// CQ_ROSTER_REL and replaced the copies with a one-line pointer.
// checkCqTriggerTableParity() asserts the shared roster holds the rows, each
// agent points at it (or, if a copy is reintroduced, every inlined row matches
// the shared source). The bodies are read in runValidator (implBody /
// reviewBody / fixerBody); CQ_TABLE_RELS are the repo-relative labels used in
// the emitted Finding.file, in the same order the bodies are passed.
const CQ_TABLE_RELS: readonly string[] = [
  "agents/hatch3r-implementer.md",
  "agents/hatch3r-reviewer.md",
  "agents/hatch3r-fixer.md",
];
const CQ_ROSTER_REL = "agents/shared/cq-specialist-roster.md";
// The pointer each agent's `## Specialist Delegation` section uses to reference
// the single source. A bare path substring is the match key (the prose may wrap
// it in backticks); this is the same path stored in CQ_ROSTER_REL.
const CQ_ROSTER_POINTER = CQ_ROSTER_REL;

// ── Command dispatch-surface policy (F7.3-H3 rec step 4) ──────────
//
// Full-pipeline orchestrators must carry every always-mode + evaluate-mode +
// mandatory-on-match specialist in their `agentPipeline` (a full-pipeline
// orchestrator must be able to dispatch a hard-mandate Tier 2/3 specialist).
// quick-change is the Tier-1 carve-out:
// `commands/hatch3r-quick-change.md` documents that it "intentionally skips"
// docs-writer (an evaluate-mode specialist), so it is held only to the
// always-mode floor.
const FULL_PIPELINE_COMMANDS: readonly string[] = [
  "hatch3r-workflow.md",
  "hatch3r-revision.md",
  "hatch3r-board-pickup.md",
  // 2.2.0: pr-resolve dispatches the full Tier 2/3 surface (review loop +
  // mandatory-on-match ui/ux at stage 7c), so it is held to the same
  // always + evaluate + mandatory-on-match floor as the other three.
  "hatch3r-pr-resolve.md",
];
const ALWAYS_FLOOR_COMMANDS: readonly string[] = ["hatch3r-quick-change.md"];

// ── Watchdog-coverage policy (D8-12) ──────────────────────────────
//
// D8-12 (Cycle 11 D8, Medium): watchdog-field coverage was unenforced by any
// gate, so the 14-of-29 split (only some dispatched agents declared
// `wall_clock_advisory_ms`) was silently drift-prone. This gate asserts every
// SSOT Phase-4 specialist PLUS the four core 4-phase pipeline agents declares
// the watchdog directive. D8-11 documents two accepted carriers of that
// directive, so the gate accepts EITHER: a numeric `wall_clock_advisory_ms`
// frontmatter field, OR a body reference to the shared watchdog carrier
// `agents/shared/quality-specialist-frame.md` (whose "Wall-clock advisory"
// section restates the clause for the CQ specialists that inherit it). A miss
// emits a ROSTER-WATCHDOG-MISSING error, converting F1 from latent to
// CI-blocked.
const CORE_PIPELINE_AGENTS: readonly string[] = [
  "hatch3r-researcher",
  "hatch3r-implementer",
  "hatch3r-fixer",
  "hatch3r-reviewer",
];
const WATCHDOG_FRAME_REF = "quality-specialist-frame";

// ── Types ─────────────────────────────────────────────────────────

type Severity = "error" | "warning";

export interface Finding {
  level: Severity;
  code: string;
  file: string;
  message: string;
}

export interface RunOptions {
  /** Override the repo root (test injection). Defaults to the package root. */
  rootDir?: string;
}

export interface RunResult {
  findings: Finding[];
  errorCount: number;
  warningCount: number;
  /** Specialist IDs read from the SSOT constant. */
  ssotSpecialists: string[];
}

// ── SSOT extraction ───────────────────────────────────────────────

/** Specialist IDs declared in the SSOT, in declaration order. */
function ssotSpecialistIds(): string[] {
  return SPECIALIST_TRIGGER_TABLE.map((t) => t.specialist);
}

/** Specialist IDs whose mode requires presence in every full pipeline. */
function specialistIdsByMode(
  modes: ReadonlyArray<"always" | "evaluate" | "conditional" | "mandatory-on-match">,
): string[] {
  return SPECIALIST_TRIGGER_TABLE.filter((t) => modes.includes(t.mode)).map((t) => t.specialist);
}

// ── File helpers ──────────────────────────────────────────────────

async function readFileSafe(absPath: string): Promise<string | null> {
  try {
    return await readFile(absPath, "utf-8");
    // reason: a missing file is the diagnostic — the caller turns `null` into a
    // specific ROSTER-*-MISSING Finding, which IS the channel emission (P5).
  } catch { // eslint-disable-line silent-failure/no-silent-catch
    return null;
  }
}

async function fileExists(absPath: string): Promise<boolean> {
  try {
    await access(absPath);
    return true;
    // reason: access() throws when the path is absent; the caller emits the
    // precise ROSTER-AGENT-FILE Finding from this boolean (P5 channel).
  } catch { // eslint-disable-line silent-failure/no-silent-catch
    return false;
  }
}

// ── Rule table parsing (rec step 2) ───────────────────────────────

/**
 * Extract specialist IDs from the "Phase 4 Specialist Trigger Table" markdown
 * table in the orchestration rule. The table rows are pipe-delimited and the
 * specialist id is the first cell, wrapped in backticks, e.g.
 *   | `hatch3r-testability` | Always | ... |
 * A trailing `(CQ5)`-style annotation after the backtick is tolerated.
 */
function extractRuleTableSpecialists(ruleBody: string): Set<string> {
  const ids = new Set<string>();
  const lines = ruleBody.split(/\r?\n/);
  let inTable = false;
  for (const line of lines) {
    if (/Phase 4 Specialist Trigger Table/.test(line)) {
      inTable = true;
      continue;
    }
    if (!inTable) continue;
    const trimmed = line.trim();
    // The table ends at the first non-table line after it begins.
    if (inTable && trimmed.length > 0 && !trimmed.startsWith("|")) {
      // Allow the header separator and header row to precede data rows; only
      // stop once we have already collected at least one id (i.e. past the
      // table body) OR we encounter prose. Collecting ids is idempotent, so a
      // simple "stop on first non-pipe line after entering" is safe because the
      // table is contiguous.
      if (ids.size > 0) break;
      // A non-pipe line before any id means the heading was followed by a blank
      // line / prose; keep scanning until the pipe rows start.
      continue;
    }
    const m = trimmed.match(/^\|\s*`(hatch3r-[a-z0-9-]+)`/);
    if (m) ids.add(m[1]);
  }
  return ids;
}

/**
 * Extract specialist trigger-mode pairs from the rule table. Each row carries
 * the specialist id in column 1 and the trigger mode (Always/Evaluate/
 * Conditional/Mandatory-on-match) in column 2. Used by checkRuleTriggerModes() to assert mode
 * parity with the SSOT — a row that flips a specialist from "Conditional" to
 * "Always" in the rule without the corresponding SSOT change is a Phase 4
 * Specialist Trigger Table parity violation (Finding D7-M7 / D7-SA7.3-1).
 */
function extractRuleTableTriggerModes(ruleBody: string): Map<string, string> {
  const modes = new Map<string, string>();
  const lines = ruleBody.split(/\r?\n/);
  let inTable = false;
  for (const line of lines) {
    if (/Phase 4 Specialist Trigger Table/.test(line)) {
      inTable = true;
      continue;
    }
    if (!inTable) continue;
    const trimmed = line.trim();
    if (inTable && trimmed.length > 0 && !trimmed.startsWith("|")) {
      if (modes.size > 0) break;
      continue;
    }
    const m = trimmed.match(
      /^\|\s*`(hatch3r-[a-z0-9-]+)`[^|]*\|\s*(Always|Evaluate|Conditional|Mandatory-on-match)\s*\|/i,
    );
    if (m) modes.set(m[1], m[2].toLowerCase());
  }
  return modes;
}

// ── Agent-file enumeration parsing (rec step 3) ───────────────────

/**
 * True when `body` names `id` as a backticked token. Used for the
 * implementer/reviewer Phase 4 enumeration check — both files list specialists
 * as `` `hatch3r-<id>` `` inside their "Phase 4 specialist enumeration"
 * section. We scan the whole file body (the enumeration is the only place a
 * specialist id appears in a backtick in these files, and a stray mention only
 * makes the check more lenient, never falsely failing).
 */
function bodyNamesSpecialist(body: string, id: string): boolean {
  // Word-boundary-safe: a backticked exact token. Escape the id for regex.
  const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp("`" + escaped + "`").test(body);
}

// ── Command frontmatter parsing (rec step 4) ──────────────────────

function splitFrontmatter(raw: string): {
  frontmatter: Record<string, unknown>;
  fmParseFailed: boolean;
} {
  if (!raw.startsWith("---\n") && !raw.startsWith("---\r\n")) {
    return { frontmatter: {}, fmParseFailed: false };
  }
  const afterOpen = raw.indexOf("\n", 3) + 1;
  if (afterOpen <= 0) return { frontmatter: {}, fmParseFailed: true };
  const closeIdx = raw.indexOf("\n---", afterOpen - 1);
  if (closeIdx === -1) return { frontmatter: {}, fmParseFailed: true };
  const fmRaw = raw.slice(afterOpen, closeIdx);
  let frontmatter: Record<string, unknown> = {};
  let fmParseFailed = false;
  try {
    const parsed = parseYaml(fmRaw);
    if (parsed && typeof parsed === "object") frontmatter = parsed as Record<string, unknown>;
  } catch {
    fmParseFailed = true;
  }
  return { frontmatter, fmParseFailed };
}

function agentPipelineIds(fm: Record<string, unknown>): Set<string> {
  const v = fm.agentPipeline;
  const out = new Set<string>();
  if (Array.isArray(v)) {
    for (const entry of v) {
      if (typeof entry === "string") out.add(entry.trim());
    }
  }
  return out;
}

// ── Core checks ───────────────────────────────────────────────────

function checkRuleTable(ruleBody: string | null, ssot: string[]): Finding[] {
  const out: Finding[] = [];
  if (ruleBody === null) {
    out.push({
      level: "error",
      code: "ROSTER-RULE-MISSING",
      file: "rules/hatch3r-agent-orchestration.md",
      message: "orchestration rule file not found; cannot verify Phase 4 Specialist Trigger Table",
    });
    return out;
  }
  const tableIds = extractRuleTableSpecialists(ruleBody);
  const ssotSet = new Set(ssot);

  for (const id of ssot) {
    if (!tableIds.has(id)) {
      out.push({
        level: "error",
        code: "ROSTER-RULE-MISSING",
        file: "rules/hatch3r-agent-orchestration.md",
        message: `SSOT specialist \`${id}\` is missing from the Phase 4 Specialist Trigger Table (add the row, or remove it from SPECIALIST_TRIGGER_TABLE)`,
      });
    }
  }
  for (const id of tableIds) {
    if (!ssotSet.has(id)) {
      out.push({
        level: "error",
        code: "ROSTER-RULE-EXTRA",
        file: "rules/hatch3r-agent-orchestration.md",
        message: `Phase 4 Specialist Trigger Table lists \`${id}\` which is not in SPECIALIST_TRIGGER_TABLE (the SSOT in src/pipeline/pipelineContext.ts)`,
      });
    }
  }
  return out;
}

/**
 * Assert trigger-mode parity between the SSOT and the rule table.
 *
 * Finding D7-M7 / D7-SA7.3-1: SPECIALIST_TRIGGER_TABLE is duplicated across
 * TS+rule+3 commands; the prior validator covered id-set parity but not
 * mode parity. A row that flips a specialist from `Conditional` in the SSOT
 * to `Always` in the rule body (or vice versa) is a parity drift this check
 * catches before merge.
 */
function checkRuleTriggerModes(ruleBody: string | null): Finding[] {
  const out: Finding[] = [];
  if (ruleBody === null) return out;
  const ruleModes = extractRuleTableTriggerModes(ruleBody);
  const ssotModes = new Map(
    SPECIALIST_TRIGGER_TABLE.map((t) => [t.specialist, t.mode]),
  );
  for (const [id, ssotMode] of ssotModes) {
    const ruleMode = ruleModes.get(id);
    if (ruleMode && ruleMode !== ssotMode) {
      out.push({
        level: "error",
        code: "ROSTER-RULE-MODE-MISMATCH",
        file: "rules/hatch3r-agent-orchestration.md",
        message: `specialist \`${id}\` trigger mode is "${ssotMode}" in SSOT but "${ruleMode}" in Phase 4 Specialist Trigger Table — update one to match the other (D7-M7 / D7-SA7.3-1)`,
      });
    }
  }
  return out;
}

async function checkAgentFiles(ssot: string[], agentsDir: string): Promise<Finding[]> {
  const out: Finding[] = [];
  for (const id of ssot) {
    const agentPath = join(agentsDir, `${id}.md`);
    if (!(await fileExists(agentPath))) {
      out.push({
        level: "error",
        code: "ROSTER-AGENT-FILE",
        file: `agents/${id}.md`,
        message: `SSOT specialist \`${id}\` has no agent file at agents/${id}.md (Agent Roster gap per F7.3-H3 rec step 3)`,
      });
    }
  }
  return out;
}

function checkAgentEnumeration(
  body: string | null,
  ssot: string[],
  relPath: string,
  code: "ROSTER-IMPL-MISSING" | "ROSTER-REVIEW-MISSING",
): Finding[] {
  const out: Finding[] = [];
  if (body === null) {
    out.push({
      level: "error",
      code,
      file: relPath,
      message: `${relPath} not found; cannot verify its Phase 4 specialist enumeration`,
    });
    return out;
  }
  for (const id of ssot) {
    if (!bodyNamesSpecialist(body, id)) {
      out.push({
        level: "error",
        code,
        file: relPath,
        message: `SSOT specialist \`${id}\` is not named in ${relPath}'s Phase 4 specialist enumeration`,
      });
    }
  }
  return out;
}

async function checkCommands(commandsDir: string): Promise<Finding[]> {
  const out: Finding[] = [];
  const alwaysIds = specialistIdsByMode(["always"]);
  // Full-pipeline orchestrators must be able to dispatch every hard-mandate
  // specialist: always + evaluate + mandatory-on-match (2.2.0 — a triggered
  // mandatory-on-match specialist is a non-skippable Tier 2/3 spawn).
  const fullPipelineRequiredIds = specialistIdsByMode([
    "always",
    "evaluate",
    "mandatory-on-match",
  ]);

  const targets: { file: string; required: string[] }[] = [
    ...FULL_PIPELINE_COMMANDS.map((file) => ({ file, required: fullPipelineRequiredIds })),
    ...ALWAYS_FLOOR_COMMANDS.map((file) => ({ file, required: alwaysIds })),
  ];

  for (const { file, required } of targets) {
    const absPath = join(commandsDir, file);
    const raw = await readFileSafe(absPath);
    if (raw === null) {
      out.push({
        level: "error",
        code: "ROSTER-CMD-MISSING",
        file: `commands/${file}`,
        message: `command file commands/${file} not found; cannot verify its agentPipeline includes the required specialists`,
      });
      continue;
    }
    const { frontmatter, fmParseFailed } = splitFrontmatter(raw);
    if (fmParseFailed) {
      out.push({
        level: "warning",
        code: "ROSTER-CMD-FM-PARSE",
        file: `commands/${file}`,
        message: "frontmatter YAML parse failed; skipping agentPipeline specialist check for this command",
      });
      continue;
    }
    const pipeline = agentPipelineIds(frontmatter);
    for (const id of required) {
      if (!pipeline.has(id)) {
        out.push({
          level: "error",
          code: "ROSTER-CMD-MISSING",
          file: `commands/${file}`,
          message: `agentPipeline is missing required specialist \`${id}\` (always/evaluate/mandatory-on-match-mode specialists must appear in full-pipeline orchestrators — a full-pipeline orchestrator must be able to dispatch a hard-mandate Tier 2/3 specialist — per F7.3-H3 rec step 4)`,
        });
      }
    }
  }
  return out;
}

// ── Watchdog-coverage check (D8-12) ───────────────────────────────

/** True when the agent body declares the watchdog directive via either carrier. */
function hasWatchdogDirective(raw: string): boolean {
  // Carrier 1: a numeric `wall_clock_advisory_ms` frontmatter field.
  if (/^\s*wall_clock_advisory_ms\s*:\s*\d+\s*$/m.test(raw)) return true;
  // Carrier 2: a body reference to the shared watchdog frame (D8-11).
  if (raw.includes(WATCHDOG_FRAME_REF)) return true;
  return false;
}

/**
 * D8-12: assert every SSOT specialist + the four core pipeline agents declares
 * the watchdog directive (frontmatter field OR shared-frame reference). Emits
 * one ROSTER-WATCHDOG-MISSING error per offending agent id.
 */
async function checkWatchdogCoverage(agentsDir: string, ssot: string[]): Promise<Finding[]> {
  const out: Finding[] = [];
  const required = [...new Set([...ssot, ...CORE_PIPELINE_AGENTS])].sort();
  for (const id of required) {
    const raw = await readFileSafe(join(agentsDir, `${id}.md`));
    if (raw === null) {
      // A missing core agent file is the diagnostic; specialist files absent
      // from disk are already reported by checkAgentFiles, so scope this error
      // to the core pipeline agents to avoid double-reporting.
      if (CORE_PIPELINE_AGENTS.includes(id)) {
        out.push({
          level: "error",
          code: "ROSTER-WATCHDOG-MISSING",
          file: `agents/${id}.md`,
          message: `core pipeline agent file agents/${id}.md not found; cannot verify watchdog coverage (D8-12)`,
        });
      }
      continue;
    }
    if (!hasWatchdogDirective(raw)) {
      out.push({
        level: "error",
        code: "ROSTER-WATCHDOG-MISSING",
        file: `agents/${id}.md`,
        message: `agents/${id}.md declares no watchdog directive — add a numeric \`wall_clock_advisory_ms\` frontmatter field OR reference agents/shared/quality-specialist-frame.md in the body so a dispatched agent cannot exhaust its phase budget without an advisory (D8-12)`,
      });
    }
  }
  return out;
}

// ── Reverse phase_4_trigger coverage (D22-SA22.1-01) ──────────────
//
// The forward checks above assert every SSOT specialist is represented on each
// dispatch surface. They cannot catch the REVERSE drift: an agent whose
// frontmatter carries a `phase_4_trigger:` key — the shape the 9 CQ specialists
// use to declare SPECIALIST_TRIGGER_TABLE membership — while ABSENT from that
// table, a false "specialist" signal a reader infers from the frontmatter key.
//
// D22-SA22.1-01 found exactly one such agent: hatch3r-edge-case-analyst, which
// governance classifies as a CQ4+CQ5 *supporting* analyst, NOT a table
// specialist (agents/hatch3r-reviewer.md — "MAY delegate ... not a CQ floor
// specialist"; rules/hatch3r-agent-orchestration.md — "add a specialist [to the
// table] first, never here"). Its permanent disambiguation — (a) add it to the
// table as a 14th conditional row, or (b) give its trigger a distinct key — is a
// dispatch-classification decision that changes a shipped agent, routed to the
// orchestration owner via a B1 clarification; it is NOT decided by this gate.
// Until that decision lands, this one agent is an explicit, documented exemption
// so the reverse check stays green while still CI-blocking any FUTURE agent that
// adds phase_4_trigger without joining the table. When the B1 lands: option (a)
// makes the entry redundant (edge-case-analyst joins the SSOT); option (b)
// removes the key (the agent no longer carries phase_4_trigger) — either way the
// entry becomes dead and is deleted.
const SUPPORTING_ANALYST_PHASE4_ALLOWLIST: readonly string[] = ["hatch3r-edge-case-analyst"];

/**
 * D22-SA22.1-01: assert every agent whose frontmatter carries a top-level
 * `phase_4_trigger:` key is either a SPECIALIST_TRIGGER_TABLE member or a
 * documented supporting-analyst exemption. Reads every `agents/hatch3r-*.md`
 * file, parses its frontmatter, and emits one ROSTER-PHASE4-EXTRA error per
 * agent that signals table membership via the key while absent from both sets —
 * the drift the forward SSOT-driven checks are structurally blind to.
 */
export async function checkPhase4TriggerReverse(
  agentsDir: string,
  ssot: string[],
): Promise<Finding[]> {
  const out: Finding[] = [];
  // A missing agents/ dir is already reported by checkAgentFiles (every SSOT
  // file turns up absent); skip here to avoid double-reporting the same cause.
  if (!(await fileExists(agentsDir))) return out;
  const allowed = new Set<string>([...ssot, ...SUPPORTING_ANALYST_PHASE4_ALLOWLIST]);
  const entries = (await readdir(agentsDir)).sort();
  for (const name of entries) {
    if (!name.startsWith("hatch3r-") || !name.endsWith(".md")) continue;
    const raw = await readFileSafe(join(agentsDir, name));
    if (raw === null) continue;
    const { frontmatter } = splitFrontmatter(raw);
    if (!Object.prototype.hasOwnProperty.call(frontmatter, "phase_4_trigger")) continue;
    const id = name.slice(0, -".md".length);
    if (!allowed.has(id)) {
      out.push({
        level: "error",
        code: "ROSTER-PHASE4-EXTRA",
        file: `agents/${name}`,
        message: `\`${id}\` carries \`phase_4_trigger\` frontmatter (the SPECIALIST_TRIGGER_TABLE membership shape) but is not in SPECIALIST_TRIGGER_TABLE (src/pipeline/pipelineContext.ts) and is not a documented supporting-analyst exemption — add it to the table, or, if it is an outside-table supporting analyst, add it to SUPPORTING_ANALYST_PHASE4_ALLOWLIST with the classification rationale (D22-SA22.1-01)`,
      });
    }
  }
  return out;
}

// ── CQ trigger-table-parity check (D16-12 / D6-15 / D22-6) ────────

/**
 * Extract the CQ specialist trigger-table rows from an agent body. Each row is
 * a pipe-delimited markdown line whose first cell is a `CQ<n>` label, e.g.
 *   | CQ3 Security | `hatch3r-security` | `src/auth/**`, ... |
 * Rows are normalized (internal whitespace collapsed, outer pipes trimmed) so
 * the comparison ignores incidental spacing but catches any substantive change
 * to the pillar label, specialist id, or trigger prose. Returns the rows in
 * file order keyed by their CQ label for a stable per-row diff.
 */
function extractCqTriggerRows(body: string): Map<string, string> {
  const rows = new Map<string, string>();
  for (const line of body.split(/\r?\n/)) {
    const trimmed = line.trim();
    const m = trimmed.match(/^\|\s*(CQ\d)\b/);
    if (!m) continue;
    const normalized = trimmed.replace(/\s+/g, " ");
    rows.set(m[1], normalized);
  }
  return rows;
}

/**
 * Assert the CQ specialist trigger table has a single source (D22-6): the shared
 * roster `agents/shared/cq-specialist-roster.md` holds the 9 CQ rows, and each
 * of the three consumer agents (implementer / reviewer / fixer) points at that
 * roster rather than re-inlining the table. The single source removes the
 * former three-way drift; this gate keeps it intact and catches a regression
 * that copies the table back inline:
 *
 *   - shared roster has 0 CQ rows  → ROSTER-CQ-TABLE-DRIFT (table-loss guard)
 *   - an agent neither points at the roster nor inlines CQ rows
 *                                  → ROSTER-CQ-TABLE-DRIFT (the delegation
 *                                    section lost its roster reference)
 *   - an agent re-inlines a CQ row that diverges from the shared source
 *                                  → ROSTER-CQ-TABLE-DRIFT (per-row drift)
 *
 * Emits one ROSTER-CQ-TABLE-DRIFT error per offending file/row.
 */
function checkCqTriggerTableParity(
  rosterBody: string | null,
  copies: { rel: string; body: string | null }[],
): Finding[] {
  const out: Finding[] = [];

  // (a) The shared roster is the reference. A missing file or an empty table is
  // a table-loss the single-source model cannot tolerate.
  const rosterRows = rosterBody === null ? new Map<string, string>() : extractCqTriggerRows(rosterBody);
  if (rosterBody === null) {
    out.push({
      level: "error",
      code: "ROSTER-CQ-TABLE-DRIFT",
      file: CQ_ROSTER_REL,
      message: `the shared CQ specialist roster ${CQ_ROSTER_REL} is missing — it is the single source of the 9-row CQ trigger table that implementer/reviewer/fixer point at; restore it (D22-6)`,
    });
    return out;
  }
  if (rosterRows.size === 0) {
    out.push({
      level: "error",
      code: "ROSTER-CQ-TABLE-DRIFT",
      file: CQ_ROSTER_REL,
      message: `the shared CQ specialist roster ${CQ_ROSTER_REL} has no CQ rows (\`| CQ<n> | ... |\`) — the single-source table was emptied or renamed; restore the 9 rows (D22-6)`,
    });
    return out;
  }

  // (b)/(c) Each consumer agent must either point at the shared roster or, if it
  // reintroduces an inline copy, match the shared source row-for-row.
  for (const c of copies) {
    if (c.body === null) continue; // missing agent files are reported elsewhere
    const rows = extractCqTriggerRows(c.body);
    const pointsAtRoster = c.body.includes(CQ_ROSTER_POINTER);
    if (rows.size === 0) {
      if (!pointsAtRoster) {
        out.push({
          level: "error",
          code: "ROSTER-CQ-TABLE-DRIFT",
          file: c.rel,
          message: `${c.rel} neither inlines the CQ specialist trigger table nor points at the single source ${CQ_ROSTER_REL} — its \`## Specialist Delegation\` section lost the roster reference; add the pointer (D22-6)`,
        });
      }
      continue; // pointer-only consumer: nothing more to diff
    }
    // A reintroduced inline copy: every row it carries must match the source.
    for (const [label, row] of rows) {
      const refRow = rosterRows.get(label);
      if (refRow === row) continue;
      out.push({
        level: "error",
        code: "ROSTER-CQ-TABLE-DRIFT",
        file: c.rel,
        message:
          refRow === undefined
            ? `${c.rel} re-inlines CQ row \`${label}\` which does not exist in the single source ${CQ_ROSTER_REL} — remove the inline copy and point at the roster, or reconcile the source (D22-6)`
            : `${c.rel} re-inlines CQ row \`${label}\` which diverges from the single source ${CQ_ROSTER_REL} — remove the inline copy and point at the roster, or reconcile the source (D22-6)`,
      });
    }
  }
  return out;
}

// ── Orchestrator ──────────────────────────────────────────────────

export async function runValidator(opts: RunOptions = {}): Promise<RunResult> {
  const root = opts.rootDir ?? ROOT;
  const agentsDir = join(root, "agents");
  const commandsDir = join(root, "commands");
  const ruleFile =
    root === ROOT ? RULE_FILE : join(root, "rules", "hatch3r-agent-orchestration.md");
  const implementerFile = root === ROOT ? IMPLEMENTER_FILE : join(agentsDir, "hatch3r-implementer.md");
  const reviewerFile = root === ROOT ? REVIEWER_FILE : join(agentsDir, "hatch3r-reviewer.md");
  const fixerFile = root === ROOT ? FIXER_FILE : join(agentsDir, "hatch3r-fixer.md");
  const cqRosterFile = root === ROOT ? CQ_ROSTER_FILE : join(agentsDir, "shared", "cq-specialist-roster.md");

  const ssot = ssotSpecialistIds();

  const [ruleBody, implBody, reviewBody, fixerBody, cqRosterBody] = await Promise.all([
    readFileSafe(ruleFile),
    readFileSafe(implementerFile),
    readFileSafe(reviewerFile),
    readFileSafe(fixerFile),
    readFileSafe(cqRosterFile),
  ]);

  const findings: Finding[] = [];
  findings.push(...checkRuleTable(ruleBody, ssot));
  findings.push(...checkRuleTriggerModes(ruleBody));
  findings.push(...(await checkAgentFiles(ssot, agentsDir)));
  findings.push(
    ...checkAgentEnumeration(implBody, ssot, "agents/hatch3r-implementer.md", "ROSTER-IMPL-MISSING"),
  );
  findings.push(
    ...checkAgentEnumeration(reviewBody, ssot, "agents/hatch3r-reviewer.md", "ROSTER-REVIEW-MISSING"),
  );
  findings.push(...(await checkCommands(commandsDir)));
  findings.push(...(await checkWatchdogCoverage(agentsDir, ssot)));
  findings.push(...(await checkPhase4TriggerReverse(agentsDir, ssot)));
  findings.push(
    ...checkCqTriggerTableParity(cqRosterBody, [
      { rel: CQ_TABLE_RELS[0], body: implBody },
      { rel: CQ_TABLE_RELS[1], body: reviewBody },
      { rel: CQ_TABLE_RELS[2], body: fixerBody },
    ]),
  );

  let errorCount = 0;
  let warningCount = 0;
  for (const f of findings) {
    if (f.level === "error") errorCount += 1;
    else warningCount += 1;
  }
  return { findings, errorCount, warningCount, ssotSpecialists: ssot };
}

// ── Output ────────────────────────────────────────────────────────

export function formatFinding(f: Finding): string {
  const tag = f.level === "error" ? "ERROR" : "WARN ";
  return `[${tag} ${f.code}] ${f.file}: ${f.message}`;
}

interface CliFlags {
  json: boolean;
  /** Scan root override (`--root <dir>`); defaults to the package root. Used by
   * the gate test to point the validator at a synthetic fixture tree. */
  rootDir?: string;
}

function parseArgs(argv: readonly string[]): CliFlags {
  const flags: CliFlags = { json: argv.includes("--json") };
  const rootIdx = argv.indexOf("--root");
  const rootVal = rootIdx === -1 ? undefined : argv[rootIdx + 1];
  if (rootVal) flags.rootDir = rootVal;
  return flags;
}

async function main(): Promise<void> {
  const flags = parseArgs(process.argv.slice(2));
  const result = await runValidator(flags.rootDir ? { rootDir: resolve(flags.rootDir) } : {});
  if (flags.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    for (const f of result.findings) {
      const line = formatFinding(f);
      if (f.level === "error") console.error(line);
      else console.warn(line);
    }
    console.log(
      `validate-specialist-roster: ${result.ssotSpecialists.length} SSOT specialist(s) checked across rule table + agent roster + implementer/reviewer enumerations + command pipelines + CQ trigger-table single-source (shared roster + implementer/reviewer/fixer pointers) + reverse phase_4_trigger coverage; ${result.errorCount} error(s), ${result.warningCount} warning(s)`,
    );
  }
  if (result.errorCount > 0) process.exit(1);
}

// Only auto-run when executed as a script, never when imported by tests.
const isMain = (() => {
  try {
    return resolve(process.argv[1] ?? "") === __filename;
    // reason: process.argv[1] unresolvable (e.g. some test runners) — treating
    // as imported (return false) is the safe default; no error to channel (P5).
  } catch { // eslint-disable-line silent-failure/no-silent-catch
    return false;
  }
})();

if (isMain) {
  main().catch((err) => {
    console.error("validate-specialist-roster failed:", err);
    process.exit(1);
  });
}
