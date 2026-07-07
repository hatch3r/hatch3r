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
 *   3. MAINTAINER SKILLS — every `.claude/skills/h4tcher-<name>/SKILL.md`
 *      that delegates carries the same RUNTIME-emission obligation as the
 *      canonical skill class above. Delegation is triggered by EITHER a
 *      frontmatter `allowed-tools` grant of the literal `Task` tool OR a
 *      body `## Step N: Sub-Agent Dispatch` stage (five lifecycle presets
 *      carry the heading; `h4tcher-pr-resolve` delegates inside the
 *      canonical workflow it invokes and is caught by the `Task` grant).
 *      The audit-cycle orchestrators
 *      (`h4tcher-audit-cycle`, `h4tcher-audit-execute`, `h4tcher-evolve`)
 *      delegate through the `Agent`/`Workflow` primitives instead and
 *      describe fan-out narratively, mirroring the `AUDIT_EXEMPT_GLOBS`
 *      carve-out for `commands/hatch3r-audit-cycle*.md`; they grant no
 *      `Task` tool, so this pass leaves them untouched. The Tier-1
 *      reference-card opt-out applies identically.
 *
 * The fourth class the rule names — delegating `agents/hatch3r-*.md` — is
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
 *                         runtime-emission directive (covers both the
 *                         canonical `skills/hatch3r-*` class and the
 *                         `Task`-granting `.claude/skills/h4tcher-*`
 *                         maintainer-preset class)
 *
 * Soft consistency heuristics (each emits one WARNING — a static `count`
 * that passes the structural schema above can still misstate the fan-out;
 * these warn on the two drift shapes a positive integer cannot catch, per
 * D7-30 "near-vacuous count≥1 guarantee"):
 *
 *   P8-FANOUT-COUNT-LOW   command `count` is below the number of DISTINCT
 *                         non-specialist agents in `agentPipeline` AND the
 *                         rationale names no conditional-dispatch reason
 *                         (mutual exclusion, triage tier, batch scaling) —
 *                         a `count: 1` against a 6-wide pipeline with no
 *                         stated reason is the flagged shape. The 9 CQ
 *                         vector specialists (ui/ux/security/reliability/
 *                         testability/scalability/performance/
 *                         maintainability/enhancability) are advisory gates
 *                         excluded from the floor so a spec-only pipeline
 *                         that consults them pre-write is not penalized.
 *   P8-FANOUT-BASIS-MISS  command `rationale` names no decomposition basis
 *                         (module / concern / mode / stage / specialist-gate
 *                         / research-question count) for a multi-agent
 *                         pipeline, so a reviewer cannot check the count
 *                         against the task without re-deriving it
 *                         (`rules/hatch3r-fan-out-discipline.md` → Required
 *                         output field: "The `rationale` states the
 *                         decomposition basis ... so a reviewer can check
 *                         the count against the task without re-deriving
 *                         it"). Single-agent pipelines are exempt.
 *
 * Both heuristics are WARNINGS, not errors: they flag likely drift for
 * human review without failing the CI gate, matching the finding's "keep
 * as warnings first" remediation. The live command corpus (Cycle 11)
 * raises zero of either warning.
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
// Framework-dev maintainer presets (`/h4tcher-*`). The Task-granting subset
// dispatches parallel sub-agents and carries the same P8 B2 runtime-emission
// obligation as the canonical skill class.
const MAINTAINER_SKILLS_DIR = join(ROOT, ".claude", "skills");

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
  /** Maintainer-preset root (`.claude/skills/`); test fixtures inject a tmpdir. */
  maintainerSkillsDir?: string;
}

export interface RunResult {
  findings: Finding[];
  errorCount: number;
  warningCount: number;
  /** Orchestrator commands checked for the static frontmatter field. */
  checkedFiles: number;
  /** Delegating skills checked for the runtime-emission directive. */
  checkedSkills: number;
  /** Task-granting maintainer presets checked for the runtime-emission directive. */
  checkedMaintainerSkills: number;
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

// Each maintainer preset lives at `.claude/skills/h4tcher-<name>/SKILL.md`
// (the `h4tcher-` prefix marks the framework-dev slash surface). Same
// directory-walk shape as `listSkillCandidates`, different prefix.
async function listMaintainerSkillCandidates(dir: string): Promise<string[]> {
  let entries: string[];
  try {
    entries = await readdir(dir, { withFileTypes: true } as never);
  } catch {
    return [];
  }
  return (entries as unknown as { name: string; isDirectory(): boolean }[])
    .filter((e) => e.isDirectory() && e.name.startsWith("h4tcher-"))
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

// `agentPipeline` is a YAML list of hatch3r-* agent ids. Non-array shapes
// (absent, scalar) collapse to an empty list — the consistency heuristics
// below then no-op, since a pipeline of length ≤1 carries no count floor.
function getAgentPipeline(fm: Record<string, unknown>): string[] {
  const v = fm.agentPipeline;
  if (!Array.isArray(v)) return [];
  return v.filter((e): e is string => typeof e === "string");
}

// The 9 CQ-vector specialist agents (CONSTITUTION §2B). In every multi-vector
// command (`hatch3r-feature-plan`, `hatch3r-board-*`) these are advisory
// pre-write gates, not always-spawned workers — the orchestrator consults the
// subset a change touches. Excluding them from the count floor stops a
// spec-only pipeline (`count: 1` spec author + 9 advisory vectors) from
// tripping P8-FANOUT-COUNT-LOW. Kept in sync with the roster under
// `agents/hatch3r-{ui,…}.md` and `src/pipeline/` specialist lists.
const CQ_SPECIALIST_AGENTS: ReadonlySet<string> = new Set([
  "hatch3r-ui",
  "hatch3r-ux",
  "hatch3r-security",
  "hatch3r-reliability",
  "hatch3r-testability",
  "hatch3r-scalability",
  "hatch3r-performance",
  "hatch3r-maintainability",
  "hatch3r-enhancability",
]);

// Conditional-dispatch markers: a rationale phrase that explains why `count`
// may sit below the static pipeline width — mutual exclusion (one of N agents
// runs), triage-tier gating (Tier 1 routes out), or batch scaling (count is
// per-issue). Presence of any marker suppresses P8-FANOUT-COUNT-LOW because
// the author has documented the below-width count on purpose.
const CONDITIONAL_DISPATCH_MARKER =
  /\b(?:tier|triage|when|if|batch|per[- ]issue|per[- ]module|scales?|up to|conditional(?:ly)?|routes? out|inline|mutually exclusive|chosen between|one of|either|detection|advis(?:e|ory)|consult)\b/i;

// Decomposition-basis markers: the rationale must name WHAT the count counts
// (module / concern / mode / stage / specialist-gate / research-question
// count) so a reviewer can check it against the task without re-deriving it
// (`rules/hatch3r-fan-out-discipline.md` → Required output field). Absence on
// a multi-agent pipeline raises P8-FANOUT-BASIS-MISS.
const DECOMPOSITION_BASIS_MARKER =
  /\b(?:pipeline|module|specialist|gate|research[- ]question|researcher mode|mode|stage|per[- ]issue|review cycle|concern|phase|parallel|sub-agents?|vector|brief)\b/i;

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

  // Soft consistency heuristics run only when the structural schema above is
  // sound (valid integer count + non-empty string rationale); a malformed
  // count/rationale already errored and would make the heuristics noise.
  if (countOk && rationaleOk) {
    out.push(...checkFanoutConsistency(file, shape.count as number, shape.rationale as string));
  }
  return out;
}

// Soft floor + consistency heuristic (D7-30). A positive integer `count`
// proves nothing about whether the number matches the task; these two
// warnings flag the drift shapes the schema check cannot — a count below the
// pipeline width with no stated reason, and a rationale that names no
// decomposition basis. Both are WARNINGS so CI stays green while a reviewer
// is alerted ("keep as warnings first").
function checkFanoutConsistency(file: ParsedFile, count: number, rationale: string): Finding[] {
  const pipeline = getAgentPipeline(file.frontmatter);
  // A pipeline of ≤1 agent carries no count floor and no decomposition basis
  // to name, so neither heuristic applies.
  if (pipeline.length <= 1) return [];

  const out: Finding[] = [];

  // Distinct non-specialist agents set the soft floor: the always-spawned
  // workers a multi-stage command runs regardless of which CQ vectors a
  // change touches.
  const distinctNonSpecialist = new Set(
    pipeline.filter((a) => !CQ_SPECIALIST_AGENTS.has(a)),
  ).size;

  if (count < distinctNonSpecialist && !CONDITIONAL_DISPATCH_MARKER.test(rationale)) {
    out.push({
      level: "warning",
      code: "P8-FANOUT-COUNT-LOW",
      file: file.relPath,
      message:
        `\`sub_agents_spawned.count\` (${count}) is below the ${distinctNonSpecialist} distinct ` +
        "non-specialist agent(s) in `agentPipeline` and the rationale names no conditional-dispatch " +
        "reason (mutual exclusion, triage tier, batch scaling). Raise the count to the task-derived " +
        "fan-out, or state in the rationale why fewer sub-agents run (P8 B2 cost-dominance: token cost " +
        "never serializes independent work).",
    });
  }

  if (!DECOMPOSITION_BASIS_MARKER.test(rationale)) {
    out.push({
      level: "warning",
      code: "P8-FANOUT-BASIS-MISS",
      file: file.relPath,
      message:
        "`sub_agents_spawned.rationale` names no decomposition basis (module / concern / mode / stage / " +
        "specialist-gate / research-question count) for a multi-agent pipeline, so a reviewer cannot check " +
        "the count against the task without re-deriving it (`rules/hatch3r-fan-out-discipline.md` → " +
        "Required output field).",
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

// ── Maintainer-preset markers (`.claude/skills/h4tcher-*`) ─────────
//
// A maintainer preset's fan-out trigger is its frontmatter `Task` grant,
// not a body phrase: the lifecycle presets grant `allowed-tools: ... Task`
// to dispatch parallel sub-agents, while the Agent/Workflow-based audit
// orchestrators (audit-cycle, audit-execute, evolve) describe fan-out
// narratively and grant no `Task`. `allowed-tools` is a space-separated
// scalar in these files (e.g. `Read Grep Glob Bash(*) Write Edit Task`),
// so the grant is detected by whole-word match against that string.
function grantsTaskTool(fm: Record<string, unknown>): boolean {
  const v = fm["allowed-tools"];
  if (typeof v !== "string") return false;
  return /(^|\s)Task(\s|$)/.test(v);
}

// Body trigger: a `## Step N: Sub-Agent Dispatch` stage. Five lifecycle
// presets carry this heading; `h4tcher-pr-resolve` delegates inside the
// canonical workflow it invokes (no own dispatch heading) and is caught by
// the `Task` grant instead. The union of the two triggers matches the
// finding's "frontmatter grants `Task` OR body has a Step-N dispatch" rule.
const MAINTAINER_DISPATCH_TRIGGER = /^#{1,4}\s+Step\s+\d+:?\s+Sub-Agent Dispatch\b/im;

// A maintainer preset carries the runtime-emission obligation when it either
// grants the Task tool OR declares a Sub-Agent Dispatch step, and is not a
// Tier-1 reference card. Same emission-directive + exemption regexes as the
// canonical skill class.
function isDelegatingMaintainerSkill(file: ParsedFile): boolean {
  if (SKILL_TIER1_EXEMPTION.test(file.body)) return false;
  return grantsTaskTool(file.frontmatter) || MAINTAINER_DISPATCH_TRIGGER.test(file.body);
}

function checkMaintainerSkillEmission(file: ParsedFile): Finding[] {
  if (!isDelegatingMaintainerSkill(file)) return [];
  if (SKILL_EMISSION_DIRECTIVE.test(file.body)) return [];
  return [
    {
      level: "error",
      code: "P8-FANOUT-SKILL-MISS",
      file: file.relPath,
      message:
        "delegating maintainer preset (grants Task or declares a Sub-Agent " +
        "Dispatch step) omits the runtime-emission directive (P8 B2): add " +
        "``Emit `sub_agents_spawned: { count, rationale }` in your output.`` " +
        "to the body, or mark the preset `Tier 1 reference card — no fan-out`",
    },
  ];
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

  // ── Maintainer-preset class: same directive on Task-granting presets ──
  const maintainerDir = opts.maintainerSkillsDir ?? MAINTAINER_SKILLS_DIR;
  const maintainerBase = resolve(maintainerDir, "..", "..");
  const maintainerCandidates = await listMaintainerSkillCandidates(maintainerDir);
  let checkedMaintainerSkills = 0;

  for (const p of maintainerCandidates) {
    let f: ParsedFile;
    try {
      f = await loadFile(p, maintainerBase);
    } catch {
      // A preset directory without a readable SKILL.md carries no fan-out
      // obligation; skipping it is the intended discovery-time best-effort,
      // not a swallowed fault (same contract as the skill pass above).
      // eslint-disable-next-line silent-failure/no-silent-catch
      continue;
    }
    if (!isDelegatingMaintainerSkill(f)) continue;
    checkedMaintainerSkills += 1;
    findings.push(...checkMaintainerSkillEmission(f));
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
    checkedFiles,
    checkedSkills,
    checkedMaintainerSkills,
  };
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
        `${result.checkedSkills} delegating skill(s) + ` +
        `${result.checkedMaintainerSkills} maintainer preset(s) checked; ` +
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
