#!/usr/bin/env node
/**
 * scripts/validate-cli-skills.ts — Wave 4a, plan §7 item 25 (revised v1.9.0)
 *
 * Registry-skill parity gate. After the v1.9.0 toolbox consolidation:
 *  - Five high-frequency tools retain a standalone `skills/hatch3r-cli-{id}/SKILL.md`
 *    (`ripgrep`, `jq`, `gh`, `fd`, `fzf`).
 *  - Every other `AVAILABLE_CLI_TOOLS` entry must appear as a `### {id}`
 *    section inside `skills/hatch3r-cli-toolbox/SKILL.md`.
 *
 * Pillars: P3 (CLI-Tool Currency), P4 (Lean Coverage), P5 (Governance Self-Quality).
 *
 * Usage: `npm run validate:cli-skills` (invokes via tsx). Exits 0 on a
 * clean pass, 1 on any drift with a per-file failure summary.
 */
import { readdir, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";

import { AVAILABLE_CLI_TOOLS, type CliToolMeta } from "../src/cliTools/registry.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = resolve(__dirname, "..");
const SKILLS_DIR = join(ROOT, "skills");
const TOOLBOX_DIR = "hatch3r-cli-toolbox";
const PER_TOOL_PREFIX = "hatch3r-cli-";

/**
 * The five tools that retain standalone per-tool skills (always-on, highest
 * agent-call frequency). Every other registry entry must be covered by a
 * section in `hatch3r-cli-toolbox/SKILL.md`.
 */
const STANDALONE_TOOLS = new Set(["ripgrep", "jq", "gh", "fd", "fzf"]);

interface Failure {
  file: string;
  reason: string;
  detail: string;
}

interface ParsedSkill {
  path: string;
  frontmatter: Record<string, unknown>;
  body: string;
}

function splitFrontmatter(content: string): {
  frontmatter: Record<string, unknown>;
  body: string;
} {
  if (!content.startsWith("---\n") && !content.startsWith("---\r\n")) {
    return { frontmatter: {}, body: content };
  }
  const afterOpen = content.indexOf("\n", 3) + 1;
  if (afterOpen <= 0) return { frontmatter: {}, body: content };
  const closeIdx = content.indexOf("\n---", afterOpen - 1);
  if (closeIdx === -1) return { frontmatter: {}, body: content };
  const fmRaw = content.slice(afterOpen, closeIdx);
  const afterClose = content.indexOf("\n", closeIdx + 4);
  const body = afterClose === -1 ? "" : content.slice(afterClose + 1);
  let frontmatter: Record<string, unknown> = {};
  try {
    const parsed = parseYaml(fmRaw);
    if (parsed && typeof parsed === "object") {
      frontmatter = parsed as Record<string, unknown>;
    }
  } catch {
    // Surfaced upstream as a frontmatter validation failure.
  }
  return { frontmatter, body };
}

async function readSkill(relDir: string): Promise<ParsedSkill | null> {
  const path = join(SKILLS_DIR, relDir, "SKILL.md");
  let content: string;
  try {
    content = await readFile(path, "utf-8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
  const { frontmatter, body } = splitFrontmatter(content);
  return { path, frontmatter, body };
}

async function listExistingCliSkillDirs(): Promise<string[]> {
  let entries: string[];
  try {
    entries = await readdir(SKILLS_DIR);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
  return entries
    .filter((name) => name.startsWith(PER_TOOL_PREFIX) && name !== TOOLBOX_DIR)
    .sort((a, b) => a.localeCompare(b));
}

/**
 * Check 1: every standalone-tier tool has its own skill file with matching
 * frontmatter id, cli_tool block, and caveat surfacing.
 */
async function checkStandaloneSkills(): Promise<Failure[]> {
  const failures: Failure[] = [];
  for (const meta of Object.values(AVAILABLE_CLI_TOOLS) as CliToolMeta[]) {
    if (!STANDALONE_TOOLS.has(meta.id)) continue;
    const dir = `${PER_TOOL_PREFIX}${meta.id}`;
    const skill = await readSkill(dir);
    if (!skill) {
      failures.push({
        file: `${dir}/SKILL.md`,
        reason: "missing standalone skill",
        detail: `expected skills/${dir}/SKILL.md for standalone tool ${meta.id}`,
      });
      continue;
    }

    const fmId = typeof skill.frontmatter.id === "string" ? skill.frontmatter.id : null;
    const expectedFmId = `hatch3r-cli-${meta.id}`;
    if (fmId !== expectedFmId) {
      failures.push({
        file: skill.path,
        reason: "frontmatter id mismatch",
        detail: `expected id="${expectedFmId}", got ${JSON.stringify(fmId)}`,
      });
    }

    const cliTool = skill.frontmatter.cli_tool;
    if (!cliTool || typeof cliTool !== "object") {
      failures.push({
        file: skill.path,
        reason: "missing cli_tool block",
        detail: `expected cli_tool.id="${meta.id}" in frontmatter`,
      });
    } else {
      const cliBlock = cliTool as Record<string, unknown>;
      if (cliBlock.id !== meta.id) {
        failures.push({
          file: skill.path,
          reason: "cli_tool.id mismatch",
          detail: `expected ${meta.id}, got ${JSON.stringify(cliBlock.id)}`,
        });
      }
      if (meta.caveat && cliBlock.caveat !== meta.caveat) {
        failures.push({
          file: skill.path,
          reason: "cli_tool.caveat mismatch",
          detail: `registry caveat=${JSON.stringify(meta.caveat)}, frontmatter caveat=${JSON.stringify(cliBlock.caveat)}`,
        });
      }
    }

    if (meta.caveat) {
      const hasHeading = /^##\s+⚠/m.test(skill.body);
      const hasKey = skill.body.includes(`caveat: ${meta.caveat}`) || skill.body.includes(meta.caveat);
      if (!hasHeading && !hasKey) {
        failures.push({
          file: skill.path,
          reason: "missing caveat surface",
          detail: `registry caveat=${JSON.stringify(meta.caveat)} requires a "## ⚠" heading or inline caveat: substring in the body`,
        });
      }
    }
  }
  return failures;
}

/**
 * Check 2: every existing per-tool skill directory maps to a standalone tool.
 * After v1.9.0, only `STANDALONE_TOOLS` may have standalone dirs (plus the
 * `hatch3r-cli-toolbox` umbrella, which is excluded from the listing).
 */
async function checkSkillsHaveRegistry(): Promise<Failure[]> {
  const failures: Failure[] = [];
  const dirs = await listExistingCliSkillDirs();
  for (const dir of dirs) {
    const toolId = dir.slice(PER_TOOL_PREFIX.length);
    if (!STANDALONE_TOOLS.has(toolId)) {
      failures.push({
        file: `skills/${dir}/SKILL.md`,
        reason: "non-standalone per-tool skill",
        detail: `tool ${toolId} should be covered as a section in skills/${TOOLBOX_DIR}/SKILL.md, not its own directory`,
      });
      continue;
    }
    const inRegistry = (AVAILABLE_CLI_TOOLS as Record<string, CliToolMeta | undefined>)[toolId];
    if (!inRegistry) {
      failures.push({
        file: `skills/${dir}/SKILL.md`,
        reason: "orphan skill",
        detail: `skill directory has no matching entry in AVAILABLE_CLI_TOOLS — either re-add the registry entry or remove the skill`,
      });
    }
  }
  return failures;
}

/**
 * Check 3: toolbox skill exists and contains a `### {id}` section for every
 * non-standalone registry tool.
 */
async function checkToolbox(): Promise<Failure[]> {
  const failures: Failure[] = [];
  const toolbox = await readSkill(TOOLBOX_DIR);
  if (!toolbox) {
    failures.push({
      file: `skills/${TOOLBOX_DIR}/SKILL.md`,
      reason: "missing toolbox skill",
      detail: `the consolidated reference at skills/${TOOLBOX_DIR}/SKILL.md must exist`,
    });
    return failures;
  }
  for (const meta of Object.values(AVAILABLE_CLI_TOOLS) as CliToolMeta[]) {
    if (STANDALONE_TOOLS.has(meta.id)) continue;
    const headingPattern = new RegExp(`^###\\s+${meta.id.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\$&")}\\b`, "m");
    if (!headingPattern.test(toolbox.body)) {
      failures.push({
        file: toolbox.path,
        reason: "toolbox missing tool section",
        detail: `toolbox must contain a "### ${meta.id}" section`,
      });
    }
  }
  return failures;
}

async function main(): Promise<void> {
  const failures: Failure[] = [];
  failures.push(...(await checkStandaloneSkills()));
  failures.push(...(await checkSkillsHaveRegistry()));
  failures.push(...(await checkToolbox()));

  const total = Object.keys(AVAILABLE_CLI_TOOLS).length;
  if (failures.length === 0) {
    // eslint-disable-next-line no-console
    console.log(
      `validate:cli-skills: ${total} registry entries checked (${STANDALONE_TOOLS.size} standalone, ${total - STANDALONE_TOOLS.size} toolbox sections), 0 drift`,
    );
    return;
  }

  // eslint-disable-next-line no-console
  console.error(
    `validate:cli-skills: ${failures.length} failure(s) across ${total} registry entries`,
  );
  for (const f of failures) {
    const rel = f.file.startsWith(ROOT) ? f.file.slice(ROOT.length + 1) : f.file;
    // eslint-disable-next-line no-console
    console.error(`  - ${rel}: ${f.reason}`);
    // eslint-disable-next-line no-console
    console.error(
      f.detail
        .split("\n")
        .map((line) => `      ${line}`)
        .join("\n"),
    );
  }
  process.exit(1);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("validate:cli-skills failed:", err);
  process.exit(1);
});
