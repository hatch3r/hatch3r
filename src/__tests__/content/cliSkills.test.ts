import { describe, it, expect } from "vitest";
import { readFile, readdir, access } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";
import {
  AVAILABLE_CLI_TOOLS,
  STANDALONE_CLI_TOOLS,
  type CliToolMeta,
} from "../../cliTools/registry.js";

/**
 * v1.9.0 toolbox consolidation: per-tool CLI skill structural snapshot +
 * parity contract. Five high-frequency tools retain standalone skill files;
 * every other registry entry lives as a `### {id}` section in
 * `skills/hatch3r-cli-toolbox/SKILL.md`.
 *
 * Mirrors the script-level gate `scripts/validate-cli-skills.ts`.
 */

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = resolve(__dirname, "..", "..", "..");
const SKILLS_DIR = join(ROOT, "skills");
const PER_TOOL_PREFIX = "hatch3r-cli-";
const TOOLBOX_DIR = "hatch3r-cli-toolbox";

const STANDALONE_TOOLS = new Set<string>(STANDALONE_CLI_TOOLS);

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
  } catch (err) {
    void err;
  }
  return { frontmatter, body };
}

async function readSkillFile(dir: string): Promise<{
  frontmatter: Record<string, unknown>;
  body: string;
} | null> {
  const path = join(SKILLS_DIR, dir, "SKILL.md");
  try {
    const raw = await readFile(path, "utf-8");
    const content = raw.replace(/\r\n/g, "\n");
    return splitFrontmatter(content);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

describe("CLI skills registry-vs-filesystem parity (v1.9.0 toolbox)", () => {
  it("every STANDALONE tool has a matching skills/hatch3r-cli-{id}/SKILL.md", async () => {
    for (const id of STANDALONE_TOOLS) {
      const path = join(SKILLS_DIR, `${PER_TOOL_PREFIX}${id}`, "SKILL.md");
      await expect(access(path), `Missing standalone SKILL.md for ${id}`).resolves.toBeUndefined();
    }
  });

  it("no non-standalone per-tool skill dirs (toolbox consolidation)", async () => {
    const entries = await readdir(SKILLS_DIR);
    const cliDirs = entries
      .filter((n) => n.startsWith(PER_TOOL_PREFIX) && n !== TOOLBOX_DIR)
      .sort();
    for (const dir of cliDirs) {
      const id = dir.slice(PER_TOOL_PREFIX.length);
      expect(
        STANDALONE_TOOLS.has(id),
        `Per-tool skill dir hatch3r-cli-${id} should be a section in hatch3r-cli-toolbox`,
      ).toBe(true);
    }
  });

  it("toolbox skill exists at skills/hatch3r-cli-toolbox/SKILL.md", async () => {
    const path = join(SKILLS_DIR, TOOLBOX_DIR, "SKILL.md");
    await expect(access(path)).resolves.toBeUndefined();
  });

  it("toolbox body contains a section for every non-standalone registry tool", async () => {
    const parsed = await readSkillFile(TOOLBOX_DIR);
    expect(parsed).not.toBeNull();
    for (const meta of Object.values(AVAILABLE_CLI_TOOLS) as CliToolMeta[]) {
      if (STANDALONE_TOOLS.has(meta.id)) continue;
      expect(
        parsed!.body.includes(`### ${meta.id}`),
        `toolbox missing "### ${meta.id}" section`,
      ).toBe(true);
    }
  });
});

/**
 * Mirror of `scripts/validate-cli-skills.ts::checkToolbox` security-parity
 * branch (D15-10, SA15.7-F2). Returns the `### {id}` toolbox section body, or
 * null when the heading is absent. Terminates at the next level-2 (`## `) or
 * level-3 (`### `) heading; level-4 (`#### `) sub-headings belong to the tool.
 */
function toolboxSection(toolboxBody: string, id: string): string | null {
  const lines = toolboxBody.split("\n");
  const esc = id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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

function bareVersion(minVersion: string): string {
  return minVersion.replace(/^[><=~^\s]+/, "").trim();
}

function securityNoteIdentifiers(note: string): string[] {
  const matches =
    note.match(/\b(?:CVE-\d{4}-\d+|GHSA-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4})\b/gi) ?? [];
  return [...new Set(matches.map((s) => s.toUpperCase()))];
}

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

function sectionSurfacesSecurityMarker(sectionLower: string, securityNote: string): boolean {
  const ids = securityNoteIdentifiers(securityNote);
  const hasId = ids.some((id) => sectionLower.includes(id.toLowerCase()));
  const hasKeyword = SECURITY_MARKER_KEYWORDS.some((kw) => sectionLower.includes(kw));
  return hasId || hasKeyword;
}

describe("Toolbox security-parity with registry (D15-10)", () => {
  it("every non-standalone tool with minVersion surfaces the version floor in its section", async () => {
    const parsed = await readSkillFile(TOOLBOX_DIR);
    expect(parsed).not.toBeNull();
    for (const meta of Object.values(AVAILABLE_CLI_TOOLS) as CliToolMeta[]) {
      if (STANDALONE_TOOLS.has(meta.id) || !meta.minVersion) continue;
      const section = toolboxSection(parsed!.body, meta.id);
      expect(section, `missing "### ${meta.id}" section`).not.toBeNull();
      const floor = bareVersion(meta.minVersion);
      expect(
        section!.toLowerCase().includes(floor.toLowerCase()),
        `toolbox "### ${meta.id}" section must surface version floor "${floor}" (registry minVersion=${meta.minVersion})`,
      ).toBe(true);
    }
  });

  it("every non-standalone tool with a securityNote surfaces a security marker in its section", async () => {
    const parsed = await readSkillFile(TOOLBOX_DIR);
    expect(parsed).not.toBeNull();
    for (const meta of Object.values(AVAILABLE_CLI_TOOLS) as CliToolMeta[]) {
      if (STANDALONE_TOOLS.has(meta.id) || !meta.securityNote) continue;
      const section = toolboxSection(parsed!.body, meta.id);
      expect(section, `missing "### ${meta.id}" section`).not.toBeNull();
      expect(
        sectionSurfacesSecurityMarker(section!.toLowerCase(), meta.securityNote),
        `toolbox "### ${meta.id}" section must surface a CVE/GHSA id or unsigned-channel marker from its registry securityNote`,
      ).toBe(true);
    }
  });

  it("parity assertion catches a section that drops the floor and marker", () => {
    // Synthetic deficient section: no version number, no CVE/GHSA id, no
    // unsigned/signed keyword — proves the gate logic is not vacuous.
    const deficient = "- **When to use:** something.\n- **Recipe:** `tool run`.\n";
    expect(deficient.toLowerCase().includes("29.5.2")).toBe(false);
    expect(
      sectionSurfacesSecurityMarker(
        deficient.toLowerCase(),
        "CVE-2026-32288: crafted manifest DoS; unsigned install channel.",
      ),
    ).toBe(false);
    // And a compliant section passes both checks.
    const compliant =
      "- **Version floor:** >=29.5.2 — earlier engines carry CVE-2026-32288. Unsigned install channel on linux.\n";
    expect(compliant.toLowerCase().includes("29.5.2")).toBe(true);
    expect(
      sectionSurfacesSecurityMarker(
        compliant.toLowerCase(),
        "CVE-2026-32288: crafted manifest DoS; unsigned install channel.",
      ),
    ).toBe(true);
  });
});

describe("Standalone CLI skill frontmatter contract", () => {
  it("standalone skill frontmatter id matches the directory name", async () => {
    for (const id of STANDALONE_TOOLS) {
      const parsed = await readSkillFile(`${PER_TOOL_PREFIX}${id}`);
      expect(parsed, `Missing skill file for ${id}`).not.toBeNull();
      const fmId = parsed!.frontmatter.id;
      expect(fmId, `Frontmatter id mismatch for hatch3r-cli-${id}`).toBe(`${PER_TOOL_PREFIX}${id}`);
    }
  });

  it("standalone skills carry the cli-tools tag", async () => {
    for (const id of STANDALONE_TOOLS) {
      const parsed = await readSkillFile(`${PER_TOOL_PREFIX}${id}`);
      expect(parsed, `Missing skill file for ${id}`).not.toBeNull();
      const tags = parsed!.frontmatter.tags;
      expect(Array.isArray(tags), `tags must be an array for ${id}`).toBe(true);
      expect((tags as string[]).includes("cli-tools"), `${id} missing cli-tools tag`).toBe(true);
    }
  });

  it("standalone skills embed a cli_tool block matching the registry tier and caveat", async () => {
    for (const id of STANDALONE_TOOLS) {
      const registry = AVAILABLE_CLI_TOOLS[id as keyof typeof AVAILABLE_CLI_TOOLS] as CliToolMeta;
      const parsed = await readSkillFile(`${PER_TOOL_PREFIX}${id}`);
      const cliBlock = parsed?.frontmatter.cli_tool as Record<string, unknown> | undefined;
      expect(cliBlock, `cli_tool block missing for ${id}`).toBeDefined();
      expect(cliBlock!.tier, `tier mismatch for ${id}`).toBe(registry.tier);
      if (registry.caveat) {
        expect(cliBlock!.caveat, `caveat mismatch for ${id}`).toBe(registry.caveat);
      }
    }
  });
});

describe("Standalone CLI skill structural snapshots", () => {
  it("ripgrep (representative standalone) starts with the expected heading and sections", async () => {
    const parsed = await readSkillFile(`${PER_TOOL_PREFIX}ripgrep`);
    expect(parsed).not.toBeNull();
    expect(parsed!.body).toContain("# ripgrep");
    expect(parsed!.body).toContain("## When to Use");
    expect(parsed!.body).toContain("## Token Cost");
    expect(parsed!.body).toContain("## Recipes");
    expect(parsed!.body).toContain("## Detection / Install");
  });

  it("toolbox skill surfaces the rtk caveat heading (consolidated from former hatch3r-cli-rtk)", async () => {
    const parsed = await readSkillFile(TOOLBOX_DIR);
    expect(parsed).not.toBeNull();
    // rtk's pipe-output-corruption caveat must still surface in the toolbox.
    expect(parsed!.body).toContain("rtk proxy");
    expect(parsed!.body.toLowerCase()).toContain("issue #1282");
  });
});
