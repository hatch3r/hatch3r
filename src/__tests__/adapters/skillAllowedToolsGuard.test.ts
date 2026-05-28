// D9-H-6 (Cycle 10 D9, Pillar P1): unit tests for the `validateSkillAllowedTools`
// guard. The guard enforces the adapter-emission contract that a skill wrapping
// a shell binary (`cli_tool.bin`) MUST declare a non-empty `allowed_tools` array
// so the Copilot adapter can render the `allowed-tools:` pre-approval line —
// without it, every Copilot session re-prompts for the wrapped binary.
//
// Lives under __tests__/adapters/ because it gates the same `allowed-tools`
// skill-frontmatter field the Copilot adapter (src/adapters/base.ts +
// copilot.ts) renders; the guard itself is exported from
// src/cli/commands/validate.ts.
import { describe, it, expect, afterEach } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { validateSkillAllowedTools } from "../../cli/commands/validate.js";

interface Result {
  errors: string[];
  warnings: string[];
}

function emptyResult(): Result {
  return { errors: [], warnings: [] };
}

describe("validateSkillAllowedTools (D9-H-6)", () => {
  let tempDir: string;

  afterEach(async () => {
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  /** Stage a single skill dir with the supplied SKILL.md frontmatter lines. */
  async function stageSkill(skillId: string, fmLines: string[]): Promise<string> {
    tempDir = await mkdtemp(join(tmpdir(), "hatch3r-skillguard-"));
    const skillDir = join(tempDir, "skills", skillId);
    await mkdir(skillDir, { recursive: true });
    const fm = ["---", ...fmLines, "---"].join("\n");
    await writeFile(join(skillDir, "SKILL.md"), `${fm}\n# ${skillId}\n\nbody\n`, "utf-8");
    return tempDir;
  }

  it("errors when an execute-capable skill omits allowed_tools", async () => {
    const root = await stageSkill("hatch3r-cli-ripgrep", [
      "id: hatch3r-cli-ripgrep",
      "type: skill",
      "description: d",
      "cli_tool:",
      "  id: ripgrep",
      "  bin: rg",
    ]);
    const result = emptyResult();
    await validateSkillAllowedTools(root, result);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatch(/wraps shell binary "rg"/);
    expect(result.errors[0]).toMatch(/declares no allowed_tools/);
    expect(result.errors[0]).toMatch(/D9-H-6/);
  });

  it("passes when an execute-capable skill declares allowed_tools (underscore)", async () => {
    const root = await stageSkill("hatch3r-cli-ripgrep", [
      "id: hatch3r-cli-ripgrep",
      "type: skill",
      "description: d",
      'allowed_tools: ["rg"]',
      "cli_tool:",
      "  id: ripgrep",
      "  bin: rg",
    ]);
    const result = emptyResult();
    await validateSkillAllowedTools(root, result);
    expect(result.errors).toEqual([]);
  });

  it("passes when an execute-capable skill declares allowed-tools (hyphen)", async () => {
    const root = await stageSkill("hatch3r-cli-jq", [
      "id: hatch3r-cli-jq",
      "type: skill",
      "description: d",
      'allowed-tools: ["jq"]',
      "cli_tool:",
      "  id: jq",
      "  bin: jq",
    ]);
    const result = emptyResult();
    await validateSkillAllowedTools(root, result);
    expect(result.errors).toEqual([]);
  });

  it("exempts reference skills that wrap no executable (no cli_tool.bin)", async () => {
    const root = await stageSkill("hatch3r-cli-toolbox", [
      "id: hatch3r-cli-toolbox",
      "type: skill",
      "description: a category-indexed reference for many CLI tools",
    ]);
    const result = emptyResult();
    await validateSkillAllowedTools(root, result);
    expect(result.errors).toEqual([]);
  });

  it("errors when allowed_tools is present but empty", async () => {
    const root = await stageSkill("hatch3r-cli-fd", [
      "id: hatch3r-cli-fd",
      "type: skill",
      "description: d",
      "allowed_tools: []",
      "cli_tool:",
      "  id: fd",
      "  bin: fd",
    ]);
    const result = emptyResult();
    await validateSkillAllowedTools(root, result);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatch(/wraps shell binary "fd"/);
  });

  it("treats a cli_tool block without a bin string as non-execute (exempt)", async () => {
    const root = await stageSkill("hatch3r-cli-noexec", [
      "id: hatch3r-cli-noexec",
      "type: skill",
      "description: d",
      "cli_tool:",
      "  id: noexec",
      "  category: reference",
    ]);
    const result = emptyResult();
    await validateSkillAllowedTools(root, result);
    expect(result.errors).toEqual([]);
  });

  it("is a no-op when the skills directory is absent", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "hatch3r-skillguard-empty-"));
    const result = emptyResult();
    await validateSkillAllowedTools(tempDir, result);
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  it("flags only the offending skill in a mixed set", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "hatch3r-skillguard-mixed-"));
    const good = join(tempDir, "skills", "hatch3r-cli-gh");
    const bad = join(tempDir, "skills", "hatch3r-cli-fzf");
    await mkdir(good, { recursive: true });
    await mkdir(bad, { recursive: true });
    await writeFile(
      join(good, "SKILL.md"),
      '---\nid: hatch3r-cli-gh\ntype: skill\ndescription: d\nallowed_tools: ["gh"]\ncli_tool:\n  id: gh\n  bin: gh\n---\n# gh\n',
      "utf-8",
    );
    await writeFile(
      join(bad, "SKILL.md"),
      "---\nid: hatch3r-cli-fzf\ntype: skill\ndescription: d\ncli_tool:\n  id: fzf\n  bin: fzf\n---\n# fzf\n",
      "utf-8",
    );
    const result = emptyResult();
    await validateSkillAllowedTools(tempDir, result);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatch(/hatch3r-cli-fzf/);
    expect(result.errors[0]).not.toMatch(/hatch3r-cli-gh/);
  });
});
