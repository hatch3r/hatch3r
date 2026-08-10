import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { CanonicalFile } from "../../types.js";
import {
  findCodexHatcherReferenceIssues,
  projectCodexAgents,
  resolveCodexAgentSandboxMode,
  serializeCodexAgentToml,
  translateCodexSubagentVocabulary,
} from "../../adapters/codexAgents.js";
import { filterUserFacing, readCanonicalFiles } from "../../adapters/canonical.js";
import { buildCodexInstructionReferenceMap } from "../../adapters/codexInstructions.js";
import { validateCodexOperationalOutputs } from "../../adapters/codexContentProjection.js";

const REPO_ROOT = resolve(import.meta.dirname, "../../..");

function agent(overrides: Partial<CanonicalFile> = {}): CanonicalFile {
  return {
    id: "hatch3r-reviewer",
    type: "agent",
    frontmatterType: "agent",
    description: 'Review "risky" changes and report concrete findings.',
    model: "advanced",
    effort: "high",
    content: [
      "Use the `Task` tool with `subagent_type` when work can run in parallel.",
      "Run one Task call per independent module.",
      "Call `AskUserQuestion` before /hatch3r-review.",
      "Use `Read`, `Grep`, and `Bash` to inspect the repository.",
    ].join("\n"),
    rawContent: "",
    sourcePath: "/canonical/agents/hatch3r-reviewer.md",
    ...overrides,
  };
}

interface ParsedToml {
  [key: string]: unknown;
}

function mulberry32(seed: number): () => number {
  return () => {
    seed |= 0;
    seed = seed + 0x6d2b79f5 | 0;
    let value = Math.imul(seed ^ seed >>> 15, 1 | seed);
    value = value + Math.imul(value ^ value >>> 7, 61 | value) ^ value;
    return ((value ^ value >>> 14) >>> 0) / 4294967296;
  };
}

/**
 * Prefer a standards-compliant parser once the integration package adds one.
 * The fallback recognizes only this serializer's deliberately small TOML
 * subset and keeps this bounded package independent from package.json edits.
 */
async function parseToml(content: string): Promise<ParsedToml> {
  const require = createRequire(import.meta.url);
  try {
    const resolved = require.resolve("smol-toml");
    const mod = await import(pathToFileURL(resolved).href) as { parse: (value: string) => ParsedToml };
    return mod.parse(content);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "MODULE_NOT_FOUND") throw error;
  }

  const result: ParsedToml = {};
  let table: ParsedToml = result;
  for (const rawLine of content.split("\n")) {
    const line = rawLine.trim();
    if (!line) continue;
    const arrayTable = line.match(/^\[\[skills\.config\]\]$/);
    if (arrayTable) {
      const skills = (result.skills ??= {}) as ParsedToml;
      const config = (skills.config ??= []) as ParsedToml[];
      table = {};
      config.push(table);
      continue;
    }
    const mcpTable = line.match(/^\[mcp_servers\.([A-Za-z0-9_-]+)\]$/);
    if (mcpTable) {
      const servers = (result.mcp_servers ??= {}) as ParsedToml;
      table = {};
      servers[mcpTable[1]!] = table;
      continue;
    }
    const pair = line.match(/^([A-Za-z0-9_.-]+)\s*=\s*(.+)$/);
    if (!pair) throw new Error(`Unsupported generated TOML line: ${line}`);
    const [, key, rawValue] = pair;
    table[key!] = rawValue === "true" || rawValue === "false"
      ? rawValue === "true"
      : JSON.parse(rawValue!);
  }
  return result;
}

describe("Codex native custom-agent projection", () => {
  it("emits deterministic parser-friendly TOML with every required field", async () => {
    const first = serializeCodexAgentToml(agent());
    const second = serializeCodexAgentToml(agent());
    expect(first).toBe(second);

    const parsed = await parseToml(first);
    expect(parsed).toMatchObject({
      name: "hatch3r-reviewer",
      description: 'Review "risky" changes and report concrete findings.',
      model: "gpt-5.6-sol",
      model_reasoning_effort: "high",
      sandbox_mode: "read-only",
    });
    expect(parsed.developer_instructions).toEqual(expect.any(String));
  });

  it("round-trips 200 seeded descriptions and instruction bodies through TOML", async () => {
    const random = mulberry32(0xc0de513);
    const alphabet = [..."abc XYZ0123\"\\#=[]\n\t–ü中\u2028"];
    const sample = (length: number): string => Array.from(
      { length },
      () => alphabet[Math.floor(random() * alphabet.length)]!,
    ).join("");

    for (let index = 0; index < 200; index += 1) {
      const description = sample(20 + Math.floor(random() * 50));
      const content = sample(30 + Math.floor(random() * 90));
      const parsed = await parseToml(serializeCodexAgentToml(agent({
        id: `hatch3r-seeded-${index}`,
        description,
        content,
      })));
      expect(parsed.description).toBe(description.replace(/\s+/g, " ").trim());
      expect(String(parsed.developer_instructions)).toContain(content.trim());
    }
  });

  it("translates explicit skill invocation, subagent, question, and tool vocabulary", async () => {
    const parsed = await parseToml(serializeCodexAgentToml(agent()));
    const instructions = String(parsed.developer_instructions);
    expect(instructions).toContain("$hatch3r-review");
    expect(instructions).toContain("Ask Codex to delegate the work to suitable subagents");
    expect(instructions).toContain("plain-text question");
    expect(instructions).not.toMatch(/\bsubagent_type\b|AskUserQuestion|\bTask call\b|`Task`|`Read`|`Grep`|`Bash`/);
  });

  it("selects only emitted custom-agent names and leaves generic delegation to Codex", () => {
    const available = new Set(["hatch3r-reviewer", "hatch3r-implementer"]);
    expect(translateCodexSubagentVocabulary(
      'Spawn `hatch3r-reviewer` via the Task tool (`subagent_type: "generalPurpose"`).',
      available,
    )).toContain("select the exact `hatch3r-reviewer` custom agent");
    expect(translateCodexSubagentVocabulary(
      'Launch one agent per domain with `subagent_type: "general-purpose"`.',
      available,
    )).toContain("ask Codex to delegate the work to suitable subagents");
    expect(translateCodexSubagentVocabulary(
      'Delegate with `subagent_type="reviewer"`.',
      available,
    )).toContain("select the exact `hatch3r-reviewer` custom agent");
    expect(translateCodexSubagentVocabulary(
      'Delegate with `subagent_type="invented-profile"`.',
      available,
    )).toContain("ask Codex to delegate the work to suitable subagents");
    expect(translateCodexSubagentVocabulary(
      "Use the Task tool to invoke the `hatch3r-reviewer` sub-agent. If it is unavailable, fall back to `general-purpose`.",
      available,
    )).toContain("select the exact `hatch3r-reviewer` custom agent");
    expect(translateCodexSubagentVocabulary(
      "Use the Task tool to invoke the `hatch3r-reviewer` sub-agent. If it is unavailable, fall back to `general-purpose`.",
      available,
    )).not.toContain("`general-purpose`");
  });

  it("rewrites projected references and labels unavailable optional ones", async () => {
    const withReferences = agent({
      content: "Read agents/shared/quality.md, .claude/agents/h4tcher-reviewer.md, ../agents/hatch3r-reviewer.md, and skills/hatch3r-review/SKILL.md.",
    });
    const unavailable = await parseToml(serializeCodexAgentToml(withReferences));
    expect(unavailable.developer_instructions).toContain(
      "[unsupported Hatcher reference omitted: agents/shared/quality.md]",
    );
    expect(unavailable.developer_instructions).toContain(
      "[unsupported Hatcher skill omitted: hatch3r-review]",
    );

    const parsed = await parseToml(serializeCodexAgentToml(withReferences, {
      referenceMap: new Map([
        ["agents/shared/quality.md", ".hatch3r/codex-support/agents/shared/quality.md"],
        ["agents/hatch3r-reviewer.md", ".hatch3r/codex-support/agents/hatch3r-reviewer.md"],
      ]),
      availableSkillIds: new Set(["hatch3r-review"]),
    }));
    expect(parsed.developer_instructions).toContain(
      ".hatch3r/codex-support/agents/shared/quality.md",
    );
    expect(String(parsed.developer_instructions).match(/\.hatch3r\/codex-support\/agents\/hatch3r-reviewer\.md/g)).toHaveLength(2);
    expect(parsed.developer_instructions).toContain(".agents/skills/hatch3r-review/SKILL.md");
  });

  it("rewrites relative, directory, check, skill, and placeholder references without dangling paths", async () => {
    const parsed = await parseToml(serializeCodexAgentToml(agent({
      content: [
        "Read shared/quality.md and rules/ before starting.",
        "Choose agents/modes/{mode-name}.md and agents/hatch3r-{ui,ux}.md by scope.",
        "Review checks/testing.md and checks/ before ../skills/hatch3r-review.",
        "Commands are indexed by commands/hatch3r-*.md.",
      ].join("\n"),
    }), {
      referenceMap: new Map([
        ["agents/shared/quality.md", ".hatch3r/codex-support/agents/shared/quality.md"],
        ["agents/modes/architecture.md", ".hatch3r/codex-support/agents/modes/architecture.md"],
        ["agents/hatch3r-ui.md", ".hatch3r/codex-support/agents/hatch3r-ui.md"],
        ["rules/hatch3r-floor.md", ".hatch3r/codex-support/rules/hatch3r-floor.md"],
        ["commands/hatch3r-test.md", ".hatch3r/codex-support/commands/hatch3r-test.md"],
      ]),
      availableSkillIds: new Set(["hatch3r-review"]),
    }));
    const instructions = String(parsed.developer_instructions);
    expect(instructions).toContain(".hatch3r/codex-support/agents/shared/quality.md");
    expect(instructions).toContain("[select an emitted Hatcher support file under .hatch3r/codex-support/agents/modes/]");
    expect(instructions).toContain("[unprojected Hatcher check reference omitted: checks/testing.md]");
    expect(instructions).toContain("[unprojected Hatcher checks omitted]");
    expect(instructions).toContain(".agents/skills/hatch3r-review/SKILL.md");
    expect(instructions).toContain(".hatch3r/codex-support/rules/");
    expect(findCodexHatcherReferenceIssues(instructions)).toEqual([]);
  });

  it("does not rewrite canonical-looking suffixes inside user or already-projected paths", async () => {
    const parsed = await parseToml(serializeCodexAgentToml(agent({
      content: "Keep .hatch3r/overrides/agents/pr-summarizer.md and .hatch3r/codex-support/rules/hatch3r-security.md unchanged.",
    })));
    expect(parsed.developer_instructions).toContain(".hatch3r/overrides/agents/pr-summarizer.md");
    expect(parsed.developer_instructions).toContain(".hatch3r/codex-support/rules/hatch3r-security.md");
    expect(parsed.developer_instructions).not.toContain("unsupported Hatcher reference");
  });

  it("fails closed to read-only unless writes are explicit and not denied", () => {
    expect(resolveCodexAgentSandboxMode(agent(), "workspace-write")).toBe("read-only");
    expect(
      resolveCodexAgentSandboxMode(agent({ toolsAllowed: ["write"] }), "workspace-write"),
    ).toBe("workspace-write");
    expect(
      resolveCodexAgentSandboxMode(
        agent({ toolsAllowed: ["write"], toolsDenied: ["write"] }),
        "workspace-write",
      ),
    ).toBe("read-only");
    expect(
      resolveCodexAgentSandboxMode(
        agent({ toolsAllowRaw: ["Write"], toolsDenyRaw: ["Edit"] }),
        "workspace-write",
      ),
    ).toBe("read-only");
  });

  it("emits workspace-write only for an explicit grant and requested narrowing", async () => {
    const parsed = await parseToml(serializeCodexAgentToml(
      agent({ toolsAllowed: ["write"] }),
      { agents: { "hatch3r-reviewer": { sandboxMode: "workspace-write" } } },
    ));
    expect(parsed.sandbox_mode).toBe("workspace-write");
  });

  it("emits real mixed allow/deny canonical agents as read-only without silent widening", async () => {
    const warnings: string[] = [];
    const allAgents = await readCanonicalFiles(REPO_ROOT, "agents", warnings, undefined, { strict: true });
    for (const id of ["hatch3r-devops", "hatch3r-pack-installer"]) {
      const canonical = allAgents.find((candidate) => candidate.id === id);
      expect(canonical, id).toBeDefined();
      const allowed = [...(canonical?.toolsAllowed ?? []), ...(canonical?.toolsAllowRaw ?? [])];
      const denied = [...(canonical?.toolsDenied ?? []), ...(canonical?.toolsDenyRaw ?? [])];
      expect(allowed.some((tool) => /^(?:Write|Edit)$/i.test(tool)), id).toBe(true);
      expect(denied.length, id).toBeGreaterThan(0);

      const parsed = await parseToml(serializeCodexAgentToml(canonical!, {
        agents: { [id]: { sandboxMode: "workspace-write" } },
      }));
      expect(parsed.sandbox_mode, id).toBe("read-only");
      expect(parsed.developer_instructions, id).toContain(
        "granular tool or command denies that Codex cannot mechanically represent",
      );
    }
  });

  it("emits only the documented Codex config efforts and gates xhigh on an explicit model", async () => {
    for (const effort of ["minimal", "low", "medium", "high", "xhigh"]) {
      const parsed = await parseToml(serializeCodexAgentToml(agent({ effort })));
      expect(parsed.model_reasoning_effort, effort).toBe(effort);
    }

    const warnings: string[] = [];
    const withoutModel = await parseToml(serializeCodexAgentToml(
      agent({ model: "inherit", effort: "xhigh" }),
      { warnings },
    ));
    expect(withoutModel).not.toHaveProperty("model_reasoning_effort");
    expect(warnings).toContainEqual(expect.stringMatching(
      /model_reasoning_effort="xhigh".*model-dependent.*configure both model and effort/i,
    ));

    for (const effort of ["max", "ultra", "turbo"]) {
      const unsupportedWarnings: string[] = [];
      const unsupported = await parseToml(serializeCodexAgentToml(
        agent({ effort }),
        { warnings: unsupportedWarnings },
      ));
      expect(unsupported).not.toHaveProperty("model_reasoning_effort");
      expect(unsupportedWarnings).toContainEqual(expect.stringMatching(
        new RegExp(`model_reasoning_effort="${effort}".*documented Codex config enum.*minimal \\| low \\| medium \\| high \\| xhigh`, "i"),
      ));
    }
  });

  it("omits unverified model aliases rather than emitting another provider's id", async () => {
    const parsed = await parseToml(serializeCodexAgentToml(agent({ model: "claude-opus-4-8" })));
    expect(parsed).not.toHaveProperty("model");
  });

  it("projects sorted Hatcher-owned files with per-file provenance", async () => {
    const outputs = projectCodexAgents([
      agent({ id: "hatch3r-zeta", sourcePath: "/canonical/agents/hatch3r-zeta.md" }),
      agent({ id: "alpha", sourcePath: "/canonical/agents/alpha.md" }),
    ]);
    expect(outputs.map((output) => output.path)).toEqual([
      ".codex/agents/hatch3r-alpha.toml",
      ".codex/agents/hatch3r-zeta.toml",
    ]);
    expect(outputs[0]!.sourceFiles).toEqual(["/canonical/agents/alpha.md"]);
    expect(outputs.every((output) => output.managedContent === undefined)).toBe(true);
    for (const output of outputs) {
      const parsed = await parseToml(output.content);
      expect(parsed).toHaveProperty("name");
      expect(parsed).toHaveProperty("description");
      expect(parsed).toHaveProperty("developer_instructions");
    }
  });

  it("projects and validates the complete user-facing canonical agent corpus", async () => {
    const warnings: string[] = [];
    const allAgents = await readCanonicalFiles(REPO_ROOT, "agents", warnings, undefined, { strict: true });
    const agents = filterUserFacing(allAgents, "agent", join(REPO_ROOT, "agents"));
    const rules = await readCanonicalFiles(REPO_ROOT, "rules", warnings, undefined, { strict: true });
    const commands = await readCanonicalFiles(REPO_ROOT, "commands", warnings, undefined, { strict: true });
    const skills = await readCanonicalFiles(REPO_ROOT, "skills", warnings, undefined, { strict: true });
    const referenceMap = buildCodexInstructionReferenceMap({ agents: allAgents, rules, commands });
    const outputs = projectCodexAgents(agents, {
      referenceMap,
      availableSkillIds: new Set(skills.map((skill) => skill.id).filter((id) => id !== "hatch3r-report")),
      warnings,
    });
    const supportOutputs = [...new Set(referenceMap.values())].map((path) => ({
      path,
      content: "Projected Hatcher support content.",
      action: "create" as const,
    }));

    expect(outputs).toHaveLength(agents.length);
    expect(() => validateCodexOperationalOutputs([...outputs, ...supportOutputs])).not.toThrow();
    for (const output of outputs) {
      const parsed = await parseToml(output.content);
      if (parsed.model_reasoning_effort !== undefined) {
        expect(["minimal", "low", "medium", "high", "xhigh"], output.path)
          .toContain(parsed.model_reasoning_effort);
      }
      const instructions = String(parsed.developer_instructions);
      expect(findCodexHatcherReferenceIssues(instructions), output.path).toEqual([]);
      for (const match of instructions.matchAll(/\.hatch3r\/codex-support\/[A-Za-z0-9._/-]+\.md/g)) {
        expect([...referenceMap.values()], output.path).toContain(match[0]);
      }
      for (const match of instructions.matchAll(
        /\[select an emitted Hatcher support file under (\.hatch3r\/codex-support\/[A-Za-z0-9._/-]+\/)\]/g,
      )) {
        expect(
          [...referenceMap.values()].some((path) => path.startsWith(match[1]!)),
          `${output.path}: ${match[1]}`,
        ).toBe(true);
      }
    }
    for (const id of ["hatch3r-edge-case-analyst", "hatch3r-reviewer", "hatch3r-security"]) {
      expect(warnings, id).toContainEqual(expect.stringMatching(
        new RegExp(`Agent "${id}" omitted model_reasoning_effort="max".*documented Codex config enum`, "i"),
      ));
    }
  }, 30_000);

});
