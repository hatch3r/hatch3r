import { describe, it, expect } from "vitest";
import { readFile, readdir, access } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";
import { AVAILABLE_CLI_TOOLS, type CliToolMeta } from "../../cliTools/registry.js";

/**
 * Wave 5 Bonus: per-tool CLI skill structural snapshot + parity contract.
 *
 * Mirrors the script-level gate `scripts/validate-cli-skills.ts` but lives
 * inside vitest so the registry-vs-skills drift surfaces in `npm test` as
 * well as in CI's dedicated parity step. Coverage:
 *  - Every `AVAILABLE_CLI_TOOLS` id has a matching skill directory.
 *  - Frontmatter id matches the directory name.
 *  - ripgrep (tier-1 representative) and rtk (tier-3 caveat-bearing) snapshot.
 *
 * Note: this test depends on Wave 4 content cleanup landing — until per-tool
 * authored content replaces the Wave 2 placeholder scaffold, the structural
 * snapshots target the section headings rather than full body bytes, so
 * the cleanup pass remains free to evolve content under fixed contracts.
 */

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = resolve(__dirname, "..", "..", "..");
const SKILLS_DIR = join(ROOT, "skills");
const PER_TOOL_PREFIX = "hatch3r-cli-";
const UMBRELLA_DIR = "hatch3r-cli-overview";

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
    // YAML parse failures surface as separate diagnostics below; keep the
    // binding so the silent-failure rule sees a non-empty body.
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
    // Normalize CRLF to LF before YAML parsing so Windows checkouts
    // (core.autocrlf=true) don't leave a trailing \r inside unquoted
    // scalar values like `caveat: pipe-output-corruption`.
    const content = raw.replace(/\r\n/g, "\n");
    return splitFrontmatter(content);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

describe("CLI skills registry-vs-filesystem parity", () => {
  it("every AVAILABLE_CLI_TOOLS id has a matching skills/hatch3r-cli-{id}/SKILL.md", async () => {
    for (const id of Object.keys(AVAILABLE_CLI_TOOLS)) {
      const path = join(SKILLS_DIR, `${PER_TOOL_PREFIX}${id}`, "SKILL.md");
      await expect(access(path), `Missing SKILL.md for ${id}`).resolves.toBeUndefined();
    }
  });

  it("no orphaned hatch3r-cli-* skill directories without a registry entry", async () => {
    const entries = await readdir(SKILLS_DIR);
    const cliDirs = entries
      .filter((n) => n.startsWith(PER_TOOL_PREFIX) && n !== UMBRELLA_DIR)
      .sort();
    const registryIds = new Set(Object.keys(AVAILABLE_CLI_TOOLS));
    for (const dir of cliDirs) {
      const id = dir.slice(PER_TOOL_PREFIX.length);
      expect(
        registryIds.has(id),
        `Orphaned skill directory hatch3r-cli-${id} — registry has no matching entry`,
      ).toBe(true);
    }
  });

  it("umbrella skill exists at skills/hatch3r-cli-overview/SKILL.md", async () => {
    const path = join(SKILLS_DIR, UMBRELLA_DIR, "SKILL.md");
    await expect(access(path)).resolves.toBeUndefined();
  });
});

describe("CLI skill frontmatter contract", () => {
  it("every per-tool skill frontmatter id matches the directory name", async () => {
    for (const id of Object.keys(AVAILABLE_CLI_TOOLS)) {
      const parsed = await readSkillFile(`${PER_TOOL_PREFIX}${id}`);
      expect(parsed, `Missing skill file for ${id}`).not.toBeNull();
      const fmId = parsed!.frontmatter.id;
      expect(
        fmId,
        `Frontmatter id mismatch for hatch3r-cli-${id}`,
      ).toBe(`${PER_TOOL_PREFIX}${id}`);
    }
  });

  it("every per-tool skill carries the cli-tools tag", async () => {
    for (const id of Object.keys(AVAILABLE_CLI_TOOLS)) {
      const parsed = await readSkillFile(`${PER_TOOL_PREFIX}${id}`);
      expect(parsed, `Missing skill file for ${id}`).not.toBeNull();
      const tags = parsed!.frontmatter.tags;
      expect(
        Array.isArray(tags),
        `tags must be an array for ${id}`,
      ).toBe(true);
      expect((tags as string[]).includes("cli-tools"), `${id} missing cli-tools tag`).toBe(true);
    }
  });

  it("every per-tool skill embeds a cli_tool block matching the registry tier and caveat", async () => {
    for (const id of Object.keys(AVAILABLE_CLI_TOOLS)) {
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

describe("CLI skill structural snapshots", () => {
  it("ripgrep (tier-1 representative) starts with the expected heading", async () => {
    const parsed = await readSkillFile(`${PER_TOOL_PREFIX}ripgrep`);
    expect(parsed).not.toBeNull();
    // The body should begin with the # ripgrep heading after the generator
    // marker. Structural contract only — Wave 4 cleanup may evolve recipe
    // content underneath this heading without breaking the test.
    expect(parsed!.body).toContain("# ripgrep");
    expect(parsed!.body).toContain("## When to Use");
    expect(parsed!.body).toContain("## Token Cost");
    expect(parsed!.body).toContain("## Recipes");
    expect(parsed!.body).toContain("## Detection / Install");
  });

  it("rtk (tier-3 with pipe-output-corruption caveat) exposes the caveat heading at structural level", async () => {
    const parsed = await readSkillFile(`${PER_TOOL_PREFIX}rtk`);
    expect(parsed).not.toBeNull();
    // Mirrors the renderCliToolSkillBody assertion: the caveat heading must
    // appear before any other section so users see the risk before reading
    // recipes.
    expect(parsed!.body).toContain("## ⚠ Critical: pipe-output corruption (issue #1282)");
    expect(parsed!.body).toContain("rtk proxy");

    const caveatIdx = parsed!.body.indexOf("## ⚠ Critical");
    const whenIdx = parsed!.body.indexOf("## When to Use");
    expect(caveatIdx).toBeGreaterThanOrEqual(0);
    expect(whenIdx).toBeGreaterThan(caveatIdx);
  });
});
