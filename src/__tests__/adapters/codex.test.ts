import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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
const CLI_SKILLS = [
  "hatch3r-cli-jq",
  "hatch3r-cli-ripgrep",
  "hatch3r-cli-toolbox",
] as const;

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

  it("registers a fresh codex adapter with its production capability row", () => {
    const first = getAdapter("codex");
    const second = getAdapter("codex");

    expect(first).toBeInstanceOf(CodexAdapter);
    expect(first).not.toBe(second);
    expect(first.name).toBe("codex");
    expect(ADAPTER_CAPABILITIES.codex).toEqual({
      agents: true,
      skills: true,
      rules: true,
      hooks: true,
      mcp: true,
      commands: true,
      prompts: false,
      githubAgents: false,
      handoffs: true,
      worktree: WORKTREE_CAPABLE_TOOLS.has("codex"),
      customization: true,
      modelOverride: true,
      effortOverride: true,
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
    expect(paths).not.toContain(".agents/skills/hatch3r-cli-toolbox/SKILL.md");
  });

  it("emits the toolbox when an enabled selection contains a non-standalone tool", async () => {
    const outputs = await new CodexAdapter().generate(
      projectRoot,
      createManifest({
        tools: ["codex"],
        cliTools: { enabled: true, selected: ["curl"] },
      }),
      projectRoot,
    );

    expect(outputs.map((item) => item.path)).toContain(
      ".agents/skills/hatch3r-cli-toolbox/SKILL.md",
    );
  });

  it("does not emit the toolbox when CLI tools are disabled", async () => {
    const outputs = await new CodexAdapter().generate(
      projectRoot,
      createManifest({
        tools: ["codex"],
        cliTools: { enabled: false, selected: ["curl"] },
      }),
      projectRoot,
    );

    expect(outputs.map((item) => item.path)).not.toContain(
      ".agents/skills/hatch3r-cli-toolbox/SKILL.md",
    );
  });

  it("wires the handoff feature to the managed command-skill bridge", async () => {
    const commandsDir = join(projectRoot, "commands");
    await mkdir(commandsDir, { recursive: true });
    await writeFile(
      join(commandsDir, "hatch3r-handoff.md"),
      [
        "---",
        "id: hatch3r-handoff",
        "type: command",
        "description: Manage cross-session Hatcher handoffs.",
        "---",
        "# Handoff",
        "",
        "Prepare, resume, list, complete, or prune handoff state.",
        "",
      ].join("\n"),
      "utf-8",
    );
    const content = selection([]);
    content.items.commands = ["hatch3r-handoff"];

    const enabled = await new CodexAdapter().generate(
      projectRoot,
      createManifest({ tools: ["codex"], content, features: { handoffs: true } }),
      projectRoot,
    );
    const enabledRoot = enabled.find((output) => output.path === "AGENTS.md");
    expect(enabledRoot?.content).toContain("`$hatch3r-command-handoff`");
    expect(enabled.some((output) =>
      output.path === ".agents/skills/hatch3r-command-handoff/SKILL.md"
    )).toBe(true);

    const disabled = await new CodexAdapter().generate(
      projectRoot,
      createManifest({ tools: ["codex"], content, features: { handoffs: false } }),
      projectRoot,
    );
    expect(disabled.find((output) => output.path === "AGENTS.md")?.content)
      .not.toContain("`$hatch3r-command-handoff`");
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

  it("updates recorded markerless companions but rejects an unrecorded co-tenant collision", async () => {
    const sourceScript = join(projectRoot, "skills", "hatch3r-alpha", "scripts", "helper.sh");
    await mkdir(join(sourceScript, ".."), { recursive: true });
    await writeFile(sourceScript, "echo canonical\n", "utf-8");
    const selected = selection(["hatch3r-alpha"]);
    const firstManifest = createManifest({ tools: ["codex"], content: selected });
    const first = await new CodexAdapter().generate(projectRoot, firstManifest, projectRoot);
    const companion = first.find((output) => output.path.endsWith("/scripts/helper.sh"))!;
    await mkdir(join(projectRoot, companion.path, ".."), { recursive: true });
    await writeFile(join(projectRoot, companion.path), companion.content, "utf-8");

    firstManifest.managedFilesByAdapter = { codex: [companion.path] };
    const update = await new CodexAdapter().generate(projectRoot, firstManifest, projectRoot);
    expect(update.find((output) => output.path === companion.path)?.validatedFullDocument).toBe(true);

    firstManifest.managedFilesByAdapter = { codex: [] };
    await expect(new CodexAdapter().generate(projectRoot, firstManifest, projectRoot)).rejects.toThrow(
      /already exists but is not recorded or marked as Hatcher-owned/,
    );
    expect(await readFile(join(projectRoot, companion.path), "utf-8")).toBe(companion.content);
  });
});
