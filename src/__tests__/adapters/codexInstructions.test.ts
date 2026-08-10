import { describe, expect, it } from "vitest";
import type { CanonicalFile } from "../../types.js";
import {
  buildCodexManagedInstructionBody,
  preflightCodexInstructions,
  projectCodexInstructions,
  type CodexInstructionProjectionInput,
} from "../../adapters/codexInstructions.js";

function canonical(
  type: "agent" | "rule" | "command",
  id: string,
  content: string,
  overrides: Partial<CanonicalFile> = {},
): CanonicalFile {
  const directory = type === "agent" ? "agents" : `${type}s`;
  return {
    id,
    type,
    frontmatterType: type,
    description: `Description for ${id}`,
    content,
    rawContent: content,
    sourcePath: `/canonical/${directory}/${id}.md`,
    ...overrides,
  };
}

function fixtureInput(): CodexInstructionProjectionInput {
  return {
    agents: [
      canonical(
        "agent",
        "hatch3r-reviewer",
        "Use agents/shared/quality.md and [this agent](../agents/hatch3r-reviewer.md). The source-harness path .claude/agents/h4tcher-reviewer.md names the same protocol. Delegate with the `Task` tool and `subagent_type`; ask with `AskUserQuestion`. Invoke /hatch3r-review.",
      ),
    ],
    rules: [
      canonical("rule", "hatch3r-security", "Never embed secrets.", {
        scope: "always",
        precedence: "critical",
      }),
      canonical("rule", "hatch3r-typescript", "Follow rules/shared/ts-base.md.", {
        scope: "conditional",
        globs: "src/**/*.ts, src/**/*.tsx, **/.claude/**",
        precedence: "high",
      }),
      canonical("rule", "hatch3r-docs", "Use concise documentation.", {
        scope: "agent-requested",
        precedence: "low",
      }),
    ],
    commands: [
      canonical(
        "command",
        "hatch3r-review",
        "Read commands/shared/review-frame.md and skills/hatch3r-review/SKILL.md, then use /hatch3r-review.",
      ),
    ],
    companions: [
      {
        class: "agents",
        relativePath: "shared/quality.md",
        content: "Ask a concise plain-text question when requirements conflict.",
        sourcePath: "/canonical/agents/shared/quality.md",
      },
      {
        class: "rules",
        relativePath: "shared/ts-base.md",
        content: "Use strict TypeScript types.",
        sourcePath: "/canonical/rules/shared/ts-base.md",
      },
      {
        class: "commands",
        relativePath: "shared/review-frame.md",
        content: "Return findings ordered by severity.",
        sourcePath: "/canonical/commands/shared/review-frame.md",
      },
    ],
    availableSkillIds: ["hatch3r-review"],
  };
}

describe("Codex native instruction projection", () => {
  it("projects one compact root managed block and Hatcher-owned support files", () => {
    const { outputs } = projectCodexInstructions(fixtureInput());
    expect(outputs.map((output) => output.path)).toEqual([
      "AGENTS.md",
      ".hatch3r/codex-support/agents/hatch3r-reviewer.md",
      ".hatch3r/codex-support/agents/shared/quality.md",
      ".hatch3r/codex-support/commands/hatch3r-review.md",
      ".hatch3r/codex-support/commands/shared/review-frame.md",
      ".hatch3r/codex-support/rules/hatch3r-docs.md",
      ".hatch3r/codex-support/rules/hatch3r-security.md",
      ".hatch3r/codex-support/rules/hatch3r-typescript.md",
      ".hatch3r/codex-support/rules/shared/ts-base.md",
    ]);
    expect(outputs.filter((output) => output.path === "AGENTS.md")).toHaveLength(1);
    expect(outputs.some((output) => output.path.startsWith(".codex/rules"))).toBe(false);
    expect(outputs.some((output) => /\/.+\/AGENTS\.md$/.test(output.path))).toBe(false);
  });

  it("labels the glob bridge and preserves precedence ordering", () => {
    const body = buildCodexManagedInstructionBody(fixtureInput());
    expect(body).toContain("Conditional rule bridge (glob limitation)");
    expect(body).toContain("Codex has no native repository glob-scoped rule file");
    expect(body).toContain("`src/**/*.ts, src/**/*.tsx, **/.claude/**`");
    expect(body).toContain("(critical)");
    expect(body.indexOf("hatch3r-security.md")).toBeLessThan(body.indexOf("hatch3r-typescript.md"));
    expect(body).toContain("Relevance-triggered rule bridge");
  });

  it("contains the global floor and indexes native agents and command skills without self-reference", () => {
    const body = buildCodexManagedInstructionBody(fixtureInput());
    expect(body).toContain("Universal floor");
    expect(body).toContain("Codex subagents");
    expect(body).toContain("`$hatch3r-*` skills");
    expect(body).toContain("plain-text question");
    expect(body).not.toContain("AGENTS.md");
  });

  it("emits the lifecycle-managed handoff bridge only when enabled", () => {
    const enabled = fixtureInput();
    enabled.commands = [
      ...(enabled.commands ?? []),
      canonical("command", "hatch3r-handoff", "Manage Hatcher handoff state."),
    ];
    enabled.commandSkillIds = new Map([
      ["hatch3r-review", "hatch3r-command-review"],
      ["hatch3r-handoff", "hatch3r-command-handoff"],
    ]);
    enabled.handoffsEnabled = true;
    const body = buildCodexManagedInstructionBody(enabled);
    expect(body).toContain("### Handoff bridge");
    expect(body).toContain("`$hatch3r-command-handoff`");
    expect(body).toContain("`.hatch3r/handoffs/`");

    enabled.handoffsEnabled = false;
    expect(buildCodexManagedInstructionBody(enabled)).not.toContain("### Handoff bridge");
  });

  it("rewrites internal references only when their projected target exists", () => {
    const { outputs } = projectCodexInstructions(fixtureInput());
    const agent = outputs.find((output) => output.path.endsWith("agents/hatch3r-reviewer.md"))!;
    const command = outputs.find((output) => output.path.endsWith("commands/hatch3r-review.md"))!;
    expect(agent.content).toContain(".hatch3r/codex-support/agents/shared/quality.md");
    expect(agent.content.match(/this support file/g)).toHaveLength(2);
    expect(command.content).toContain(".hatch3r/codex-support/commands/shared/review-frame.md");
    expect(command.content).toContain(".agents/skills/hatch3r-review/SKILL.md");
    expect(command.content).toContain("$hatch3r-review");
  });

  it("keeps user-owned and already-projected paths stable across repeated translation", () => {
    const input = fixtureInput();
    input.companions = [
      ...(input.companions ?? []),
      {
        class: "agents",
        relativePath: "shared/paths.md",
        content: "Keep .hatch3r/overrides/agents/pr-summarizer.md and .hatch3r/codex-support/rules/hatch3r-security.md unchanged.",
        sourcePath: "/canonical/agents/shared/paths.md",
      },
    ];
    const output = projectCodexInstructions(input).outputs.find((item) =>
      item.path.endsWith("agents/shared/paths.md"),
    )!;
    expect(output.content).toContain(".hatch3r/overrides/agents/pr-summarizer.md");
    expect(output.content).toContain(".hatch3r/codex-support/rules/hatch3r-security.md");
    expect(output.content).not.toContain(".hatch3r/codex-support/.hatch3r/codex-support");
  });

  it("labels unavailable optional companion and skill references", () => {
    const missingCompanion = fixtureInput();
    missingCompanion.companions = [];
    const companionProjection = projectCodexInstructions(missingCompanion);
    expect(companionProjection.outputs.map((output) => output.content).join("\n")).toContain(
      "[unsupported Hatcher reference omitted: agents/shared/quality.md]",
    );
    expect(companionProjection.warnings).toContainEqual(
      expect.stringContaining("Unprojected optional internal reference"),
    );

    const missingSkill = fixtureInput();
    missingSkill.availableSkillIds = [];
    const skillProjection = projectCodexInstructions(missingSkill);
    expect(skillProjection.outputs.map((output) => output.content).join("\n")).toContain(
      "[unsupported Hatcher skill omitted: hatch3r-review]",
    );
  });

  it("replaces a self-reference without creating a recursive path bridge", () => {
    const selfReference = fixtureInput();
    selfReference.companions = [
      ...(selfReference.companions ?? []),
      {
        class: "rules",
        relativePath: "shared/self.md",
        content: "Read rules/shared/self.md.",
        sourcePath: "/canonical/rules/shared/self.md",
      },
    ];
    const output = projectCodexInstructions(selfReference).outputs.find((item) =>
      item.path.endsWith("rules/shared/self.md"),
    );
    expect(output?.content).toContain("Read this support file.");
    expect(output?.content).not.toContain("rules/shared/self.md");
  });

  it("removes unintended Claude-only tool and orchestration assumptions", () => {
    const { outputs } = projectCodexInstructions(fixtureInput());
    const combined = outputs.map((output) => output.content).join("\n");
    const withoutCanonicalTargetGlobs = combined.replace(/\*\*\/\.claude\/\*\*/g, "");
    expect(combined).toContain("$hatch3r-review");
    expect(withoutCanonicalTargetGlobs).not.toMatch(/\bsubagent_type\b|AskUserQuestion|`Task`|MultiEdit|NotebookEdit|WebFetch|\bClaude Code\b|\.claude\//);
  });

  it("is byte-idempotent and keeps provenance attached to each support output", () => {
    const first = projectCodexInstructions(fixtureInput()).outputs;
    const second = projectCodexInstructions(fixtureInput()).outputs;
    expect(first).toEqual(second);
    const support = first.filter((output) => output.path !== "AGENTS.md");
    expect(support.every((output) => output.sourceFiles?.length === 1)).toBe(true);
    expect(first[0]!.sourceFiles).toEqual([...first[0]!.sourceFiles!].sort());
  });

  it("rejects unsafe support paths and duplicate outputs", () => {
    const traversal = fixtureInput();
    traversal.companions = [{
      class: "rules",
      relativePath: "../outside.md",
      content: "x",
      sourcePath: "/canonical/outside.md",
    }];
    expect(() => projectCodexInstructions(traversal)).toThrow(/Unsafe support path/);

    const duplicate = fixtureInput();
    duplicate.companions = [
      ...(duplicate.companions ?? []),
      {
        class: "rules",
        relativePath: "hatch3r-security.md",
        content: "duplicate",
        sourcePath: "/canonical/duplicate.md",
      },
    ];
    expect(() => projectCodexInstructions(duplicate)).toThrow(/Duplicate support output/);
  });

  it("fails closed before the managed root body exceeds Codex's 32 KiB default", () => {
    const oversized: CodexInstructionProjectionInput = {
      rules: Array.from({ length: 600 }, (_, index) => canonical(
        "rule",
        `hatch3r-budget-${index}`,
        "Rule body.",
        {
          scope: "conditional",
          globs: `packages/service-${index}/src/**/*.typescript`,
        },
      )),
    };
    expect(() => projectCodexInstructions(oversized)).toThrow(/32768-byte project-instruction limit/);
  });
});

describe("Codex instruction ownership preflight", () => {
  it("uses a valid root AGENTS.override.md as the active managed target", () => {
    const result = preflightCodexInstructions({ agentsOverrideMd: "# User override\n" });
    expect(result).toMatchObject({ ok: true, issues: [], activePath: "AGENTS.override.md" });
    const projection = projectCodexInstructions(fixtureInput(), result);
    expect(projection.outputs[0]?.path).toBe("AGENTS.override.md");
    expect(projection.outputs.some((output) => output.path === "AGENTS.md")).toBe(false);
    expect(projection.warnings).toContainEqual(expect.stringContaining("active root and nested instruction files"));
  });

  it("allows an absent or empty root override", () => {
    expect(preflightCodexInstructions({})).toMatchObject({ ok: true, activePath: "AGENTS.md" });
    expect(preflightCodexInstructions({ agentsOverrideMd: " \n" })).toMatchObject({ ok: true, activePath: "AGENTS.md" });
  });

  it("detects broken, reversed, and duplicate managed regions", () => {
    expect(preflightCodexInstructions({
      agentsMd: "user\n<!-- HATCH3R:BEGIN -->\nmanaged without end",
    }).issues[0]?.code).toBe("BROKEN_MANAGED_REGION");
    expect(preflightCodexInstructions({
      agentsMd: "<!-- HATCH3R:END -->\nbody\n<!-- HATCH3R:BEGIN -->",
    }).issues[0]?.code).toBe("BROKEN_MANAGED_REGION");
    expect(preflightCodexInstructions({
      agentsMd: [
        "<!-- HATCH3R:BEGIN -->",
        "one",
        "<!-- HATCH3R:END -->",
        "<!-- HATCH3R:BEGIN -->",
        "two",
        "<!-- HATCH3R:END -->",
      ].join("\n"),
    }).issues[0]?.code).toBe("DUPLICATE_MANAGED_REGION");
  });

  it("accepts one ordered managed region surrounded by user content", () => {
    const result = preflightCodexInstructions({
      agentsMd: [
        "# User content",
        "<!-- HATCH3R:BEGIN -->",
        "managed",
        "<!-- HATCH3R:END -->",
        "user tail",
      ].join("\n"),
    });
    expect(result).toMatchObject({ ok: true, issues: [], activePath: "AGENTS.md" });
  });

  it("ignores marker examples inside a closed Markdown fence", () => {
    const result = preflightCodexInstructions({
      agentsMd: [
        "```md",
        "<!-- HATCH3R:BEGIN -->",
        "example",
        "<!-- HATCH3R:END -->",
        "```",
        "user content",
      ].join("\n"),
    });
    expect(result).toMatchObject({ ok: true, issues: [], activePath: "AGENTS.md" });
  });

  it("validates only the active file and counts preserved user bytes exactly", () => {
    const result = preflightCodexInstructions({
      agentsMd: "<!-- HATCH3R:BEGIN -->\nbroken root without end",
      agentsOverrideMd: `${"u".repeat(32_000)}\n`,
    });
    expect(result).toMatchObject({ ok: true, activePath: "AGENTS.override.md" });
    expect(() => projectCodexInstructions(fixtureInput(), result)).toThrow(
      /AGENTS\.override\.md would be .*after preserving user content/,
    );
  });
});
