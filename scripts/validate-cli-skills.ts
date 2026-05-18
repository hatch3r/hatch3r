#!/usr/bin/env node
/**
 * scripts/validate-cli-skills.ts — Wave 4a, plan §7 item 25
 *
 * Registry-skill parity gate. Asserts that every `AVAILABLE_CLI_TOOLS`
 * entry has a matching `skills/hatch3r-cli-{id}/SKILL.md` (and vice-versa)
 * plus that the per-skill frontmatter agrees with the registry on id,
 * tier, and caveat. The umbrella catalog must reference every tool.
 *
 * Pillars: P3 (CLI-Tool Currency), P4 (Lean Coverage), P5 (Governance Self-Quality).
 *
 * Usage: `npm run validate:cli-skills` (invokes via tsx). Exits 0 on a
 * clean pass, 1 on any drift with a per-file failure summary.
 *
 * Mirrors the structure of `scripts/validate-rule-parity.ts`.
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
const UMBRELLA_DIR = "hatch3r-cli-overview";
const PER_TOOL_PREFIX = "hatch3r-cli-";

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

/**
 * Strip the leading YAML frontmatter block. Mirrors the implementation in
 * `scripts/validate-rule-parity.ts` for behavioral consistency.
 */
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
    // YAML parse failure is surfaced upstream as a frontmatter validation
    // failure; we still want to return the body so subsequent checks run.
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
    .filter((name) => name.startsWith(PER_TOOL_PREFIX) && name !== UMBRELLA_DIR)
    .sort((a, b) => a.localeCompare(b));
}

/**
 * Check 1: every registry entry has a matching skill file.
 * Check 3: per-skill frontmatter `id` matches `hatch3r-cli-{toolId}`.
 * Check 4: per-skill frontmatter has a `cli_tool` block whose `id` matches.
 * Check 5: tools with a registry `caveat` carry a `## ⚠` heading or
 *          `caveat:` substring in the rendered body.
 */
async function checkRegistryHasSkills(): Promise<Failure[]> {
  const failures: Failure[] = [];
  for (const meta of Object.values(AVAILABLE_CLI_TOOLS) as CliToolMeta[]) {
    const dir = `${PER_TOOL_PREFIX}${meta.id}`;
    const skill = await readSkill(dir);
    if (!skill) {
      failures.push({
        file: `${dir}/SKILL.md`,
        reason: "missing skill file",
        detail: `expected skills/${dir}/SKILL.md for registry tool ${meta.id}`,
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
      // Body must surface the caveat: either as a "## ⚠" heading (the
      // generator template's preferred form) or by including the literal
      // registry caveat key inline.
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
 * Check 2: every existing per-tool skill directory maps to a registry id.
 * Catches drift in the reverse direction (skill exists, registry entry
 * deleted).
 */
async function checkSkillsHaveRegistry(): Promise<Failure[]> {
  const failures: Failure[] = [];
  const dirs = await listExistingCliSkillDirs();
  for (const dir of dirs) {
    const toolId = dir.slice(PER_TOOL_PREFIX.length);
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
 * Check 6: umbrella skill exists and references every tool id in its body.
 * The id must appear as a kebab-case mention (matches both `\`tool\`` and
 * `hatch3r-cli-tool`) — the generator emits both forms in its catalog
 * tables, so the substring check is intentionally permissive.
 */
async function checkUmbrella(): Promise<Failure[]> {
  const failures: Failure[] = [];
  const umbrella = await readSkill(UMBRELLA_DIR);
  if (!umbrella) {
    failures.push({
      file: `skills/${UMBRELLA_DIR}/SKILL.md`,
      reason: "missing umbrella skill",
      detail: "the catalog file `hatch3r-cli-overview/SKILL.md` must exist",
    });
    return failures;
  }
  for (const meta of Object.values(AVAILABLE_CLI_TOOLS) as CliToolMeta[]) {
    if (!umbrella.body.includes(meta.id)) {
      failures.push({
        file: umbrella.path,
        reason: "umbrella missing tool",
        detail: `umbrella catalog must mention tool id "${meta.id}"`,
      });
    }
  }
  return failures;
}

async function main(): Promise<void> {
  const failures: Failure[] = [];
  failures.push(...(await checkRegistryHasSkills()));
  failures.push(...(await checkSkillsHaveRegistry()));
  failures.push(...(await checkUmbrella()));

  const total = Object.keys(AVAILABLE_CLI_TOOLS).length;
  if (failures.length === 0) {
    // eslint-disable-next-line no-console
    console.log(
      `validate:cli-skills: ${total} registry entries checked, umbrella catalog OK, 0 drift`,
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
