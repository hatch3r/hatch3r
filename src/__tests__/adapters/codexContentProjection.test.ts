import { afterEach, expect, it } from "vitest";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { CanonicalFile } from "../../types.js";
import { HatchError } from "../../types.js";
import { filterUserFacing, readCanonicalFiles } from "../../adapters/canonical.js";
import {
  CodexContentProjectionError,
  buildCodexCommandSkillIds,
  buildCodexDiscoveryCatalog,
  projectCodexContent,
  translateCodexNativeContent,
} from "../../adapters/codexContentProjection.js";
import { CodexProjectionError } from "../../adapters/codexProjectionError.js";
import { resolveCodexReference } from "../../adapters/codexReference.js";
import { assertFullCodexProjection } from "./codexContentProjectionAssertions.js";

const REPO_ROOT = resolve(import.meta.dirname, "../../..");
const tempRoots: string[] = [];

async function tempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "hatch3r-codex-content-"));
  tempRoots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function file(
  id: string,
  type: "skill" | "command",
  sourcePath: string,
  description = `Description for ${id}`,
  content = `# ${id}\n`,
): CanonicalFile {
  return {
    id,
    type,
    frontmatterType: type,
    description,
    content,
    rawContent: `---\nid: ${id}\ntype: ${type}\ndescription: ${description}\n---\n${content}`,
    sourcePath,
  };
}

  it("classifies shared canonical references as resolved, unsupported, or self", () => {
    const targets = new Map([["rules/hatch3r-demo.md", ".hatch3r/codex-support/rules/hatch3r-demo.md"]]);
    const resolved = resolveCodexReference("rules/hatch3r-demo.md", { targets });
    const unsupported = resolveCodexReference("rules/missing.md", { targets });
    const self = resolveCodexReference("rules/hatch3r-demo.md", {
      targets,
      currentTarget: ".hatch3r/codex-support/rules/hatch3r-demo.md",
    });

    expect(resolved).toEqual({
      status: "resolved",
      canonicalKey: "rules/hatch3r-demo.md",
      target: ".hatch3r/codex-support/rules/hatch3r-demo.md",
    });
    expect(unsupported).toEqual({ status: "unsupported", canonicalKey: "rules/missing.md" });
    expect(self).toEqual({
      status: "self",
      canonicalKey: "rules/hatch3r-demo.md",
      target: ".hatch3r/codex-support/rules/hatch3r-demo.md",
    });
  });

  it("uses the shared structured validation error for projection failures", () => {
    const error = new CodexProjectionError("invalid projection");
    expect(error).toBeInstanceOf(HatchError);
    expect(error.errorCode).toBe("VALIDATION_ERROR");
    expect(error.exitCode).toBe(64);
  });

  it("projects the actual selected corpus, companions, closure, and command bridges deterministically", async () => {
    const warnings: string[] = [];
    const skills = await readCanonicalFiles(REPO_ROOT, "skills", warnings, undefined, { strict: true });
    const commands = filterUserFacing(
      await readCanonicalFiles(REPO_ROOT, "commands", warnings, undefined, { strict: true }),
      "command",
      join(REPO_ROOT, "commands"),
    );
    const agents = filterUserFacing(
      await readCanonicalFiles(REPO_ROOT, "agents", warnings, undefined, { strict: true }),
      "agent",
      join(REPO_ROOT, "agents"),
    );
    const availableAgentIds = new Set(agents.map((agent) => agent.id));
    const projectRoot = await tempRoot();

    const first = await projectCodexContent({
      canonicalRoot: REPO_ROOT,
      projectRoot,
      skills,
      commands,
      availableAgentIds,
    });
    const second = await projectCodexContent({
      canonicalRoot: REPO_ROOT,
      projectRoot,
      skills,
      commands,
      availableAgentIds,
    });

    assertFullCodexProjection(first, second, skills.length, commands.length);
  }, 30_000);

  it("accounts for exact Unicode discovery serialization and compacts metadata without touching bodies", () => {
    const entries = Array.from({ length: 12 }, (_, index) => ({
      name: `hatch3r-${index}`,
      description: `Action ${index} 🚀 ` + "long description ".repeat(30),
      path: `.agents/skills/hatch3r-${index}/SKILL.md`,
    }));
    const catalog = buildCodexDiscoveryCatalog(entries, 900);

    expect(catalog.compacted).toBe(true);
    expect(catalog.characterCount).toBe(Array.from(catalog.serialized).length);
    expect(catalog.characterCount).toBeLessThanOrEqual(900);
    expect(catalog.serialized).toBe(catalog.entries.map(
      (entry) => `- ${entry.name}: ${entry.description} (file: ${entry.path})\n`,
    ).join(""));
    expect(catalog.entries.every((entry) => entry.fullDescription.includes("long description"))).toBe(true);
  });

  it("fails actionably when names and paths alone exceed the discovery budget", () => {
    expect(() => buildCodexDiscoveryCatalog([
      { name: "hatch3r-a-very-long-name", description: "x", path: ".agents/skills/hatch3r-a-very-long-name/SKILL.md" },
      { name: "hatch3r-another-long-name", description: "y", path: ".agents/skills/hatch3r-another-long-name/SKILL.md" },
    ], 20)).toThrow(/cannot fit.*Disable nonessential skills/s);
  });

  it("uses stable collision-safe hatch3r-command ids", () => {
    const commands = [
      { id: "hatch3r-release", sourcePath: "/canonical/commands/hatch3r-release.md" },
      { id: "hatch3r-test", sourcePath: "/canonical/commands/hatch3r-test.md" },
    ];
    const first = buildCodexCommandSkillIds(commands, new Set(["hatch3r-command-release"]));
    const second = buildCodexCommandSkillIds([...commands].reverse(), new Set(["hatch3r-command-release"]));

    expect(first).toEqual(second);
    expect(first.get(commands[0]!.sourcePath)).toMatch(/^hatch3r-command-release-[a-f0-9]{8}$/);
    expect(first.get(commands[1]!.sourcePath)).toBe("hatch3r-command-test");
  });

  it("translates only harness-shaped Claude assumptions and retains labeled comparisons", () => {
    const translated = translateCodexNativeContent(
      "Use the Task tool (`subagent_type: \"generalPurpose\"`) then `Read` files and invoke /hatch3r-debug.\n" +
        "Cross-harness example (Claude): use the Task tool.",
      {
        kind: "command",
        skillIds: new Set(["hatch3r-debug"]),
        commandIdsByCanonicalId: new Map([["hatch3r-debug", "hatch3r-command-debug"]]),
      },
    );
    expect(translated).toContain("Codex subagent workflow");
    expect(translated).toContain("$hatch3r-command-debug");
    expect(translated).toContain("Cross-harness example (Claude): use the Task tool.");
    expect(translated).not.toContain("subagent_type");
  });

  it("translates plural Claude Task sub-agent vocabulary", () => {
    const translated = translateCodexNativeContent(
      "Claude Code Task sub-agents share the orchestrator's tree.",
      {
        kind: "command",
        skillIds: new Set(),
        commandIdsByCanonicalId: new Map(),
      },
    );
    expect(translated).toContain("Codex subagents share the orchestrator's tree");
    expect(translated).not.toMatch(/\bTask[\s/]+sub-?agents?\b/);
  });

  it("translates only standalone slash invocations at lexical boundaries", () => {
    const translated = translateCodexNativeContent(
      [
        "Invoke /hatch3r-debug, then /hatch3r-debug.",
        "Keep https://hatch3r-debug.example/path and https://example.test/hatch3r-debug.",
        "Keep /hatch3r-debug/file, /hatch3r-debug.md, docs/hatch3r-debug, and word/hatch3r-debug.",
      ].join("\n"),
      {
        kind: "command",
        skillIds: new Set(["hatch3r-debug"]),
        commandIdsByCanonicalId: new Map([["hatch3r-debug", "hatch3r-command-debug"]]),
      },
    );
    expect(translated).toContain("Invoke $hatch3r-command-debug, then $hatch3r-command-debug.");
    expect(translated).toContain("https://hatch3r-debug.example/path");
    expect(translated).toContain("https://example.test/hatch3r-debug.");
    expect(translated).toContain("/hatch3r-debug/file");
    expect(translated).toContain("/hatch3r-debug.md");
    expect(translated).toContain("docs/hatch3r-debug");
    expect(translated).toContain("word/hatch3r-debug");
  });

  it("recomputes transitive support closure and rewrites missing references explicitly", async () => {
    const root = await tempRoot();
    const projectRoot = await tempRoot();
    const skillRoot = join(root, "skills", "hatch3r-demo");
    await mkdir(skillRoot, { recursive: true });
    await mkdir(join(root, "agents", "shared"), { recursive: true });
    await mkdir(join(root, "rules"), { recursive: true });
    const skillPath = join(skillRoot, "SKILL.md");
    await writeFile(skillPath, "placeholder", "utf-8");
    await writeFile(
      join(root, "agents", "shared", "first.md"),
      "Read `rules/second.md` and `rules/missing.md`.",
      "utf-8",
    );
    await writeFile(join(root, "rules", "second.md"), "Second-level support.", "utf-8");
    const skill = file(
      "hatch3r-demo",
      "skill",
      skillPath,
      "Demo",
      "Read `agents/shared/first.md`.",
    );
    skill.rawContent = "---\nid: hatch3r-demo\ntype: skill\ndescription: Demo\nquality_charter: agents/shared/first.md\n---\n" + skill.content;

    const projected = await projectCodexContent({ canonicalRoot: root, projectRoot, skills: [skill] });
    expect(projected.supportFiles).toEqual(["agents/shared/first.md", "rules/second.md"]);
    expect(projected.outputs.map((output) => output.path)).toContain(".hatch3r/codex-support/rules/second.md");
    expect(projected.outputs.find((output) => output.path.endsWith("agents/shared/first.md"))?.content)
      .toContain("[unsupported Hatcher reference omitted: rules/missing.md]");
    expect(projected.warnings).toContainEqual(expect.stringContaining("rules/missing.md"));
  });

  it("fails closed for path traversal ids, binary companions, and symlinks", async () => {
    const root = await tempRoot();
    const projectRoot = await tempRoot();
    const skillRoot = join(root, "skills", "hatch3r-demo");
    await mkdir(skillRoot, { recursive: true });
    const skillPath = join(skillRoot, "SKILL.md");
    await writeFile(skillPath, "placeholder", "utf-8");

    await expect(projectCodexContent({
      canonicalRoot: root,
      projectRoot,
      skills: [file("../escape", "skill", skillPath)],
    })).rejects.toBeInstanceOf(CodexContentProjectionError);

    await writeFile(join(skillRoot, "binary.dat"), Buffer.from([0, 1, 2]));
    await expect(projectCodexContent({
      canonicalRoot: root,
      projectRoot,
      skills: [file("hatch3r-demo", "skill", skillPath)],
    })).rejects.toThrow(/safe text/);
    await rm(join(skillRoot, "binary.dat"));

    await symlink(join(root, "outside"), join(skillRoot, "references"));
    await expect(projectCodexContent({
      canonicalRoot: root,
      projectRoot,
      skills: [file("hatch3r-demo", "skill", skillPath)],
    })).rejects.toThrow(/symbolic link/);
  });

  it("keeps enablement and customization independent for skill and command projections", async () => {
    const root = await tempRoot();
    const projectRoot = await tempRoot();
    const skillRoot = join(root, "skills", "hatch3r-alpha");
    const commandRoot = join(root, "commands");
    await mkdir(skillRoot, { recursive: true });
    await mkdir(commandRoot, { recursive: true });
    const skillPath = join(skillRoot, "SKILL.md");
    const commandPath = join(commandRoot, "hatch3r-beta.md");
    await writeFile(skillPath, "placeholder", "utf-8");
    await writeFile(commandPath, "placeholder", "utf-8");
    await mkdir(join(projectRoot, ".hatch3r", "skills"), { recursive: true });
    await mkdir(join(projectRoot, ".hatch3r", "commands"), { recursive: true });
    await writeFile(
      join(projectRoot, ".hatch3r", "skills", "hatch3r-alpha.customize.yaml"),
      "description: " + "customized ".repeat(100) + "\n",
      "utf-8",
    );
    await writeFile(
      join(projectRoot, ".hatch3r", "commands", "hatch3r-beta.customize.yaml"),
      "enabled: false\n",
      "utf-8",
    );

    const projected = await projectCodexContent({
      canonicalRoot: root,
      projectRoot,
      skills: [file("hatch3r-alpha", "skill", skillPath, "Alpha", "Invoke /hatch3r-beta only when available.")],
      commands: [file("hatch3r-beta", "command", commandPath)],
      discoveryBudget: 180,
    });
    expect(projected.outputs.map((output) => output.path)).toEqual([
      ".agents/skills/hatch3r-alpha/SKILL.md",
    ]);
    expect(projected.discovery.compacted).toBe(true);
    expect(projected.outputs[0]!.managedContent).toContain(
      "[unsupported Hatcher invocation omitted: hatch3r-beta]",
    );
    expect(projected.commandSkillIds.size).toBe(0);
  });
