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
 *      specialist. Conditional-mode specialists are excluded from the
 *      strict-match (a command may legitimately omit a conditional specialist).
 *      `quick-change` is exempt from the evaluate-mode (docs-writer) check — it
 *      is the documented Tier-1 carve-out that intentionally skips docs-writer
 *      (`commands/hatch3r-quick-change.md` "intentionally skips"), but is still
 *      held to the always-mode (test-writer / security-auditor) floor.
 *
 * Failure modes (each emits one ERROR finding):
 *
 *   ROSTER-RULE-MISSING    specialist in SSOT but absent from the rule table
 *   ROSTER-RULE-EXTRA      specialist in the rule table but absent from SSOT
 *   ROSTER-AGENT-FILE      SSOT specialist has no `agents/<id>.md` file
 *   ROSTER-IMPL-MISSING    SSOT specialist not named in implementer.md Phase 4
 *   ROSTER-REVIEW-MISSING  SSOT specialist not named in reviewer.md Phase 4
 *   ROSTER-CMD-MISSING     always/evaluate specialist absent from a command's
 *                          agentPipeline
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
import { readFile } from "node:fs/promises";
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

// ── Command dispatch-surface policy (F7.3-H3 rec step 4) ──────────
//
// Full-pipeline orchestrators must carry every always-mode + evaluate-mode
// specialist in their `agentPipeline`. quick-change is the Tier-1 carve-out:
// `commands/hatch3r-quick-change.md` documents that it "intentionally skips"
// docs-writer (an evaluate-mode specialist), so it is held only to the
// always-mode floor.
const FULL_PIPELINE_COMMANDS: readonly string[] = [
  "hatch3r-workflow.md",
  "hatch3r-revision.md",
  "hatch3r-board-pickup.md",
];
const ALWAYS_FLOOR_COMMANDS: readonly string[] = ["hatch3r-quick-change.md"];

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
function specialistIdsByMode(modes: ReadonlyArray<"always" | "evaluate" | "conditional">): string[] {
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
 *   | `hatch3r-test-writer` | Always | ... |
 * A trailing `(CQ1)`-style annotation after the backtick is tolerated.
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
  const alwaysAndEvaluateIds = specialistIdsByMode(["always", "evaluate"]);

  const targets: { file: string; required: string[] }[] = [
    ...FULL_PIPELINE_COMMANDS.map((file) => ({ file, required: alwaysAndEvaluateIds })),
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
          message: `agentPipeline is missing required specialist \`${id}\` (always/evaluate-mode specialists must appear in full-pipeline orchestrators per F7.3-H3 rec step 4)`,
        });
      }
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

  const ssot = ssotSpecialistIds();

  const [ruleBody, implBody, reviewBody] = await Promise.all([
    readFileSafe(ruleFile),
    readFileSafe(implementerFile),
    readFileSafe(reviewerFile),
  ]);

  const findings: Finding[] = [];
  findings.push(...checkRuleTable(ruleBody, ssot));
  findings.push(...(await checkAgentFiles(ssot, agentsDir)));
  findings.push(
    ...checkAgentEnumeration(implBody, ssot, "agents/hatch3r-implementer.md", "ROSTER-IMPL-MISSING"),
  );
  findings.push(
    ...checkAgentEnumeration(reviewBody, ssot, "agents/hatch3r-reviewer.md", "ROSTER-REVIEW-MISSING"),
  );
  findings.push(...(await checkCommands(commandsDir)));

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
      `validate-specialist-roster: ${result.ssotSpecialists.length} SSOT specialist(s) checked across rule table + agent roster + implementer/reviewer enumerations + command pipelines; ${result.errorCount} error(s), ${result.warningCount} warning(s)`,
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
