#!/usr/bin/env node
/**
 * scripts/validate-fanout-emission.ts — Pillar P8 (Clarification &
 * Fan-out Discipline), P5 (Governance Self-Quality).
 *
 * Enforces the two delegating-artifact classes that `rules/
 * hatch3r-fan-out-discipline.md` → Scope binds with a machine-checkable
 * frontmatter or body marker:
 *
 *   1. COMMANDS — every top-level `commands/hatch3r-*.md` whose
 *      frontmatter declares `orchestrator: true` MUST carry the canonical
 *      P8 B2 first-class output field as a STATIC frontmatter key (a
 *      command's fan-out is fixed by its `agentPipeline`, so the count is
 *      known at config time):
 *
 *        sub_agents_spawned:
 *          count: <positive integer>
 *          rationale: <non-empty string>
 *
 *   2. SKILLS — every `SKILL.md` under `skills/hatch3r-<name>` whose
 *      body carries a Tier-2/3 Task-tool delegation contract MUST carry
 *      the canonical
 *      RUNTIME-emission directive in its body. A skill's fan-out count is
 *      task-derived (Tier 1 inline / Tier 2 per-concern / Tier 3
 *      per-module), so a static frontmatter integer would misstate it;
 *      the skill instead instructs its runtime sub-agent to emit the
 *      field, matching the 34 skills that already carry the directive:
 *
 *        Emit `sub_agents_spawned: { count, rationale }` in your output.
 *
 *      A skill that declares `Tier 1 reference card` (the rule's
 *      documented opt-out: "Tier 1 reference-card skills that neither
 *      spawn sub-agents nor mutate files carry no fan-out obligation")
 *      is exempt even if a delegation phrase appears elsewhere in prose.
 *
 * The third class the rule names — delegating `agents/hatch3r-*.md` — is
 * prose-bound (inherited through `rules/hatch3r-agent-orchestration.md`),
 * not scanned here: agents carry no `orchestrator` frontmatter marker and
 * the Task-mention agents (creator/fixer/implementer/reviewer) are worker
 * leaves whose bodies say the PARENT orchestrator delegates, so a
 * body-grep agent trigger would be a false-positive surface. See the rule
 * Scope section for the enforcement split.
 *
 * Per `governance/CONSTITUTION.md` §2 P8 B2 directive:
 *
 *   > Sub-agent fan-out scales with task size; serialization is only
 *   > valid on dependency edges. Token cost is never a valid reason to
 *   > serialize independent work. Delegating artifacts emit sub-agent
 *   > count + rationale as a first-class output field.
 *
 * Failure modes (each emits one ERROR finding):
 *
 *   P8-FANOUT-MISS        `sub_agents_spawned` field missing from command
 *                         frontmatter
 *   P8-FANOUT-SHAPE       command `sub_agents_spawned` is not an object
 *                         with `count` + `rationale` keys (e.g., array
 *                         shape, scalar, null)
 *   P8-FANOUT-COUNT       command `count` is not a positive integer
 *   P8-FANOUT-RATIO       command `rationale` is missing or not a
 *                         non-empty string
 *   P8-FANOUT-SKILL-MISS  a delegating, non-exempt skill body omits the
 *                         runtime-emission directive
 *
 * The audit-cycle prompts (`commands/hatch3r-audit-cycle*.md`) are hard
 * exempt — they run framework-owner dialogs whose fan-out is described
 * narratively, mirroring the exemption in
 * `scripts/validate-efficiency-invariants.ts`.
 *
 * Pillars: P8 (Clarification & Fan-out Discipline), P5 (Governance
 * Self-Quality).
 *
 * Usage: `npm run validate:efficiency`
 *        `tsx scripts/validate-fanout-emission.ts`
 *        `tsx scripts/validate-fanout-emission.ts --json`
 */
import { readdir, readFile } from "node:fs/promises";
import { dirname, join, posix, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = resolve(__dirname, "..");
const COMMANDS_DIR = join(ROOT, "commands");
const SKILLS_DIR = join(ROOT, "skills");

// ── Audit-cycle exempt list (hard-coded) ──────────────────────────
//
// Mirrors `scripts/validate-efficiency-invariants.ts`: audit-cycle
// orchestrator files describe fan-out narratively in their bodies (and
// in `governance/AUDIT-EXECUTE.md`'s `sub_agents_spawned` blocks),
// not in the command frontmatter, so this validator does not require
// the field on those files.
const AUDIT_EXEMPT_GLOBS: readonly string[] = [
  "commands/hatch3r-audit-cycle*.md",
];

// ── Types ─────────────────────────────────────────────────────────

type Severity = "error" | "warning";

export interface Finding {
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
  /** Raw file body (everything after the frontmatter close). */
  body: string;
}

export interface RunOptions {
  commandsDir?: string;
  /** Skills root (`skills/`); test fixtures inject a tmpdir. */
  skillsDir?: string;
}

export interface RunResult {
  findings: Finding[];
  errorCount: number;
  warningCount: number;
  /** Orchestrator commands checked for the static frontmatter field. */
  checkedFiles: number;
  /** Delegating skills checked for the runtime-emission directive. */
  checkedSkills: number;
}

// ── Path / exempt-list helpers ────────────────────────────────────

function toPosixRel(absPath: string, baseDir: string): string {
  return relative(baseDir, absPath).split(sep).join(posix.sep);
}

// Single supported glob shape: `prefix*suffix`.
function matchesExemptGlob(relPath: string, glob: string): boolean {
  const i = glob.indexOf("*");
  if (i === -1) return relPath === glob;
  return relPath.startsWith(glob.slice(0, i)) && relPath.endsWith(glob.slice(i + 1));
}

function isAuditExempt(relPath: string): boolean {
  return AUDIT_EXEMPT_GLOBS.some((g) => matchesExemptGlob(relPath, g));
}

// ── Frontmatter parsing ───────────────────────────────────────────

function splitFrontmatter(raw: string): {
  frontmatter: Record<string, unknown>;
  fmParseFailed: boolean;
  body: string;
} {
  if (!raw.startsWith("---\n") && !raw.startsWith("---\r\n")) {
    return { frontmatter: {}, fmParseFailed: false, body: raw };
  }
  const afterOpen = raw.indexOf("\n", 3) + 1;
  if (afterOpen <= 0) return { frontmatter: {}, fmParseFailed: true, body: raw };
  const closeIdx = raw.indexOf("\n---", afterOpen - 1);
  if (closeIdx === -1) return { frontmatter: {}, fmParseFailed: true, body: raw };
  const fmRaw = raw.slice(afterOpen, closeIdx);
  const body = raw.slice(closeIdx + "\n---".length);
  let frontmatter: Record<string, unknown> = {};
  let fmParseFailed = false;
  try {
    const parsed = parseYaml(fmRaw);
    if (parsed && typeof parsed === "object") frontmatter = parsed as Record<string, unknown>;
  } catch {
    fmParseFailed = true;
  }
  return { frontmatter, fmParseFailed, body };
}

// ── Discovery ─────────────────────────────────────────────────────

async function listOrchestratorCandidates(dir: string): Promise<string[]> {
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

// Each canonical skill lives at `skills/hatch3r-<name>/SKILL.md`; mirrors
// the directory-walk in `scripts/validate-efficiency-invariants.ts` (Mode I).
async function listSkillCandidates(dir: string): Promise<string[]> {
  let entries: string[];
  try {
    entries = await readdir(dir, { withFileTypes: true } as never);
  } catch {
    return [];
  }
  return (entries as unknown as { name: string; isDirectory(): boolean }[])
    .filter((e) => e.isDirectory() && e.name.startsWith("hatch3r-"))
    .map((e) => e.name)
    .sort((a, b) => a.localeCompare(b))
    .map((name) => join(dir, name, "SKILL.md"));
}

async function loadFile(absPath: string, baseDir: string): Promise<ParsedFile> {
  const raw = await readFile(absPath, "utf-8");
  const split = splitFrontmatter(raw);
  return { absPath, relPath: toPosixRel(absPath, baseDir), ...split };
}

// ── Frontmatter helpers ───────────────────────────────────────────

const isOrchestrator = (fm: Record<string, unknown>): boolean => fm.orchestrator === true;

interface FanoutShape {
  count: unknown;
  rationale: unknown;
}

function getFanout(fm: Record<string, unknown>): FanoutShape | "missing" | "wrong-shape" {
  const v = fm.sub_agents_spawned;
  if (v === undefined || v === null) return "missing";
  if (typeof v !== "object" || Array.isArray(v)) return "wrong-shape";
  const obj = v as Record<string, unknown>;
  if (!("count" in obj) || !("rationale" in obj)) return "wrong-shape";
  return { count: obj.count, rationale: obj.rationale };
}

// ── Core check ────────────────────────────────────────────────────

function checkFanoutEmission(file: ParsedFile): Finding[] {
  if (!isOrchestrator(file.frontmatter)) return [];
  const out: Finding[] = [];
  const shape = getFanout(file.frontmatter);

  if (shape === "missing") {
    out.push({
      level: "error",
      code: "P8-FANOUT-MISS",
      file: file.relPath,
      message:
        "missing `sub_agents_spawned: {count, rationale}` in frontmatter (P8 B2 first-class output field)",
    });
    return out;
  }
  if (shape === "wrong-shape") {
    out.push({
      level: "error",
      code: "P8-FANOUT-SHAPE",
      file: file.relPath,
      message:
        "`sub_agents_spawned` must be an object with `count` and `rationale` keys (P8 B2 schema)",
    });
    return out;
  }

  const countOk =
    typeof shape.count === "number" &&
    Number.isInteger(shape.count) &&
    (shape.count as number) >= 1;
  if (!countOk) {
    out.push({
      level: "error",
      code: "P8-FANOUT-COUNT",
      file: file.relPath,
      message: `\`sub_agents_spawned.count\` must be a positive integer, got ${JSON.stringify(shape.count)}`,
    });
  }

  const rationaleOk = typeof shape.rationale === "string" && shape.rationale.trim().length > 0;
  if (!rationaleOk) {
    out.push({
      level: "error",
      code: "P8-FANOUT-RATIO",
      file: file.relPath,
      message: "`sub_agents_spawned.rationale` must be a non-empty string",
    });
  }
  return out;
}

// ── Skill body markers ────────────────────────────────────────────
//
// A skill's fan-out count is task-derived (Tier 1 inline / Tier 2
// per-concern / Tier 3 per-module), so its P8 B2 obligation is a
// RUNTIME-emission directive in the body — not a static frontmatter
// integer. Three regexes model the skill contract, all matched against
// the raw body.

// Trigger: a Tier-2/3 Task-tool delegation contract. Covers both the
// hard form ("You MUST spawn these agents via the Task tool") and the
// tiered form ("spawn parallel/one sub-agent(s) ... via the Task tool").
const SKILL_DELEGATION_TRIGGER =
  /spawn\b[^.\n]*?\bsub-agents?\b[^.\n]*?\bvia the Task tool\b|You MUST spawn these agents via the Task tool/i;

// Exemption: the rule's documented Tier-1 reference-card opt-out
// ("Tier 1 reference-card skills that neither spawn sub-agents nor
// mutate files carry no fan-out obligation").
const SKILL_TIER1_EXEMPTION = /Tier 1 reference card/i;

// Required directive when triggered and not exempt: the canonical
// runtime-emission instruction. `count`/`rationale` may sit on one line
// or be wrapped, so the keys are matched independently of layout.
const SKILL_EMISSION_DIRECTIVE = /Emit\s+`sub_agents_spawned:\s*\{\s*count,\s*rationale\s*\}`/i;

function checkSkillEmission(file: ParsedFile): Finding[] {
  if (SKILL_TIER1_EXEMPTION.test(file.body)) return [];
  if (!SKILL_DELEGATION_TRIGGER.test(file.body)) return [];
  if (SKILL_EMISSION_DIRECTIVE.test(file.body)) return [];
  return [
    {
      level: "error",
      code: "P8-FANOUT-SKILL-MISS",
      file: file.relPath,
      message:
        "delegating skill omits the runtime-emission directive " +
        "(P8 B2): add ``Emit `sub_agents_spawned: { count, rationale }` in your output.`` " +
        "to the body, or mark the skill `Tier 1 reference card — no fan-out`",
    },
  ];
}

// A skill counts as "checked" (delegation-triggered, non-exempt) for the
// summary line. Kept in sync with `checkSkillEmission`'s gating.
function isDelegatingSkill(file: ParsedFile): boolean {
  return !SKILL_TIER1_EXEMPTION.test(file.body) && SKILL_DELEGATION_TRIGGER.test(file.body);
}

// ── Orchestrator ──────────────────────────────────────────────────

export async function runValidator(opts: RunOptions = {}): Promise<RunResult> {
  const cmdDir = opts.commandsDir ?? COMMANDS_DIR;
  const cmdBase = resolve(cmdDir, "..");

  const findings: Finding[] = [];
  const candidates = await listOrchestratorCandidates(cmdDir);
  let checkedFiles = 0;

  for (const p of candidates) {
    const f = await loadFile(p, cmdBase);
    if (isAuditExempt(f.relPath)) continue;
    if (f.fmParseFailed) {
      findings.push({
        level: "warning",
        code: "P8-FANOUT-FM-PARSE",
        file: f.relPath,
        message: "frontmatter YAML parse failed; skipping fan-out emission check for this file",
      });
      continue;
    }
    if (!isOrchestrator(f.frontmatter)) continue;
    checkedFiles += 1;
    findings.push(...checkFanoutEmission(f));
  }

  // ── Skill class: runtime-emission directive on delegating bodies ──
  const skillDir = opts.skillsDir ?? SKILLS_DIR;
  const skillBase = resolve(skillDir, "..");
  const skillCandidates = await listSkillCandidates(skillDir);
  let checkedSkills = 0;

  for (const p of skillCandidates) {
    let f: ParsedFile;
    try {
      f = await loadFile(p, skillBase);
    } catch {
      // A skill directory without a readable SKILL.md carries no fan-out
      // obligation; skipping it is the intended behavior, not a swallowed
      // fault (discovery-time best-effort, same as `listSkillCandidates`).
      // eslint-disable-next-line silent-failure/no-silent-catch
      continue;
    }
    if (!isDelegatingSkill(f)) continue;
    checkedSkills += 1;
    findings.push(...checkSkillEmission(f));
  }

  let errorCount = 0;
  let warningCount = 0;
  for (const f of findings) {
    if (f.level === "error") errorCount += 1;
    else warningCount += 1;
  }
  return { findings, errorCount, warningCount, checkedFiles, checkedSkills };
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
      `validate-fanout-emission: ${result.checkedFiles} orchestrator command(s) + ` +
        `${result.checkedSkills} delegating skill(s) checked; ` +
        `${result.errorCount} error(s), ${result.warningCount} warning(s)`,
    );
  }
  if (result.errorCount > 0) process.exit(1);
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
    console.error("validate-fanout-emission failed:", err);
    process.exit(1);
  });
}
