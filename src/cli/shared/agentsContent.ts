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
export const BRIDGE_ORCHESTRATION = `## Universal Sub-Agent Pipeline

Every task — board-pickup, workflow command, plain chat, single-task, or multi-task — MUST use this four-phase sub-agent pipeline. There are NO exceptions. Never implement code inline; always delegate to sub-agents.

**Phase 1 — Research:** Spawn \`hatch3r-researcher\` for context gathering. Skip only for trivial single-line edits (typos, comment fixes, single-value config changes). Score task complexity per \`hatch3r-deep-context\` rule and add tier-appropriate modes (\`requirements-elicitation\`, \`similar-implementation\`) alongside standard task-type modes.

**Phase 2 — Implement:** Spawn \`hatch3r-implementer\` for ALL code changes. One dedicated implementer per task. Never implement inline — always delegate. Include reference conventions, resolved requirements, and blast radius data from Phase 1 when available.

**Phase 3 — Review Loop:**
- 3a. Spawn \`hatch3r-reviewer\` to review the implementation.
- 3b. If Critical or Warning findings: spawn \`hatch3r-fixer\` with the reviewer output.
- 3c. Re-review: spawn \`hatch3r-reviewer\` on the fixed code.
- 3d. Repeat 3b–3c until reviewer reports 0 Critical + 0 Warning, or max 3 iterations reached.
- 3e. If max iterations reached with remaining findings: surface to user.

**Phase 4 — Final Quality** (runs ONLY after review loop is clean):
- \`hatch3r-test-writer\` — ALWAYS for code changes (mandatory, not just bugs)
- \`hatch3r-security-auditor\` — ALWAYS for code changes (mandatory, not just area:security)
- \`hatch3r-docs-writer\` — ALWAYS evaluate; spawn when changes affect APIs, architecture, or user-facing behavior
- \`hatch3r-lint-fixer\` — when lint errors present after implementation
- \`hatch3r-a11y-auditor\` — when UI/accessibility changes
- \`hatch3r-perf-profiler\` — when performance-sensitive changes
- \`hatch3r-dependency-auditor\` — when dependencies change

For plain chat tasks without issue context: classify the task (bug/feature/refactor/QA), create synthetic issue context (title, acceptance criteria, type), then run the full pipeline above.

## Mandatory Behaviors

1. **Load the matching skill** before implementing any task. Read \`/.agents/skills/\` for the skill matching the task type (bug-fix, feature, refactor, qa-validation, etc.).
2. **Use the Task tool** (\`subagent_type: "generalPurpose"\`) for all agent delegations. Launch as many independent subagents in parallel as the platform supports — no artificial concurrency limit.
3. **Propagate rules to subagents**: include all \`scope: always\` rule directives in subagent prompts — subagents do not inherit the parent's rule context automatically.
4. **Consult learnings**: check \`/.agents/learnings/\` for relevant pitfalls and patterns before implementation.

## Agent Quick Reference

| Agent | When to Use |
|-------|-------------|
| \`hatch3r-researcher\` | ALWAYS before implementation (skip only for trivial single-line edits) |
| \`hatch3r-implementer\` | ALWAYS. One dedicated implementer per task — standalone, epic sub-issue, batch, or plain chat |
| \`hatch3r-learnings-loader\` | When consulting project learnings or historical decisions |
| \`hatch3r-reviewer\` | ALWAYS in review loop (Phase 3); reviews and re-reviews until clean |
| \`hatch3r-fixer\` | When reviewer reports Critical or Warning findings (Phase 3 review loop) |
| \`hatch3r-test-writer\` | ALWAYS for code changes (Phase 4 final quality) |
| \`hatch3r-security-auditor\` | ALWAYS for code changes (Phase 4 final quality) |
| \`hatch3r-docs-writer\` | ALWAYS evaluate; spawn when documentation impact exists (Phase 4 final quality) |
| \`hatch3r-lint-fixer\` | When lint/type errors present after implementation |
| \`hatch3r-a11y-auditor\` | When UI/accessibility changes |
| \`hatch3r-architect\` | When making architectural decisions, designing APIs, or evaluating design trade-offs |
| \`hatch3r-perf-profiler\` | When performance-sensitive changes |
| \`hatch3r-dependency-auditor\` | When dependencies change |
| \`hatch3r-ci-watcher\` | When CI fails |
| \`hatch3r-context-rules\` | When establishing or updating project-specific coding patterns and conventions |
| \`hatch3r-devops\` | When infrastructure, deployment, or CI/CD changes are needed |

See the \`hatch3r-agent-orchestration\` rule in \`/.agents/rules/\` for the full orchestration protocol.

## Canonical Structure

- Rules: \`/.agents/rules/\` (source of truth for all tool-specific rules)
- Agents: \`/.agents/agents/\` (agent definitions)
- Skills: \`/.agents/skills/\` (skill workflows)
- Commands: \`/.agents/commands/\` (executable commands)
- MCP: \`/.agents/mcp/mcp.json\` (MCP server configuration)
- Policy: \`/.agents/policy/\` (guardrails and deny lists)

Do not manually edit files with the \`hatch3r-\` prefix -- they are managed by hatch3r
and will be overwritten on update. Create non-prefixed files for customizations.`;

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

  // Build skill dispatch table from what's on disk
  const skills = await readSkillDirs(join(agentsDir, "skills"));
  if (skills.length > 0) {
    sections.push("\n## Available Skills\n");
    sections.push("| Skill | Description |");
    sections.push("|-------|-------------|");
    for (const skill of skills) {
      sections.push(`| \`${skill.id}\` | ${skill.description.slice(0, 100)} |`);
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

async function readSkillDirs(dir: string): Promise<{ id: string; description: string }[]> {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    const skills: { id: string; description: string }[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      try {
        const raw = await readFile(join(dir, entry.name, "SKILL.md"), "utf-8");
        const { metadata } = parseFrontmatter(raw);
        skills.push({
          id: metadata.id || metadata.name || entry.name,
          description: metadata.description ?? "",
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
