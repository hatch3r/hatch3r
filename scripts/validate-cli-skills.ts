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
 * contract stable so the confirmation stays evidenced, not inferred. The
 * fully-clean summary above is emitted byte-identically only when there are
 * zero structural failures AND zero advisories; when advisories exist the
 * summary switches to "..., 0 structural drift, <M> advisory(ies) ..." so the
 * record no longer overstates coverage (see the advisory tier below), while
 * the exit code stays 0 on any structural pass.
 *
 * Advisory tier (D21-SA21.7-02 + D5-SA5.6-07, Cycle 12): the three structural
 * checks above (label/id/section existence, toolbox floor/marker surfacing)
 * caught 0 drift while 7 body-level drifts shipped across 4 buckets, because
 * the perimeter never compared install-command BODIES against the registry and
 * never asserted standalone-skill security/References surfaces. This gate adds
 * three non-fatal advisory checks that close that blind spot:
 *   - install-command body parity (`installBodyParityAdvisories`): each
 *     registry install command must appear (sudo-normalised substring) in its
 *     covering artifact — the standalone skill body, or the shared toolbox
 *     install-command matrix cell for toolbox tools.
 *   - standalone security-surface parity (`standaloneSecuritySurfaceAdvisories`):
 *     the `:323-334` toolbox floor/marker assertions, extended to the 5
 *     standalone skills (bare `minVersion` + >=1 securityNote CVE/GHSA id or
 *     marker keyword present in the body).
 *   - References currency (`referencesCurrencyAdvisories`): every URL/file
 *     entry in a CLI skill's `## References` carries an access date, and a
 *     skill making the token-cost empirical claim without a `## References`
 *     section is flagged.
 * These are ADVISORY (exit 0) rather than fatal because their paired content
 * remediations land across waves (Cycle-12 D21-SA21.5-02/03 in Wave 3;
 * D21-SA21.6-08 / D21-SA21.1-05 / D21-SA21.2-04 in Wave 4) plus out-of-scope
 * pre-existing gaps (the ripgrep floor is not surfaced in its skill body; the
 * 4 CLI-tool standalone skills carry no `## References`). A fatal gate here
 * would red the Wave-3 baseline on content this validator cannot fix. Once all
 * paired content fixes land, graduate the advisory checks to `Failure`s
 * (fold them into `failures`) so the gate hard-locks the drift out — the pure
 * check functions are exported and fixture-tested in
 * `scripts/__tests__/validate-cli-skills.test.ts` for exactly that flip.
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

/**
 * A non-fatal parity gap surfaced by the Cycle-12 advisory tier (install-body
 * parity, standalone security-surface parity, References currency). Advisories
 * are reported and counted in the summary line but do NOT change the exit code
 * — the gate stays green on any structural pass. See the file docblock for the
 * graduate-to-`Failure` plan once the paired content fixes land.
 */
export interface Advisory {
  file: string;
  kind: "install-body-parity" | "standalone-security-surface" | "references-currency";
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

/**
 * Normalise an install command for substring parity comparison. Strips the
 * `sudo ` privilege prefix (orthogonal to the command's identity — the toolbox
 * matrix documents apt/snap recipes without `sudo` while the registry stores
 * them with it, so an un-normalised compare would false-positive on every
 * apt/snap tool) and collapses whitespace runs so a wrapped cell still matches.
 * Backticks are left in place: a backtick-wrapped haystack still contains the
 * un-backticked needle as a substring.
 */
export function normalizeInstallCmd(s: string): string {
  return s
    .replace(/(^|\s)sudo\s+/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Parse the toolbox skill's `Install commands:` matrix into
 * `id -> { mac, linux }` raw cell text. The matrix is the shared install
 * surface for every non-standalone (toolbox) tool — install commands live
 * there, NOT in the per-tool `### {id}` prose sections, so body parity for a
 * toolbox tool reads its matrix row. Rows look like
 * `| ``id`` | mac cell | linux cell |`; a literal pipe inside a cell is
 * markdown-escaped as `\|`, so the split honours the escape. Parsing is scoped
 * to the region after the `Install commands:` marker up to the next `## `
 * heading so no other backtick-first-cell table is mistaken for the matrix.
 */
export function parseInstallMatrix(toolboxBody: string): Map<string, { mac: string; linux: string }> {
  const out = new Map<string, { mac: string; linux: string }>();
  const lines = toolboxBody.split("\n");
  let inMatrix = false;
  for (const line of lines) {
    if (/^Install commands:/.test(line.trim())) {
      inMatrix = true;
      continue;
    }
    if (!inMatrix) continue;
    if (/^##\s/.test(line)) break;
    if (!line.startsWith("|")) continue;
    // Split on unescaped pipes, then restore any escaped `\|` inside a cell.
    const cells = line.split(/(?<!\\)\|/).map((c) => c.replace(/\\\|/g, "|").trim());
    // cells[0] is the empty span before the leading pipe; the id cell is cells[1].
    if (cells.length < 4) continue;
    const idMatch = /^`([^`]+)`$/.exec(cells[1]);
    if (!idMatch) continue;
    out.set(idMatch[1], { mac: cells[2], linux: cells[3] });
  }
  return out;
}

/**
 * D21-SA21.7-02 sub-check 1 — install-command body parity. For a standalone
 * tool, assert every registry install command (all three OS keys) appears
 * verbatim (sudo-normalised substring) in the skill body. For a toolbox tool,
 * assert the mac + linux registry commands appear in the shared install-matrix
 * cell (the matrix carries no Windows column). A `same` linux cell is resolved
 * to the mac cell before comparison. Returns advisories, never throws.
 */
export function installBodyParityAdvisories(
  meta: CliToolMeta,
  standaloneBody: string | null,
  matrixRow: { mac: string; linux: string } | undefined,
): Advisory[] {
  const adv: Advisory[] = [];
  if (STANDALONE_TOOLS.has(meta.id)) {
    // A missing standalone skill is already a structural Failure — skip here.
    if (standaloneBody === null) return adv;
    const hay = normalizeInstallCmd(standaloneBody);
    for (const os of ["mac", "linux", "win"] as const) {
      for (const cmd of meta.install[os] ?? []) {
        if (!hay.includes(normalizeInstallCmd(cmd.command))) {
          adv.push({
            file: `skills/${PER_TOOL_PREFIX}${meta.id}/SKILL.md`,
            kind: "install-body-parity",
            detail: `${meta.id} ${os} install command not surfaced verbatim in the skill body: ${JSON.stringify(cmd.command)}`,
          });
        }
      }
    }
    return adv;
  }
  if (!matrixRow) {
    adv.push({
      file: `skills/${TOOLBOX_DIR}/SKILL.md`,
      kind: "install-body-parity",
      detail: `${meta.id} has no row in the toolbox install-command matrix`,
    });
    return adv;
  }
  for (const os of ["mac", "linux"] as const) {
    const cmds = meta.install[os] ?? [];
    if (cmds.length === 0) continue;
    let cellRaw = matrixRow[os];
    // "same" in a linux cell is shorthand for "same as the mac cell".
    if (os === "linux" && cellRaw.replace(/`/g, "").trim().toLowerCase().startsWith("same")) {
      cellRaw = matrixRow.mac;
    }
    const hay = normalizeInstallCmd(cellRaw);
    const ok = cmds.some((c) => hay.includes(normalizeInstallCmd(c.command)));
    if (!ok) {
      adv.push({
        file: `skills/${TOOLBOX_DIR}/SKILL.md`,
        kind: "install-body-parity",
        detail: `${meta.id} ${os} install-matrix cell does not contain the registry command ${JSON.stringify(cmds[0].command)} (cell: ${JSON.stringify(matrixRow[os])})`,
      });
    }
  }
  return adv;
}

/**
 * D21-SA21.7-02 sub-check 2 — standalone security-surface parity. The same
 * assertions `checkToolbox` runs against toolbox `### {id}` sections
 * (:323-334), extended to the standalone skill body: when the registry pins a
 * `minVersion` the body must surface the bare floor, and when it attaches a
 * `securityNote` the body must surface an advisory id from the note or a
 * marker keyword. Reuses the toolbox check's `bareVersion` /
 * `securityNoteIdentifiers` / `SECURITY_MARKER_KEYWORDS` helpers.
 */
export function standaloneSecuritySurfaceAdvisories(meta: CliToolMeta, body: string): Advisory[] {
  const adv: Advisory[] = [];
  const file = `skills/${PER_TOOL_PREFIX}${meta.id}/SKILL.md`;
  const lower = body.toLowerCase();
  if (meta.minVersion) {
    const floor = bareVersion(meta.minVersion);
    if (floor.length > 0 && !lower.includes(floor.toLowerCase())) {
      adv.push({
        file,
        kind: "standalone-security-surface",
        detail: `${meta.id} registry minVersion=${JSON.stringify(meta.minVersion)} but the skill body does not surface the floor "${floor}"`,
      });
    }
  }
  if (meta.securityNote) {
    const ids = securityNoteIdentifiers(meta.securityNote);
    const hasId = ids.some((id) => lower.includes(id.toLowerCase()));
    const hasKeyword = SECURITY_MARKER_KEYWORDS.some((kw) => lower.includes(kw));
    if (!hasId && !hasKeyword) {
      adv.push({
        file,
        kind: "standalone-security-surface",
        detail: `${meta.id} registry securityNote present but the skill body surfaces no advisory id (${ids.join(", ") || "none in note"}) or marker keyword`,
      });
    }
  }
  return adv;
}

/**
 * The token-cost empirical claim the CLI-tool skills carry (renderer emits it
 * in the `## Token Cost` section). A skill making this claim with no
 * `## References` section is flagged (D5-SA5.6-07: 4 CLI skills assert it with
 * no dated source).
 */
const TOKEN_COST_CLAIM = "98.7% token reduction";

/**
 * D5-SA5.6-07 — References currency. For a CLI skill: every URL/file entry in
 * its `## References` section must carry an access date (`accessed:` or a bare
 * `YYYY-MM-DD`); an undated entry is unfalsifiable against the ≤12-month
 * re-verification contract (rigor-contract §Web Research Mandate). A skill that
 * makes the token-cost empirical claim but has no `## References` at all is
 * flagged too. Scope is the CLI skills this gate owns (5 standalone + toolbox);
 * the 11 CQ-verify skills are a separate probe's surface, not this one's.
 */
export function referencesCurrencyAdvisories(fileLabel: string, body: string): Advisory[] {
  const adv: Advisory[] = [];
  const lines = body.split("\n");
  const start = lines.findIndex((l) => /^##\s+References\b/.test(l));
  if (start === -1) {
    if (body.includes(TOKEN_COST_CLAIM)) {
      adv.push({
        file: fileLabel,
        kind: "references-currency",
        detail: `skill makes the "${TOKEN_COST_CLAIM}" empirical claim but has no "## References" section (add a dated source)`,
      });
    }
    return adv;
  }
  for (let i = start + 1; i < lines.length; i++) {
    if (/^##\s/.test(lines[i])) break;
    const line = lines[i];
    if (!/(https?:\/\/|file:\/\/)/.test(line)) continue;
    const dated = /accessed/i.test(line) || /\b\d{4}-\d{2}-\d{2}\b/.test(line);
    if (!dated) {
      adv.push({
        file: fileLabel,
        kind: "references-currency",
        detail: `undated References entry (no "accessed:" / YYYY-MM-DD): ${line.trim().slice(0, 120)}`,
      });
    }
  }
  return adv;
}

/**
 * Read the CLI-skill corpus once and run the three advisory checks. Returns the
 * flattened advisory list; the caller decides reporting + exit semantics.
 */
async function collectAdvisories(): Promise<Advisory[]> {
  const adv: Advisory[] = [];
  const toolbox = await readSkill(TOOLBOX_DIR);
  const matrix = toolbox ? parseInstallMatrix(toolbox.body) : new Map<string, { mac: string; linux: string }>();

  const standaloneBodies = new Map<string, string | null>();
  for (const meta of Object.values(AVAILABLE_CLI_TOOLS) as CliToolMeta[]) {
    if (!STANDALONE_TOOLS.has(meta.id)) continue;
    const skill = await readSkill(`${PER_TOOL_PREFIX}${meta.id}`);
    standaloneBodies.set(meta.id, skill ? skill.body : null);
  }

  for (const meta of Object.values(AVAILABLE_CLI_TOOLS) as CliToolMeta[]) {
    const isStandalone = STANDALONE_TOOLS.has(meta.id);
    const body = isStandalone ? (standaloneBodies.get(meta.id) ?? null) : null;
    adv.push(...installBodyParityAdvisories(meta, body, matrix.get(meta.id)));
    if (isStandalone && body !== null) {
      adv.push(...standaloneSecuritySurfaceAdvisories(meta, body));
      adv.push(...referencesCurrencyAdvisories(`skills/${PER_TOOL_PREFIX}${meta.id}/SKILL.md`, body));
    }
  }
  if (toolbox) {
    adv.push(...referencesCurrencyAdvisories(`skills/${TOOLBOX_DIR}/SKILL.md`, toolbox.body));
  }
  return adv;
}

/** Print the advisory list (non-fatal) to stderr with per-kind tagging. */
function reportAdvisories(advisories: Advisory[]): void {
  // eslint-disable-next-line no-console
  console.error(`validate:cli-skills: ${advisories.length} non-fatal advisory(ies):`);
  for (const a of advisories) {
    // eslint-disable-next-line no-console
    console.error(`  - [${a.kind}] ${a.file}`);
    // eslint-disable-next-line no-console
    console.error(`      ${a.detail}`);
  }
}

async function main(): Promise<void> {
  const failures: Failure[] = [];
  failures.push(...(await checkStandaloneSkills()));
  failures.push(...(await checkSkillsHaveRegistry()));
  failures.push(...(await checkToolbox()));

  const advisories = await collectAdvisories();

  const total = Object.keys(AVAILABLE_CLI_TOOLS).length;
  const checkedSummary = `${total} registry entries checked (${STANDALONE_TOOLS.size} standalone, ${total - STANDALONE_TOOLS.size} toolbox sections)`;

  // Structural failures keep the exit-1 contract unchanged. Advisories, if any,
  // are appended to the report but do not alter the (already non-zero) exit.
  if (failures.length > 0) {
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
    if (advisories.length > 0) reportAdvisories(advisories);
    process.exit(1);
  }

  // Structural pass. When there are also zero advisories the summary is emitted
  // byte-identically to the historical clean line (the D21-SA21.7-F-21.7.7
  // capture contract). When advisories exist the summary reports them so the
  // record no longer overstates coverage as "0 drift" — exit stays 0.
  if (advisories.length === 0) {
    // eslint-disable-next-line no-console
    console.log(`validate:cli-skills: ${checkedSummary}, 0 drift`);
    return;
  }
  // eslint-disable-next-line no-console
  console.log(
    `validate:cli-skills: ${checkedSummary}, 0 structural drift, ${advisories.length} advisory(ies) (install-body / security-surface / references-currency — non-fatal, see below)`,
  );
  reportAdvisories(advisories);
}

// Only auto-run when executed as a script, never when imported by the fixture
// tests in scripts/__tests__/validate-cli-skills.test.ts. `process.argv[1] ?? ""`
// is always a string, so `resolve` cannot throw — no defensive catch needed.
const isMain = resolve(process.argv[1] ?? "") === __filename;

if (isMain) {
  main().catch((err) => {
    // eslint-disable-next-line no-console
    console.error("validate:cli-skills failed:", err);
    process.exit(1);
  });
}
