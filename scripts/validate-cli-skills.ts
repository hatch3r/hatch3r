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
 *
 * Audit confirmation contract (D21-SA21.7-F-21.7.7): the single-line
 * "validate:cli-skills: <N> registry entries checked ..., 0 drift" summary
 * printed on a clean pass is the stable capture target for the audit-execute
 * Phase 0 pre-flight, which records this line + exit code to
 * `.audit-workspace/precheck-results.json::validate_cli_skills`. D21 SA21.7
 * reads that record to discharge its capability-matrix-verification step
 * (D21-cli-tool-currency.md line 56). Keep the summary line and exit-code
 * contract stable so the confirmation stays evidenced, not inferred.
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

    // F15.7-H3 (Cycle 10 D15-SA15.7): every standalone skill body must
    // present install commands for all three supported OS keys (mac,
    // linux, win) — silently shipping mac-only blocks violated the
    // "vendor-signed channel" trust assertion on Linux + Windows. The
    // renderer in `src/cliTools/skill.ts::renderCliToolSkillBody` was
    // patched to emit all three; this gate keeps it from regressing.
    for (const os of ["mac", "linux", "win"] as const) {
      if ((meta.install[os] ?? []).length === 0) continue;
      const osLabel = os === "mac" ? "macOS" : os === "linux" ? "Linux" : "Windows";
      const labelPattern = new RegExp(`^Install \\(${osLabel}[ :)]`, "m");
      if (!labelPattern.test(skill.body)) {
        failures.push({
          file: skill.path,
          reason: "missing per-OS install block",
          detail: `expected an "Install (${osLabel}...)" section in the body; registry lists ${meta.install[os].length} install command(s) for ${os} but the skill body does not surface them`,
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
 * Strip the leading semver range operators from a `minVersion` string so the
 * bare version number can be matched against free-form toolbox prose. The
 * toolbox writes floors in varied forms (`pin >=8.20.0`, `verify >=8.20.0`,
 * `>=3.11.0`), so the gate asserts on the bare number (`8.20.0`), not the
 * exact operator string.
 */
function bareVersion(minVersion: string): string {
  return minVersion.replace(/^[><=~^\s]+/, "").trim();
}

/**
 * Extract the CVE / GHSA advisory identifiers embedded in a registry
 * `securityNote`. Returns an uppercased, de-duplicated list. An empty list
 * means the note is an install-channel / peer-dep advisory that carries no
 * advisory id (e.g. the unsigned-`curl | sh` notes), in which case the gate
 * falls back to the keyword markers in `SECURITY_MARKER_KEYWORDS`.
 */
function securityNoteIdentifiers(note: string): string[] {
  const matches = note.match(/\b(?:CVE-\d{4}-\d+|GHSA-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4})\b/gi) ?? [];
  return [...new Set(matches.map((s) => s.toUpperCase()))];
}

/**
 * Keyword markers that satisfy the security-surface assertion when a
 * `securityNote` carries no CVE/GHSA id (install-channel + peer-dep notes).
 * Lower-cased; matched against the lower-cased section body.
 */
const SECURITY_MARKER_KEYWORDS = [
  "unsigned",
  "signed channel",
  "signed brew",
  "signed winget",
  "signed apt",
  "caveat",
  "peer-dep",
  "peer dep",
] as const;

/**
 * Return the body lines of the `### {id}` toolbox section, from the heading up
 * to the next level-2 (`## `) or level-3 (`### `) heading. Level-4 (`#### `)
 * sub-headings (the per-tool Sandbox-callout blocks) are part of the tool's
 * section and are NOT treated as a boundary. Returns `null` when no `### {id}`
 * heading is present.
 */
function toolboxSectionBody(toolboxBody: string, id: string): string | null {
  const lines = toolboxBody.split("\n");
  const esc = id.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\$&");
  const startRe = new RegExp(`^###\\s+${esc}\\b`);
  const startIdx = lines.findIndex((line) => startRe.test(line));
  if (startIdx === -1) return null;
  const collected: string[] = [];
  for (let j = startIdx + 1; j < lines.length; j++) {
    if (/^###\s+/.test(lines[j]) || /^##\s+/.test(lines[j])) break;
    collected.push(lines[j]);
  }
  return collected.join("\n");
}

/**
 * Check 3: toolbox skill exists and contains a `### {id}` section for every
 * non-standalone registry tool. The section must also surface the registry's
 * security posture (D15-10, SA15.7-F2): when a tool carries a `minVersion`
 * floor the section must print the bare version number, and when it carries a
 * `securityNote` the section must surface a security marker (a CVE/GHSA id
 * from the note, or an unsigned-channel / peer-dep keyword). This is the
 * single-source-of-truth parity gate that stops the registry's CVE floors and
 * unsigned-channel warnings from silently dropping out of the agent-facing
 * toolbox reference.
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
    const section = toolboxSectionBody(toolbox.body, meta.id);
    if (section === null) {
      failures.push({
        file: toolbox.path,
        reason: "toolbox missing tool section",
        detail: `toolbox must contain a "### ${meta.id}" section`,
      });
      continue;
    }
    const sectionLower = section.toLowerCase();

    if (meta.minVersion) {
      const floor = bareVersion(meta.minVersion);
      if (floor.length > 0 && !sectionLower.includes(floor.toLowerCase())) {
        failures.push({
          file: toolbox.path,
          reason: "toolbox section missing version floor",
          detail: `registry pins ${meta.id} minVersion=${JSON.stringify(meta.minVersion)} but the "### ${meta.id}" section does not surface the floor "${floor}" — add a version-floor line (e.g. "Version floor: >=${floor}") so the CVE floor reaches the agent-facing reference`,
        });
      }
    }

    if (meta.securityNote) {
      const ids = securityNoteIdentifiers(meta.securityNote);
      const hasId = ids.some((id) => sectionLower.includes(id.toLowerCase()));
      const hasKeyword = SECURITY_MARKER_KEYWORDS.some((kw) => sectionLower.includes(kw));
      if (!hasId && !hasKeyword) {
        const expectation =
          ids.length > 0
            ? `surface one of its advisory ids (${ids.join(", ")})`
            : `surface a security marker (one of: ${SECURITY_MARKER_KEYWORDS.join(", ")})`;
        failures.push({
          file: toolbox.path,
          reason: "toolbox section missing security marker",
          detail: `registry attaches a securityNote to ${meta.id} but the "### ${meta.id}" section does not ${expectation} — add a Security line summarising the registry note so the warning reaches the agent-facing reference`,
        });
      }
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
