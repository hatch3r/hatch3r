import { expect } from "vitest";
import { parse as parseYaml } from "yaml";
import {
  CODEX_DISCOVERY_FALLBACK_CHAR_BUDGET,
  CODEX_REPORT_OMISSION_WARNING,
  projectCodexContent,
} from "../../adapters/codexContentProjection.js";

type Projection = Awaited<ReturnType<typeof projectCodexContent>>;

function assertOperationalTextIsPortable(operationalText: string): void {
  const claudeOnly = operationalText.split("\n").filter((line) =>
    !/cross[- ]harness\s+(?:example|source).*Claude/i.test(line) &&
    /\bTask tool\b|\bTask[\s/]+(?:call|dispatch|delegation|invocation|sub-?agents?)\b|subagent_type\s*:|AskUserQuestion|`(?:Glob|Grep|Read|Bash|Edit|Write|WebSearch|WebFetch)`/.test(line));
  expect(claudeOnly).toEqual([]);
  expect(operationalText).not.toMatch(/\bagent type\s*[:=]\s*[`"']*(?:generalPurpose|general-purpose)\b/i);
  expect(operationalText).not.toMatch(/\bgeneralPurpose\b|\bfall back to\s+`general-purpose`/i);
  expect(operationalText.split("\n").filter(
    (line) => /\bClaude(?: Code)?\b/.test(line) && !/cross[- ]harness\s+(?:example|source).*Claude/i.test(line),
  )).toEqual([]);
  expect(operationalText).not.toMatch(/`(?:agents|rules|commands)\/[A-Za-z0-9._/-]+\.md`/);
  expect([...operationalText.matchAll(/(^|\s)\/hatch3r-[a-z0-9-]+/gm)]).toEqual([]);
  expect(operationalText).toContain("$hatch3r-command-release");
  expect(operationalText).toContain("$hatch3r-command-handoff");
  expect(operationalText).not.toMatch(/[A-Za-z0-9.]\$hatch3r-[a-z0-9-]+/i);
}

function assertSkillFrontmatter(projection: Projection): void {
  for (const output of projection.outputs.filter((item) => item.path.endsWith("/SKILL.md"))) {
    const frontmatter = output.content.match(/^---\n([\s\S]*?)\n---/)?.[1];
    expect(frontmatter, output.path).toBeDefined();
    const parsed = parseYaml(frontmatter!) as Record<string, unknown>;
    expect(Object.keys(parsed).sort(), output.path).toEqual(["description", "name"]);
    expect(output.managedContent?.length, output.path).toBeGreaterThan(0);
  }
}

function serializedDiscovery(projection: Projection): string {
  return projection.outputs
    .filter((item) => item.path.endsWith("/SKILL.md"))
    .map((output) => {
      const parsed = parseYaml(output.content.match(/^---\n([\s\S]*?)\n---/)![1]!) as Record<string, string>;
      return `- ${parsed.name}: ${parsed.description} (file: ${output.path})\n`;
    })
    .sort()
    .join("");
}

export function assertFullCodexProjection(
  first: Projection,
  second: Projection,
  selectedSkillCount: number,
  selectedCommandCount: number,
): void {
  expect(first.outputs).toEqual(second.outputs);
  expect(first.discovery).toEqual(second.discovery);
  expect(first.discovery.characterCount).toBeLessThanOrEqual(CODEX_DISCOVERY_FALLBACK_CHAR_BUDGET);
  expect(Array.from(first.discovery.serialized)).toHaveLength(first.discovery.characterCount);
  expect(first.discovery.entries).toHaveLength(selectedSkillCount - 1 + selectedCommandCount);
  expect(first.omitted).toEqual(["hatch3r-report"]);
  expect(first.warnings).toContain(CODEX_REPORT_OMISSION_WARNING);
  expect(first.outputs.some((output) => output.path.includes(".codex/skills"))).toBe(false);
  expect(first.outputs.some((output) => output.path === ".agents/skills/hatch3r-report/SKILL.md")).toBe(false);
  expect(first.outputs.map((output) => output.path)).toEqual(expect.arrayContaining([
    ".agents/skills/hatch3r-a11y-audit/references/manual-audit-checklist.md",
    ".agents/skills/hatch3r-gh-agentic-workflows/references/azure-devops.md",
    ".agents/skills/hatch3r-gh-agentic-workflows/references/gitlab-ci.md",
    ".agents/skills/hatch3r-issue-workflow/references/delegation-patterns.md",
    ".agents/skills/hatch3r-command-debug/SKILL.md",
    ".hatch3r/codex-support/agents/shared/quality-charter.md",
    ".hatch3r/codex-support/rules/hatch3r-agent-orchestration.md",
    ".hatch3r/codex-support/commands/shared/orchestration-frame.md",
  ]));
  const operationalText = first.outputs.filter((output) => output.path.endsWith(".md"))
    .map((output) => output.content).join("\n");
  assertOperationalTextIsPortable(operationalText);
  assertSkillFrontmatter(first);
  expect(serializedDiscovery(first)).toBe(first.discovery.serialized);
}
