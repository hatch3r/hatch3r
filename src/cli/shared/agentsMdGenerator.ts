import { join } from "node:path";
import { wrapInManagedBlock } from "../../merge/managedBlocks.js";
import { parseFrontmatter } from "../../adapters/canonical.js";
import { readDirFiles, readSkillDirs } from "./agentsContentShared.js";

/**
 * D1-SA1.7-F9 (Cycle 10 Wave 4, D1/CQ8): root + canonical AGENTS.md
 * generators, extracted from the former monolithic `agentsContent.ts`.
 * No behavior change — bodies moved verbatim; the shared filesystem readers
 * are now imported from `agentsContentShared.ts`.
 *
 * Wave 4: kept for back-compat with external tooling/tests. Sync paths no
 * longer emit a root AGENTS.md (W3). Paths reflect the claude-adapter shape;
 * adapter-specific call sites should prefer their own bridge file content.
 */
export const AGENTS_MD_INNER = [
  "# Project Agent Instructions",
  "",
  "This project uses hatch3r for agentic coding setup.",
  "Per-adapter native paths hold the canonical instructions (e.g. `.claude/`, `.cursor/`, `.github/`).",
  "",
  "## Quick Reference",
  "",
  "- Rules: `.claude/rules/` (or `.cursor/rules/`, `.github/instructions/`)",
  "- Agents: `.claude/agents/` (or `.cursor/agents/`, `.github/agents/`)",
  "- Skills: `.claude/skills/` (or `.cursor/skills/`, `.github/skills/`)",
  "- Commands: `.claude/commands/` (or `.cursor/commands/`, `.github/prompts/`)",
].join("\n");

export const AGENTS_MD_FULL = wrapInManagedBlock(AGENTS_MD_INNER);

/**
 * Generate a rich root-level AGENTS.md from what's on disk.
 *
 * Wave 4: sync paths no longer emit a root AGENTS.md; this helper is kept
 * exported for back-compat with external tooling and tests. The output now
 * names per-adapter native paths (`.claude/`, `.cursor/`, `.github/`) rather
 * than the removed `.agents/` tree.
 *
 * The content is wrapped in a managed block so user-added content outside the
 * block is preserved across syncs.
 *
 * Falls back to the static AGENTS_MD_FULL when the agents directory is empty
 * or unreadable.
 */
export async function generateRootAgentsMd(agentsDir: string): Promise<{ full: string; inner: string }> {
  const sections: string[] = [];

  sections.push("# Project Agent Instructions");
  sections.push("");
  sections.push("This project uses [hatch3r](https://github.com/hatch3r/hatch3r) for agentic coding orchestration.");
  sections.push("Per-adapter native paths (`.claude/`, `.cursor/`, `.github/`) hold the canonical instructions.");

  // Build agent roster from what's on disk
  const agents = await readDirFiles(join(agentsDir, "agents"));
  if (agents.length > 0) {
    sections.push("");
    sections.push("## Agents");
    sections.push("");
    sections.push("| Agent | Purpose |");
    sections.push("|-------|---------|");
    for (const agent of agents) {
      const { metadata } = parseFrontmatter(agent.content);
      const id = metadata.id || metadata.name || agent.name.replace(/\.md$/, "");
      const desc = metadata.description ?? "";
      sections.push(`| \`${id}\` | ${desc.slice(0, 100)} |`);
    }
  }

  // Build skill table from what's on disk
  const skills = await readSkillDirs(join(agentsDir, "skills"));
  if (skills.length > 0) {
    sections.push("");
    sections.push("## Skills");
    sections.push("");
    sections.push("| Skill | Description |");
    sections.push("|-------|-------------|");
    for (const skill of skills) {
      sections.push(`| \`${skill.id}\` | ${skill.description.slice(0, 100)} |`);
    }
  }

  // Build command list from what's on disk
  const commands = await readDirFiles(join(agentsDir, "commands"));
  if (commands.length > 0) {
    sections.push("");
    sections.push("## Commands");
    sections.push("");
    sections.push("| Command | Description |");
    sections.push("|---------|-------------|");
    for (const cmd of commands) {
      const { metadata } = parseFrontmatter(cmd.content);
      const id = metadata.id || metadata.name || cmd.name.replace(/\.md$/, "");
      const desc = metadata.description ?? "";
      sections.push(`| \`${id}\` | ${desc.slice(0, 100)} |`);
    }
  }

  sections.push("");
  sections.push("## Directory Structure");
  sections.push("");
  sections.push("- Rules: `.claude/rules/` / `.cursor/rules/` / `.github/instructions/`");
  sections.push("- Agents: `.claude/agents/` / `.cursor/agents/` / `.github/agents/`");
  sections.push("- Skills: `.claude/skills/` / `.cursor/skills/` / `.github/skills/`");
  sections.push("- Commands: `.claude/commands/` / `.cursor/commands/` / `.github/prompts/`");
  sections.push("- MCP: `.hatch3r/mcp/mcp.json`");
  sections.push("- Learnings: `.hatch3r/learnings/`");
  sections.push("- Handoffs: `.hatch3r/handoffs/`");
  sections.push("- Overrides: `.hatch3r/overrides/`");

  // If nothing dynamic was found, fall back to the static stub
  if (agents.length === 0 && skills.length === 0 && commands.length === 0) {
    return { full: AGENTS_MD_FULL, inner: AGENTS_MD_INNER };
  }

  const inner = sections.join("\n");
  const full = wrapInManagedBlock(inner);
  return { full, inner };
}

/**
 * Generate canonical AGENTS.md content based on the bundled canonical
 * content tree. Wave 4: kept exported for back-compat with external tooling
 * and tests; sync paths no longer emit a root or `.agents/` AGENTS.md.
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

1. **Load the matching skill** from the adapter-native skills directory (\`.claude/skills/\`, \`.cursor/skills/\`, or \`.github/skills/\`) based on task type before implementation.
2. **Score task complexity** per the \`hatch3r-deep-context\` rule.
3. **Spawn a researcher subagent** (\`hatch3r-researcher\`) for context gathering.
4. **Spawn an implementer subagent** (\`hatch3r-implementer\`) for code changes.
5. **Run the review loop** (Phase 3).
6. **Spawn final quality subagents** (Phase 4).
7. **Propagate rules** to all subagent prompts.
8. **Consult learnings** from \`.hatch3r/learnings/\`.`);

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
      sections.push("When loading a skill, follow its checklist steps below. Full skill content is in the adapter-native skills directory (`.claude/skills/{id}/SKILL.md`, `.cursor/skills/{id}/SKILL.md`, or `.github/skills/{id}/SKILL.md`).\n");
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

- Rules: \`.claude/rules/\` / \`.cursor/rules/\` / \`.github/instructions/\` — source of truth for all tool-specific rules
- Agents: \`.claude/agents/\` / \`.cursor/agents/\` / \`.github/agents/\` — agent definitions
- Skills: \`.claude/skills/\` / \`.cursor/skills/\` / \`.github/skills/\` — skill workflows
- Commands: \`.claude/commands/\` / \`.cursor/commands/\` / \`.github/prompts/\` — executable commands
- MCP: \`.hatch3r/mcp/mcp.json\` — MCP server configuration
- Learnings: \`.hatch3r/learnings/\` — project learnings (pitfalls, patterns, decisions)
- Handoffs: \`.hatch3r/handoffs/\` — cross-session task handoffs
- Overrides: \`.hatch3r/overrides/\` — user-tier customizations
`);

  return sections.join("\n");
}
