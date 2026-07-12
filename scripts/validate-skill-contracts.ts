#!/usr/bin/env node
/**
 * scripts/validate-skill-contracts.ts — Cycle 12 CL-2 U9 (D5-SA5.6-10).
 *
 * Contract-parity suite, layer (b) of the skill/agent behavioral eval
 * harness: asserts per-skill structural contracts that no existing gate
 * covers. Deliberately NOT re-checked here (single source of truth, P4):
 * frontmatter presence + id/type presence (src/cli/commands/validate.ts,
 * warnings), tag VALUES vs TAG_REGISTRY (validate.ts), command orchestrator
 * contract (validate.ts), efficiency frontmatter
 * (validate-efficiency-invariants.ts), CLI-skill registry/body parity
 * (validate-cli-skills.ts), References-line hygiene
 * (validate-references-currency.ts). The full covered-elsewhere table lives
 * in .audit-workspace/content-specs/skill-eval-harness.spec.md.
 *
 * Net-new checks (one ERROR per hit, `skills/<dir>/SKILL.md` only):
 *
 *   SKILL-CONTRACT-BAD-FRONTMATTER  frontmatter missing or unparseable
 *                                   (strict here; validate.ts only warns).
 *   SKILL-CONTRACT-ID-DIR           frontmatter `id` differs from the
 *                                   containing directory name.
 *   SKILL-CONTRACT-TYPE             `type` is not `skill`.
 *   SKILL-CONTRACT-NO-DESCRIPTION   `description` missing or empty.
 *   SKILL-CONTRACT-NO-TAGS          `tags` missing or an empty array.
 *   SKILL-CONTRACT-NO-QUICK-START   body lacks a `## Quick Start` heading
 *                                   (content-authoring §5 Quick Start + Step
 *                                   pattern).
 *   SKILL-CONTRACT-NO-STEP          body lacks a `## Step <n>` heading.
 *
 * Class-aware exemption: ids listed in `governance/inventory.json`
 * `files.cliSkills` are generated tool cards with their own structure gate
 * (validate-cli-skills.ts) — exempt from the two structural checks.
 *
 * Allowlist: `scripts/skill-eval-allowlist.json`, section `contracts`
 * (entries match on file + token(=skill id) + code). Census seeds
 * (board family + gh-agentic-workflows) are annotated
 * `pre-existing (cycle-12 CL-2 U9 census)` so the gate starts green but
 * visible; NEW skills are bound by the full contract.
 *
 * Pillars: P2 (measurable structural contract), P5 (Governance
 * Self-Quality), P4 (no duplication of existing gates).
 *
 * Usage:
 *   tsx scripts/validate-skill-contracts.ts
 *   tsx scripts/validate-skill-contracts.ts --json
 *   tsx scripts/validate-skill-contracts.ts --root <dir>   (test fixture seam)
 *
 * Exits 0 when no error findings remain after allowlist filtering, 1 otherwise.
 */
import type { Dirent } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";

import { loadAllowlist, type AllowlistEntry } from "./validate-skill-refs.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = resolve(__dirname, "..");

// ── Types ─────────────────────────────────────────────────────────

export interface ContractFinding {
  level: "error";
  code:
    | "SKILL-CONTRACT-BAD-FRONTMATTER"
    | "SKILL-CONTRACT-ID-DIR"
    | "SKILL-CONTRACT-TYPE"
    | "SKILL-CONTRACT-NO-DESCRIPTION"
    | "SKILL-CONTRACT-NO-TAGS"
    | "SKILL-CONTRACT-NO-QUICK-START"
    | "SKILL-CONTRACT-NO-STEP";
  /** Repo-relative path of the checked SKILL.md. */
  file: string;
  /** Allowlist match token: the skill's directory name (its id). */
  token: string;
  message: string;
}

export interface ContractRunResult {
  skillsChecked: number;
  findings: ContractFinding[];
  allowlisted: ContractFinding[];
  errorCount: number;
}

export interface RunOptions {
  rootDir?: string;
}

// ── Frontmatter ───────────────────────────────────────────────────

interface ParsedSkill {
  frontmatter: Record<string, unknown> | undefined;
  body: string;
}

export function parseSkill(content: string): ParsedSkill {
  if (!content.startsWith("---\n") && !content.startsWith("---\r\n")) {
    return { frontmatter: undefined, body: content };
  }
  const afterOpen = content.indexOf("\n", 3) + 1;
  const closeIdx = content.indexOf("\n---", afterOpen - 1);
  if (afterOpen <= 0 || closeIdx === -1) {
    return { frontmatter: undefined, body: content };
  }
  const fmRaw = content.slice(afterOpen, closeIdx);
  const afterClose = content.indexOf("\n", closeIdx + 4);
  const body = afterClose === -1 ? "" : content.slice(afterClose + 1);
  try {
    const parsed = parseYaml(fmRaw) as unknown;
    if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
      return { frontmatter: parsed as Record<string, unknown>, body };
    }
    return { frontmatter: undefined, body };
    // A YAML parse failure is reported by the caller as
    // SKILL-CONTRACT-BAD-FRONTMATTER — the undefined return IS the diagnostic.
    // eslint-disable-next-line silent-failure/no-silent-catch
  } catch {
    return { frontmatter: undefined, body };
  }
}

// ── Checks ────────────────────────────────────────────────────────

const QUICK_START_RE = /^##\s+Quick Start\b/m;
const STEP_RE = /^##\s+Step\s+\d/m;

async function loadCliSkillIds(rootDir: string): Promise<Set<string>> {
  try {
    const raw = await readFile(join(rootDir, "governance", "inventory.json"), "utf-8");
    const inv = JSON.parse(raw) as { files?: { cliSkills?: string[] } };
    return new Set((inv.files?.cliSkills ?? []).map((e) => e.split("/")[0]));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return new Set();
    throw err;
  }
}

export function checkSkill(
  relFile: string,
  dirName: string,
  content: string,
  cliSkillIds: ReadonlySet<string>,
): ContractFinding[] {
  const findings: ContractFinding[] = [];
  const push = (code: ContractFinding["code"], message: string): void => {
    findings.push({ level: "error", code, file: relFile, token: dirName, message });
  };

  const { frontmatter, body } = parseSkill(content);
  if (frontmatter === undefined) {
    push("SKILL-CONTRACT-BAD-FRONTMATTER", "frontmatter missing or unparseable");
    return findings;
  }

  if (typeof frontmatter.id !== "string" || frontmatter.id !== dirName) {
    push(
      "SKILL-CONTRACT-ID-DIR",
      `frontmatter id "${String(frontmatter.id)}" does not match directory name "${dirName}"`,
    );
  }
  if (frontmatter.type !== "skill") {
    push("SKILL-CONTRACT-TYPE", `frontmatter type "${String(frontmatter.type)}" is not "skill"`);
  }
  if (typeof frontmatter.description !== "string" || frontmatter.description.trim() === "") {
    push("SKILL-CONTRACT-NO-DESCRIPTION", "frontmatter description missing or empty");
  }
  if (!Array.isArray(frontmatter.tags) || frontmatter.tags.length === 0) {
    push("SKILL-CONTRACT-NO-TAGS", "frontmatter tags missing or empty");
  }

  // Structural pattern (content-authoring §5) — generated CLI tool cards are
  // exempt (their structure gate is validate-cli-skills.ts).
  if (!cliSkillIds.has(dirName)) {
    if (!QUICK_START_RE.test(body)) {
      push("SKILL-CONTRACT-NO-QUICK-START", "body lacks a `## Quick Start` heading");
    }
    if (!STEP_RE.test(body)) {
      push("SKILL-CONTRACT-NO-STEP", "body lacks a `## Step <n>` heading");
    }
  }

  return findings;
}

// ── Runner ────────────────────────────────────────────────────────

function isAllowlisted(allowlist: readonly AllowlistEntry[], f: ContractFinding): boolean {
  return allowlist.some((a) => a.file === f.file && a.token === f.token && a.code === f.code);
}

export async function runValidator(options: RunOptions = {}): Promise<ContractRunResult> {
  const rootDir = options.rootDir ?? ROOT;
  const allowlist = await loadAllowlist(rootDir, "contracts");
  const cliSkillIds = await loadCliSkillIds(rootDir);

  const all: ContractFinding[] = [];
  let skillsChecked = 0;

  const skillsDir = join(rootDir, "skills");
  let entries: Dirent[];
  try {
    entries = await readdir(skillsDir, { withFileTypes: true });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return { skillsChecked: 0, findings: [], allowlisted: [], errorCount: 0 };
    }
    throw err;
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const relFile = `skills/${entry.name}/SKILL.md`;
    let content: string;
    try {
      content = await readFile(join(rootDir, relFile), "utf-8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") continue; // validate.ts owns this warning
      throw err;
    }
    skillsChecked++;
    all.push(...checkSkill(relFile, entry.name, content, cliSkillIds));
  }

  const findings: ContractFinding[] = [];
  const allowlisted: ContractFinding[] = [];
  for (const f of all) {
    if (isAllowlisted(allowlist, f)) allowlisted.push(f);
    else findings.push(f);
  }

  return { skillsChecked, findings, allowlisted, errorCount: findings.length };
}

// ── Output ────────────────────────────────────────────────────────

export function formatFinding(f: ContractFinding): string {
  return `[ERROR ${f.code}] ${f.file}: ${f.message}`;
}

interface CliFlags {
  json: boolean;
  root?: string;
}

function parseArgs(argv: readonly string[]): CliFlags {
  const flags: CliFlags = { json: argv.includes("--json") };
  const i = argv.indexOf("--root");
  if (i !== -1 && argv[i + 1] !== undefined) {
    flags.root = resolve(argv[i + 1]);
  }
  return flags;
}

async function main(): Promise<void> {
  const flags = parseArgs(process.argv.slice(2));
  const result = await runValidator(flags.root ? { rootDir: flags.root } : {});
  if (flags.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    for (const f of result.findings) console.error(formatFinding(f));
    console.log(
      `validate-skill-contracts: ${result.skillsChecked} skill(s) checked; ` +
        `${result.errorCount} error(s), ${result.allowlisted.length} allowlisted (census-visible)`,
    );
  }
  if (result.errorCount > 0) process.exit(1);
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
    console.error("validate-skill-contracts failed:", err);
    process.exit(1);
  });
}
