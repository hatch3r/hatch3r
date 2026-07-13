#!/usr/bin/env node
/**
 * scripts/run-skill-golden-set.ts — Cycle 12 CL-2 U9 (D5-SA5.6-10).
 *
 * LLM golden set, layer (c) of the skill/agent behavioral eval harness.
 * Fixtures live in `scripts/eval-fixtures/skill-golden-set/<skill-id>.json`
 * (6 CLI skills + the 5 highest-traffic workflow skills; selection proxy
 * documented in .audit-workspace/content-specs/skill-eval-harness.spec.md).
 *
 * MANUAL / CI-OPTIONAL BY DESIGN — this runner performs NO live LLM calls and
 * is NOT wired into `npm run validate` or CI. Skills are prompts; executing
 * them is LLM-driven and non-deterministic, so the behavioral judgment is a
 * human-triggered eval: this script prints ready-to-paste eval prompts, an
 * operator runs each against an agent session with the skill loaded, and an
 * LLM judge (or the operator) grades the transcript against the case rubric.
 * That is the rationale-for-absence SA5.6-10 required: the DETERMINISTIC
 * layers (validate-skill-refs.ts, validate-skill-contracts.ts) run in CI;
 * the behavioral layer ships as fixtures + this documented runner.
 *
 * What IS deterministic here — and covered by the vitest gate
 * (src/__tests__/governance/skill-eval-harness-gate.test.ts): fixture schema
 * validation (skill/skillPath/cohort present, skillPath exists on disk,
 * >=2 cases per fixture, unique case ids, non-empty expected + rubric).
 * Schema violations exit 1; a valid fixture set exits 0.
 *
 * Usage:
 *   tsx scripts/run-skill-golden-set.ts             # print all eval prompts
 *   tsx scripts/run-skill-golden-set.ts --list      # fixture summary table
 *   tsx scripts/run-skill-golden-set.ts --skill hatch3r-feature
 *   tsx scripts/run-skill-golden-set.ts --json      # machine-readable prompt set
 *   tsx scripts/run-skill-golden-set.ts --root <dir>  (test fixture seam)
 *
 * Operator procedure (manual eval):
 *   1. Pick a case from the printed set.
 *   2. Start an agent session in a scratch repo with the skill installed
 *      (`npx hatch3r init` or copy the skill body into the platform's skill dir).
 *   3. Paste the case INPUT (plus CONTEXT preconditions) as the user message.
 *   4. Grade the transcript against the RUBRIC; the EXPECTED bullets are the
 *      judge's positive criteria, FORBIDDEN bullets are automatic fails.
 *   5. Record pass/fail per case id alongside the cycle's audit evidence.
 *
 * Pillars: P2 (behavioral coverage with a documented determinism boundary),
 * P5 (Governance Self-Quality).
 */
import { readdir, readFile, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = resolve(__dirname, "..");

export const FIXTURES_DIR = join("scripts", "eval-fixtures", "skill-golden-set");

// ── Types ─────────────────────────────────────────────────────────

export interface GoldenCase {
  id: string;
  input: string;
  context?: string;
  expected: string[];
  forbidden?: string[];
  rubric: string;
}

export interface GoldenFixture {
  skill: string;
  skillPath: string;
  cohort: "cli" | "workflow";
  cases: GoldenCase[];
}

export interface SchemaViolation {
  file: string;
  message: string;
}

export interface GoldenSetResult {
  fixtures: GoldenFixture[];
  violations: SchemaViolation[];
}

// ── Schema validation (deterministic, vitest-covered) ─────────────

export function validateFixture(file: string, raw: unknown): SchemaViolation[] {
  const violations: SchemaViolation[] = [];
  const bad = (message: string): void => {
    violations.push({ file, message });
  };

  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    bad("fixture is not a JSON object");
    return violations;
  }
  const fx = raw as Partial<GoldenFixture>;

  if (typeof fx.skill !== "string" || fx.skill === "") bad("missing `skill`");
  if (typeof fx.skillPath !== "string" || fx.skillPath === "") bad("missing `skillPath`");
  if (fx.cohort !== "cli" && fx.cohort !== "workflow") bad("`cohort` must be \"cli\" or \"workflow\"");

  if (!Array.isArray(fx.cases) || fx.cases.length < 2) {
    bad("`cases` must be an array with >=2 cases");
    return violations;
  }

  const seenIds = new Set<string>();
  for (const c of fx.cases) {
    const cid = typeof c.id === "string" && c.id !== "" ? c.id : "<missing id>";
    if (cid === "<missing id>") bad("case missing `id`");
    else if (seenIds.has(cid)) bad(`duplicate case id "${cid}"`);
    seenIds.add(cid);
    if (typeof c.input !== "string" || c.input.trim() === "") bad(`case ${cid}: missing \`input\``);
    if (!Array.isArray(c.expected) || c.expected.length === 0) bad(`case ${cid}: \`expected\` must be a non-empty array`);
    if (typeof c.rubric !== "string" || c.rubric.trim() === "") bad(`case ${cid}: missing \`rubric\``);
    if (c.forbidden !== undefined && !Array.isArray(c.forbidden)) bad(`case ${cid}: \`forbidden\` must be an array when present`);
  }

  return violations;
}

// ── Loading ───────────────────────────────────────────────────────

export async function loadGoldenSet(rootDir: string): Promise<GoldenSetResult> {
  const dir = join(rootDir, FIXTURES_DIR);
  const fixtures: GoldenFixture[] = [];
  const violations: SchemaViolation[] = [];

  let names: string[];
  try {
    names = (await readdir(dir)).filter((n) => n.endsWith(".json")).sort((a, b) => a.localeCompare(b));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return { fixtures: [], violations: [{ file: dir, message: "fixtures directory missing" }] };
    }
    throw err;
  }

  for (const name of names) {
    const relFile = `${FIXTURES_DIR}/${name}`;
    let raw: unknown;
    try {
      raw = JSON.parse(await readFile(join(dir, name), "utf-8"));
    } catch {
      violations.push({ file: relFile, message: "invalid JSON" });
      continue;
    }
    const fxViolations = validateFixture(relFile, raw);
    violations.push(...fxViolations);
    if (fxViolations.length > 0) continue;

    const fx = raw as GoldenFixture;
    try {
      await stat(join(rootDir, fx.skillPath));
    } catch {
      violations.push({ file: relFile, message: `skillPath "${fx.skillPath}" does not exist` });
      continue;
    }
    fixtures.push(fx);
  }

  return { fixtures, violations };
}

// ── Prompt rendering ──────────────────────────────────────────────

export function renderCasePrompt(fx: GoldenFixture, c: GoldenCase): string {
  const lines: string[] = [
    `=== GOLDEN CASE ${c.id} (${fx.skill}, cohort: ${fx.cohort}) ===`,
    "",
    `SKILL BODY: load ${fx.skillPath} into the agent session before sending the input.`,
    "",
  ];
  if (c.context !== undefined && c.context !== "") {
    lines.push(`CONTEXT (preconditions to arrange):`, `  ${c.context}`, "");
  }
  lines.push("INPUT (paste as the user message):", `  ${c.input}`, "", "JUDGE RUBRIC:", `  ${c.rubric}`, "", "EXPECTED (positive criteria):");
  for (const e of c.expected) lines.push(`  + ${e}`);
  if (c.forbidden !== undefined && c.forbidden.length > 0) {
    lines.push("FORBIDDEN (automatic fail):");
    for (const f of c.forbidden) lines.push(`  - ${f}`);
  }
  lines.push("");
  return lines.join("\n");
}

// ── CLI ───────────────────────────────────────────────────────────

interface CliFlags {
  json: boolean;
  list: boolean;
  skill?: string;
  root?: string;
}

function parseArgs(argv: readonly string[]): CliFlags {
  const flags: CliFlags = { json: argv.includes("--json"), list: argv.includes("--list") };
  const s = argv.indexOf("--skill");
  if (s !== -1 && argv[s + 1] !== undefined) flags.skill = argv[s + 1];
  const r = argv.indexOf("--root");
  if (r !== -1 && argv[r + 1] !== undefined) flags.root = resolve(argv[r + 1]);
  return flags;
}

async function main(): Promise<void> {
  const flags = parseArgs(process.argv.slice(2));
  const rootDir = flags.root ?? ROOT;
  const { fixtures, violations } = await loadGoldenSet(rootDir);

  if (violations.length > 0) {
    for (const v of violations) console.error(`[ERROR GOLDEN-SET-SCHEMA] ${v.file}: ${v.message}`);
    console.log(`run-skill-golden-set: ${violations.length} schema violation(s) — fix fixtures before running evals`);
    process.exit(1);
  }

  const selected = flags.skill !== undefined ? fixtures.filter((f) => f.skill === flags.skill) : fixtures;
  if (flags.skill !== undefined && selected.length === 0) {
    console.error(`[ERROR GOLDEN-SET-SCHEMA] no fixture for skill "${flags.skill}"`);
    process.exit(1);
  }

  const caseCount = selected.reduce((n, f) => n + f.cases.length, 0);

  if (flags.json) {
    console.log(
      JSON.stringify(
        {
          fixtureCount: selected.length,
          caseCount,
          prompts: selected.flatMap((f) => f.cases.map((c) => ({ skill: f.skill, cohort: f.cohort, caseId: c.id, prompt: renderCasePrompt(f, c) }))),
        },
        null,
        2,
      ),
    );
    return;
  }

  if (flags.list) {
    for (const f of selected) console.log(`${f.skill}\t${f.cohort}\t${f.cases.length} case(s)`);
    console.log(`run-skill-golden-set: ${selected.length} fixture(s), ${caseCount} case(s) — manual eval runner, no LLM calls (see header)`);
    return;
  }

  for (const f of selected) {
    for (const c of f.cases) console.log(renderCasePrompt(f, c));
  }
  console.log(`run-skill-golden-set: printed ${caseCount} eval prompt(s) across ${selected.length} skill(s). Manual procedure: see this script's header.`);
}

// Only auto-run when executed as a script, never when imported by tests.
const isMain = (() => {
  try {
    return resolve(process.argv[1] ?? "") === __filename;
    // The is-main detector defaults to "not main" if either argument
    // resolution throws. The fallback path is the test-import path; no
    // diagnostic channel applies because tests intentionally import this module.
    // eslint-disable-next-line silent-failure/no-silent-catch
  } catch {
    return false;
  }
})();

if (isMain) {
  main().catch((err) => {
    console.error("run-skill-golden-set failed:", err);
    process.exit(1);
  });
}
