import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { wrapInManagedBlock } from "../../merge/managedBlocks.js";
import { parseFrontmatter } from "../../adapters/canonical.js";

/**
 * Shared orchestration content inlined into adapter bridge files (CLAUDE.md, GEMINI.md,
 * .windsurfrules, .amp/AGENTS.md, .github/copilot-instructions.md, .cursor/rules/hatch3r-bridge.mdc).
 * Includes mandatory behaviors, agent quick reference, and canonical structure.
 * Ensures every platform receives inline orchestration guidance instead of relying solely
 * on "read /.agents/AGENTS.md" references.
 */
/** Static bridge orchestration (no skill index). Used as fallback. */
export const BRIDGE_ORCHESTRATION = `## Sub-Agent Pipeline (mandatory, no exceptions)

All tasks use this four-phase pipeline. Never implement inline; always delegate.

**Phase 1 — Research:** Spawn \`hatch3r-researcher\`. Skip only for trivial edits. Score complexity per \`hatch3r-deep-context\` and add tier modes.
**Phase 2 — Implement:** Spawn \`hatch3r-implementer\` (one per task). Pass research context.
**Phase 3 — Review Loop:** \`hatch3r-reviewer\` → if Critical/Warning: \`hatch3r-fixer\` → re-review → repeat (max 3). After clean verdict: one confirmation pass (regressions, acceptance criteria). Remaining findings after max iterations → surface to user.
**Phase 4 — Final Quality** (after clean review): \`hatch3r-test-writer\` + \`hatch3r-security-auditor\` (always), \`hatch3r-docs-writer\` (evaluate), then conditional: lint-fixer, a11y-auditor, perf-profiler, dependency-auditor.

## Mandatory Behaviors

1. **Load skill** from \`/.agents/skills/\` matching task type before implementation.
2. **Task tool** (\`subagent_type: "generalPurpose"\`) for all delegations. Max parallelism.
3. **Propagate rules**: include \`scope: always\` directives in subagent prompts.
4. **Consult learnings**: check \`/.agents/learnings/\` before implementation.
5. **Consult specs**: if \`docs/specs/\` exists, read relevant specifications before implementation and cross-reference during review.

## Agent Quick Reference

| Agent | When |
|-------|------|
| \`hatch3r-researcher\` | Always before impl (skip trivial edits) |
| \`hatch3r-implementer\` | Always — one per task |
| \`hatch3r-reviewer\` | Always (Phase 3 loop) |
| \`hatch3r-fixer\` | Critical/Warning findings (Phase 3) |
| \`hatch3r-test-writer\` | Always for code changes (Phase 4) |
| \`hatch3r-security-auditor\` | Always for code changes (Phase 4) |
| \`hatch3r-docs-writer\` | Evaluate; spawn if doc impact (Phase 4) |
| \`hatch3r-lint-fixer\` | Lint/type errors after impl |
| \`hatch3r-a11y-auditor\` | UI/accessibility changes |
| \`hatch3r-architect\` | Architectural decisions, API design |
| \`hatch3r-perf-profiler\` | Performance-sensitive changes |
| \`hatch3r-dependency-auditor\` | Dependency changes |
| \`hatch3r-ci-watcher\` | CI failures |
| \`hatch3r-devops\` | Infra, deployment, CI/CD changes |

Full protocol: \`hatch3r-agent-orchestration\` rule in \`/.agents/rules/\`.

## Canonical Structure

- Rules: \`/.agents/rules/\` — Agents: \`/.agents/agents/\` — Skills: \`/.agents/skills/\`
- Commands: \`/.agents/commands/\` — MCP: \`/.agents/mcp/mcp.json\` — Policy: \`/.agents/policy/\`

Do not edit \`hatch3r-\` prefixed files — managed by hatch3r, overwritten on update.

## Getting Started (staged introduction)

New to hatch3r? Start here and expand as you go:

**Day 1 — Core workflow:** Use the 4-phase pipeline above for any task. Start by invoking \`hatch3r-researcher\` for context, then \`hatch3r-implementer\` for changes.
**Week 1 — Skills & commands:** Load skills from \`/.agents/skills/\` matching your task type. Try \`/hatch3r-feature\` or \`/hatch3r-bug-fix\` commands.
**Week 2 — Board & team:** If using project management, run \`/hatch3r-board-init\` to set up your board. Use \`/hatch3r-board-pickup\` for structured delivery.
**Ongoing — Customization:** Override agent behavior via \`.hatch3r/{type}/{id}.customize.yaml\`. Add project learnings to \`/.agents/learnings/\`.`;

/**
 * Generate bridge orchestration with an inline skill dispatch table.
 * Falls back to the static BRIDGE_ORCHESTRATION if agentsDir is unavailable.
 */
export async function generateBridgeOrchestration(agentsDir: string): Promise<string> {
  const skills = await readSkillDirs(join(agentsDir, "skills"));
  if (skills.length === 0) return BRIDGE_ORCHESTRATION;

  const skillTable = [
    "\n## Skill Dispatch Table\n",
    "Load the matching skill before implementation. Full content in `/.agents/skills/{id}/SKILL.md`.\n",
    "| Task Type | Skill | Description |",
    "|-----------|-------|-------------|",
  ];
  for (const skill of skills) {
    skillTable.push(`| — | \`${skill.id}\` | ${skill.description.slice(0, 80)} |`);
  }

  // Insert skill table after the Agent Quick Reference table
  const insertPoint = "Do not edit `hatch3r-` prefixed files";
  const idx = BRIDGE_ORCHESTRATION.indexOf(insertPoint);
  if (idx === -1) return BRIDGE_ORCHESTRATION;

  return (
    BRIDGE_ORCHESTRATION.slice(0, idx) +
    skillTable.join("\n") +
    "\n\n" +
    BRIDGE_ORCHESTRATION.slice(idx)
  );
}

export const AGENTS_MD_INNER = [
  "# Project Agent Instructions",
  "",
  "This project uses hatch3r for agentic coding setup.",
  "Full canonical instructions are at `/.agents/AGENTS.md`.",
  "",
  "## Quick Reference",
  "",
  "- Rules: `/.agents/rules/`",
  "- Agents: `/.agents/agents/`",
  "- Skills: `/.agents/skills/`",
  "- Commands: `/.agents/commands/`",
].join("\n");

export const AGENTS_MD_FULL = `${wrapInManagedBlock(AGENTS_MD_INNER)}\n`;

// ── Dynamic AGENTS.md generation ──────────────────────────────

/**
 * Generate canonical AGENTS.md content based on what's actually installed on disk.
 * Reads agent, skill, and command files from the .agents/ directory.
 */
export async function generateCanonicalAgentsMd(agentsDir: string): Promise<string> {
  const sections: string[] = [];

  sections.push(`# hatch3r — Canonical Agent Instructions

This file is the canonical reference for all agent orchestration in this project. It is auto-generated by hatch3r and should not be manually edited.

## Universal Sub-Agent Pipeline

Every task — board-pickup, workflow command, plain chat, single-task, or multi-task — MUST use this four-phase sub-agent pipeline. There are NO exceptions. Never implement code inline; always delegate to sub-agents.

**Phase 1 — Research:** Spawn \`hatch3r-researcher\` for context gathering before implementation. Skip only for trivial single-line edits.

**Phase 2 — Implement:** Spawn \`hatch3r-implementer\` for ALL code changes. One dedicated implementer per task.

**Phase 3 — Review Loop:** Spawn \`hatch3r-reviewer\`, then \`hatch3r-fixer\` for Critical/Warning findings, re-review, repeat until clean (max 3 iterations).

**Phase 4 — Final Quality** (runs ONLY after review loop is clean): Spawn applicable specialists in parallel.

## Orchestration Protocol

1. **Load the matching skill** from \`/.agents/skills/\` based on task type before implementation.
2. **Score task complexity** per the \`hatch3r-deep-context\` rule.
3. **Spawn a researcher subagent** (\`hatch3r-researcher\`) for context gathering.
4. **Spawn an implementer subagent** (\`hatch3r-implementer\`) for code changes.
5. **Run the review loop** (Phase 3).
6. **Spawn final quality subagents** (Phase 4).
7. **Propagate rules** to all subagent prompts.
8. **Consult learnings** from \`/.agents/learnings/\`.`);

  // Build agent roster from what's on disk
  const agents = await readDirFiles(join(agentsDir, "agents"));
  if (agents.length > 0) {
    sections.push("\n## Agent Roster\n");
    sections.push("| Agent | Purpose |");
    sections.push("|-------|---------|");
    for (const agent of agents) {
      const { metadata } = parseFrontmatter(agent.content);
      const id = metadata.id || metadata.name || agent.name.replace(/\.md$/, "");
      const desc = metadata.description ?? "";
      sections.push(`| \`${id}\` | ${desc.slice(0, 100)} |`);
    }
  }

  // Build skill dispatch table with inline checklists from what's on disk
  const skills = await readSkillDirs(join(agentsDir, "skills"));
  if (skills.length > 0) {
    sections.push("\n## Available Skills\n");
    sections.push("| Skill | Description |");
    sections.push("|-------|-------------|");
    for (const skill of skills) {
      sections.push(`| \`${skill.id}\` | ${skill.description.slice(0, 100)} |`);
    }

    // Inline condensed skill checklists so agents don't need a separate file read
    const skillsWithChecklists = skills.filter((s) => s.checklist);
    if (skillsWithChecklists.length > 0) {
      sections.push("\n## Skill Quick Reference\n");
      sections.push("When loading a skill, follow its checklist steps below. Full skill content is in `/.agents/skills/{id}/SKILL.md`.\n");
      for (const skill of skillsWithChecklists) {
        sections.push(`### \`${skill.id}\`\n`);
        sections.push(skill.checklist!);
        sections.push("");
      }
    }
  }

  // Build command list from what's on disk
  const commands = await readDirFiles(join(agentsDir, "commands"));
  if (commands.length > 0) {
    sections.push("\n## Available Commands\n");
    sections.push("| Command | Description |");
    sections.push("|---------|-------------|");
    for (const cmd of commands) {
      const { metadata } = parseFrontmatter(cmd.content);
      const id = metadata.id || metadata.name || cmd.name.replace(/\.md$/, "");
      const desc = metadata.description ?? "";
      sections.push(`| \`${id}\` | ${desc.slice(0, 100)} |`);
    }
  }

  sections.push(`
## Directory Structure

- \`/.agents/rules/\` — Rules (source of truth for all tool-specific rules)
- \`/.agents/agents/\` — Agent definitions
- \`/.agents/skills/\` — Skill workflows
- \`/.agents/commands/\` — Executable commands
- \`/.agents/mcp/\` — MCP server configuration
- \`/.agents/policy/\` — Guardrails and deny lists
- \`/.agents/learnings/\` — Project learnings (pitfalls, patterns, decisions)
`);

  return sections.join("\n");
}

// ── Helpers ──────────────────────────────────────────────────

interface DirFile {
  name: string;
  content: string;
}

async function readDirFiles(dir: string): Promise<DirFile[]> {
  try {
    const entries = await readdir(dir);
    const mdFiles = entries.filter((f) => f.endsWith(".md")).sort();
    return Promise.all(
      mdFiles.map(async (name) => ({
        name,
        content: await readFile(join(dir, name), "utf-8"),
      })),
    );
  } catch {
    return [];
  }
}

/**
 * Extract a condensed checklist from skill content by pulling numbered lists
 * and heading structure (max ~20 lines per skill to keep token count manageable).
 */
function extractSkillChecklist(content: string): string | undefined {
  const lines = content.split("\n");
  const checklist: string[] = [];
  let inSteps = false;

  for (const line of lines) {
    // Start capturing at headings containing "steps", "protocol", "workflow", "checklist", or numbered procedure
    if (/^#{1,3}\s+.*(step|protocol|workflow|checklist|procedure|implementation)/i.test(line)) {
      inSteps = true;
      continue;
    }
    // Stop at the next major heading that isn't a sub-step
    if (inSteps && /^#{1,2}\s+/.test(line) && !/step|phase/i.test(line)) {
      break;
    }
    if (inSteps && (line.match(/^\d+\.\s/) || line.match(/^-\s/) || line.match(/^\s+\d+\.\s/) || line.match(/^\s+-\s/))) {
      checklist.push(line);
      if (checklist.length >= 20) break;
    }
  }

  return checklist.length > 0 ? checklist.join("\n") : undefined;
}

async function readSkillDirs(dir: string): Promise<{ id: string; description: string; checklist?: string }[]> {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    const skills: { id: string; description: string; checklist?: string }[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      try {
        const raw = await readFile(join(dir, entry.name, "SKILL.md"), "utf-8");
        const { metadata, content } = parseFrontmatter(raw);
        skills.push({
          id: metadata.id || metadata.name || entry.name,
          description: metadata.description ?? "",
          checklist: extractSkillChecklist(content),
        });
      } catch {
        // skip
      }
    }
    return skills.sort((a, b) => a.id.localeCompare(b.id));
  } catch {
    return [];
  }
}
