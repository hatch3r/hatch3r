import { afterEach, expect, it } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CanonicalFile } from "../../types.js";
import {
  projectCodexContent,
  validateCodexOperationalOutputs,
} from "../../adapters/codexContentProjection.js";

const tempRoots: string[] = [];

async function tempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "hatch3r-codex-validation-"));
  tempRoots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function skill(sourcePath: string): CanonicalFile {
  const content = "Read agents/shared/quality.md.";
  return {
    id: "hatch3r-demo",
    type: "skill",
    frontmatterType: "skill",
    description: "Demo",
    content,
    rawContent: "---\nid: hatch3r-demo\ntype: skill\ndescription: Demo\nquality_charter: agents/shared/quality.md\n---\n" + content,
    sourcePath,
  };
}

  it("rewrites and validates hidden companion text plus structured references", async () => {
    const root = await tempRoot();
    const projectRoot = await tempRoot();
    const skillRoot = join(root, "skills", "hatch3r-demo");
    await mkdir(skillRoot, { recursive: true });
    await mkdir(join(root, "agents", "shared"), { recursive: true });
    await mkdir(join(root, "rules"), { recursive: true });
    const skillPath = join(skillRoot, "SKILL.md");
    await writeFile(skillPath, "placeholder", "utf-8");
    await writeFile(
      join(skillRoot, ".hidden.md"),
      "Use `MultiEdit`, NotebookEdit, WebFetch, WebSearch, TaskCreate, `KillShell`, and `SlashCommand`; then Task(subagent_type=\"reviewer\"). Read .claude/rules/missing.md and /h4tcher-release-prep.",
      "utf-8",
    );
    await writeFile(join(root, "agents", "shared", "quality.md"), "Read ../../rules/hatch3r-floor.md.", "utf-8");
    await writeFile(join(root, "rules", "hatch3r-floor.md"), "Floor.", "utf-8");

    const projected = await projectCodexContent({ canonicalRoot: root, projectRoot, skills: [skill(skillPath)] });
    const hidden = projected.outputs.find((output) => output.path.endsWith("/.hidden.md"))!;
    for (const phrase of [
      "file editing", "notebook editing", "open the cited web source", "web search",
      "task-list item creation", "shell process cancellation", "explicit skill invocation",
    ]) expect(hidden.content).toContain(phrase);
    expect(hidden.content).toContain("delegate to a Codex subagent (ask Codex to delegate the work to suitable subagents)");
    expect(hidden.content).toContain("[unsupported source-harness path omitted]");
    expect(hidden.content).toContain("[unsupported source-harness invocation omitted: h4tcher-release-prep]");
    expect(projected.supportFiles).toEqual(["agents/shared/quality.md", "rules/hatch3r-floor.md"]);
    expect(projected.outputs.find((output) => output.path.endsWith("agents/shared/quality.md"))?.content)
      .toContain(".hatch3r/codex-support/rules/hatch3r-floor.md");
    expect(() => validateCodexOperationalOutputs([{
      path: ".agents/skills/hatch3r-demo/.hidden.md",
      content: "Use `MultiEdit` and read rules/missing.md.",
      action: "create",
    }])).toThrow(/\.hidden\.md.*Claude-only tool|\.hidden\.md.*unresolved Hatcher reference/s);
  });

  it("preserves canonical .claude globs but rejects operational source-harness paths", () => {
    expect(() => validateCodexOperationalOutputs([{
      path: "AGENTS.md",
      content: "- `**/.claude/**` → `.hatch3r/codex-support/rules/hatch3r-tooling-hierarchy.md`.",
      action: "create",
    }, {
      path: ".hatch3r/codex-support/rules/hatch3r-tooling-hierarchy.md",
      content: "Apply repository tooling ownership rules.",
      action: "create",
    }])).not.toThrow();
    expect(() => validateCodexOperationalOutputs([{
      path: "AGENTS.md", content: "Read .claude/settings.json before editing.", action: "create",
    }])).toThrow(/\.claude path/);
  });

  it("rejects undocumented generic agent-type fingerprints", () => {
    for (const value of ["generalPurpose", "general-purpose"]) {
      expect(() => validateCodexOperationalOutputs([{
        path: ".agents/skills/hatch3r-demo/SKILL.md",
        content: `Delegate with agent type: "${value}".`,
        action: "create",
      }])).toThrow(/undocumented .* agent type/);
    }
    for (const content of [
      "Use the generalPurpose profile.",
      "If unavailable, fall back to `general-purpose`.",
    ]) {
      expect(() => validateCodexOperationalOutputs([{
        path: ".agents/skills/hatch3r-demo/SKILL.md", content, action: "create",
      }])).toThrow(/undocumented/);
    }
  });

  it("rejects unlabelled plural Claude Task delegation vocabulary", () => {
    expect(() => validateCodexOperationalOutputs([{
      path: ".hatch3r/codex-support/commands/demo.md",
      content: "Claude Code Task sub-agents share the orchestrator's tree.",
      action: "create",
    }])).toThrow(/Claude Task delegation/);
    expect(() => validateCodexOperationalOutputs([{
      path: ".hatch3r/codex-support/commands/demo.md",
      content: "Cross-harness example (Claude): Claude Code Task sub-agents share the tree.",
      action: "create",
    }])).not.toThrow();
  });

  it("parses and scans native-agent developer instructions through the shared schema", () => {
    const nativeAgent = (instructions: string) => ({
      path: ".codex/agents/hatch3r-demo.toml",
      content: [
        'name = "hatch3r-demo"', 'description = "Demo"',
        `developer_instructions = ${JSON.stringify(instructions)}`,
        'sandbox_mode = "read-only"', "",
      ].join("\n"),
      action: "create" as const,
    });
    expect(() => validateCodexOperationalOutputs([nativeAgent("Read rules/missing.md.")]))
      .toThrow(/unresolved Hatcher reference/s);
    expect(() => validateCodexOperationalOutputs([
      nativeAgent("Read .hatch3r/codex-support/rules/hatch3r-demo.md."),
      { path: ".hatch3r/codex-support/rules/hatch3r-demo.md", content: "Projected.", action: "create" },
    ])).not.toThrow();
    expect(() => validateCodexOperationalOutputs([{
      path: ".codex/agents/hatch3r-demo.toml", content: "[broken", action: "create",
    }])).toThrow(/malformed native-agent TOML/);
    expect(() => validateCodexOperationalOutputs([{
      path: ".codex/agents/hatch3r-demo.toml",
      content: 'name = "demo"\ndescription = "Demo"\ndeveloper_instructions = "Do work"\nunknown = true\n',
      action: "create",
    }])).toThrow(/unsupported custom-agent field/);
  });

  it("rejects corrupt skill-token boundaries and projected self-links", () => {
    for (const content of ["x$hatch3r-demo", ".$hatch3r-demo", "9$hatch3r-demo"]) {
      expect(() => validateCodexOperationalOutputs([{
        path: ".agents/skills/hatch3r-demo/SKILL.md", content, action: "create",
      }])).toThrow(/corrupt skill invocation boundary/);
    }
    expect(() => validateCodexOperationalOutputs([{
      path: ".hatch3r/codex-support/rules/hatch3r-self.md",
      content: "Read .hatch3r/codex-support/rules/hatch3r-self.md.",
      action: "create",
    }])).toThrow(/self-referential projected target/);
  });
