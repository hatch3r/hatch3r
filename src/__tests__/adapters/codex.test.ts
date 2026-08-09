import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import { CodexAdapter } from "../../adapters/codex.js";
import {
  ADAPTER_CAPABILITIES,
  getAdapter,
} from "../../adapters/index.js";
import { createManifest } from "../../manifest/hatchJson.js";
import { WORKTREE_CAPABLE_TOOLS, type ContentSelection } from "../../types.js";

const REGULAR_SKILLS = ["hatch3r-alpha", "hatch3r-beta"] as const;
const CLI_SKILLS = ["hatch3r-cli-jq", "hatch3r-cli-ripgrep"] as const;

function selection(skills: string[]): ContentSelection {
  return {
    preset: "custom",
    projectType: "brownfield",
    teamSize: "solo",
    items: {
      agents: [],
      skills,
      rules: [],
      commands: [],
      prompts: [],
      hooks: [],
      githubAgents: [],
    },
  };
}

describe("CodexAdapter", () => {
  let projectRoot: string;

  beforeEach(async () => {
    projectRoot = await mkdtemp(join(tmpdir(), "hatch3r-codex-adapter-"));
    for (const id of [...REGULAR_SKILLS, ...CLI_SKILLS]) {
      const skillDir = join(projectRoot, "skills", id);
      await mkdir(skillDir, { recursive: true });
      await writeFile(
        join(skillDir, "SKILL.md"),
        `---\nid: ${id}\ndescription: "Description for ${id}"\nmodel: gpt-5\n---\n# ${id}\n\nBody for ${id}.\n`,
        "utf-8",
      );
    }
  });

  afterEach(async () => {
    await rm(projectRoot, { recursive: true, force: true });
  });

  it("registers a fresh codex adapter with a truthful skills-only capability row", () => {
    const first = getAdapter("codex");
    const second = getAdapter("codex");

    expect(first).toBeInstanceOf(CodexAdapter);
    expect(first).not.toBe(second);
    expect(first.name).toBe("codex");
    expect(ADAPTER_CAPABILITIES.codex).toEqual({
      agents: false,
      skills: true,
      rules: false,
      hooks: false,
      mcp: false,
      commands: false,
      prompts: false,
      githubAgents: false,
      handoffs: false,
      worktree: WORKTREE_CAPABLE_TOOLS.has("codex"),
      customization: true,
      modelOverride: false,
      effortOverride: false,
      nativeQuestionTool: false,
      cliTools: true,
    });
  });

  it("emits only Codex repo skills with byte-zero name and description frontmatter", async () => {
    const outputs = await new CodexAdapter().generate(
      projectRoot,
      createManifest({ tools: ["codex"] }),
      projectRoot,
    );

    expect(outputs.map((item) => item.path).sort()).toEqual([
      ".agents/skills/hatch3r-alpha/SKILL.md",
      ".agents/skills/hatch3r-beta/SKILL.md",
    ]);
    expect(outputs.some((item) => item.path.startsWith(".codex/"))).toBe(false);

    const alpha = outputs.find(
      (item) => item.path === ".agents/skills/hatch3r-alpha/SKILL.md",
    );
    expect(alpha).toBeDefined();
    expect(alpha!.content.startsWith("---\nname: hatch3r-alpha\ndescription: ")).toBe(true);
    const frontmatter = alpha!.content.match(/^---\n([\s\S]*?)\n---/)?.[1];
    expect(frontmatter).toBeDefined();
    expect(parseYaml(frontmatter!)).toEqual({
      name: "hatch3r-alpha",
      description: "Description for hatch3r-alpha",
    });
    expect(alpha!.managedContent).toContain(
      "# hatch3r-alpha\n\nBody for hatch3r-alpha.",
    );
  });

  it("honors the skills feature flag and content selection", async () => {
    const adapter = new CodexAdapter();
    const disabled = await adapter.generate(
      projectRoot,
      createManifest({ tools: ["codex"], features: { skills: false } }),
      projectRoot,
    );
    expect(disabled).toEqual([]);

    const selected = await adapter.generate(
      projectRoot,
      createManifest({
        tools: ["codex"],
        content: selection(["hatch3r-beta"]),
      }),
      projectRoot,
    );
    expect(selected.map((item) => item.path)).toEqual([
      ".agents/skills/hatch3r-beta/SKILL.md",
    ]);
  });

  it("filters CLI skills through cliTools without dropping regular skills", async () => {
    const outputs = await new CodexAdapter().generate(
      projectRoot,
      createManifest({
        tools: ["codex"],
        cliTools: { enabled: true, selected: ["jq"] },
      }),
      projectRoot,
    );
    const paths = outputs.map((item) => item.path);

    expect(paths).toContain(".agents/skills/hatch3r-alpha/SKILL.md");
    expect(paths).toContain(".agents/skills/hatch3r-beta/SKILL.md");
    expect(paths).toContain(".agents/skills/hatch3r-cli-jq/SKILL.md");
    expect(paths).not.toContain(".agents/skills/hatch3r-cli-ripgrep/SKILL.md");
  });

  it("applies skill customization to metadata, body, and enablement", async () => {
    const customizationDir = join(projectRoot, ".hatch3r", "skills");
    await mkdir(customizationDir, { recursive: true });
    await writeFile(
      join(customizationDir, "hatch3r-alpha.customize.yaml"),
      "description: Customized alpha description\n",
      "utf-8",
    );
    await writeFile(
      join(customizationDir, "hatch3r-alpha.customize.md"),
      "Use the project-specific alpha procedure.",
      "utf-8",
    );
    await writeFile(
      join(customizationDir, "hatch3r-beta.customize.yaml"),
      "enabled: false\n",
      "utf-8",
    );

    const outputs = await new CodexAdapter().generate(
      projectRoot,
      createManifest({ tools: ["codex"] }),
      projectRoot,
    );
    expect(outputs).toHaveLength(1);
    expect(outputs[0]!.content).toContain(
      'description: "Customized alpha description"',
    );
    expect(outputs[0]!.content).toContain("## Project Customizations");
    expect(outputs[0]!.content).toContain(
      "Use the project-specific alpha procedure.",
    );
  });
});
