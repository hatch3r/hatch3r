import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { wrapInManagedBlock } from "../../merge/managedBlocks.js";
import { parseFrontmatter } from "../../adapters/canonical.js";
import {
  buildContentIndex,
  COMMAND_ID_PREFIX,
  type ContentIndex,
  type CatalogItem,
} from "../../content/index.js";
import { WORKFLOW_TAGS, DOMAIN_TAGS } from "../../content/tags.js";
import { verbose } from "./ui.js";

/**
 * Record an agentsContent-probe failure: emit a verbose() line to stderr
 * (visible only with --verbose). Per D8-H8.4.6 (C9-H19) Silent Failure Contract.
 */
function recordAgentsContentProbeFailure(operation: string, err: unknown): void {
  const message = err instanceof Error ? err.message : String(err);
  verbose(`agentsContent: ${operation} — ${message}`);
}

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
**Week 1 — Skills & commands:** Load skills from \`/.agents/skills/\` matching your task type. Try \`/hatch3r-feature-plan\` or \`/hatch3r-bug-plan\` commands.
**Week 2 — Board & team:** If using project management, run \`/hatch3r-board-init\` to set up your board. Use \`/hatch3r-board-pickup\` for structured delivery.
**Ongoing — Customization:** Override agent behavior via \`.hatch3r/{type}/{id}.customize.yaml\`. Add project learnings to \`/.agents/learnings/\`.`;

const GETTING_STARTED_MINIMAL = `## Getting Started (minimal preset)

You are running the **minimal** content preset — only core agents and workflows are installed. This keeps token usage low and focuses on essentials.

**Day 1 — Core workflow:** Use the 4-phase pipeline above for any task. Start by invoking \`hatch3r-researcher\` for context, then \`hatch3r-implementer\` for changes.
**Expanding later:** Run \`npx hatch3r config\` to switch to the Standard or Full preset and unlock additional skills, commands, and audits.`;

// ── Task routing model ────────────────────────────────────────

/**
 * Classification of the primary entry for a {@link TaskRouterRow}. Tells the
 * rendering layer how to present the entry so the reader knows whether to
 * invoke it via the Task tool (agent), as a slash command, or by loading
 * the skill (skill descriptions surface in auto-select context).
 */
export type TaskRouterPrimaryKind = "agent" | "command" | "skill";

/**
 * One row of the task-type → routing table produced by
 * {@link buildTaskRouterModel}. Each row represents one recognisable task
 * type (workflow or domain tag) and names the primary entry alongside
 * fallbacks, relevant skills, and relevant rules so adapter bridge text
 * can help models pick the right delegate when the task type is clear but
 * the best entry is not.
 */
export interface TaskRouterRow {
  /** Human-friendly task-type label derived from the source tag. */
  taskType: string;
  /** Source tag (workflow or domain) the row was derived from. */
  tag: string;
  /** Classification of the source tag. */
  tagKind: "workflow" | "domain";
  /**
   * Best-matching entry for this task type. Resolution order:
   *   1. agent with matching tag
   *   2. command with matching tag
   *   3. skill with matching tag
   * Rows where none of the three yields a match are omitted from the model.
   */
  primary: { kind: TaskRouterPrimaryKind; id: string };
  /** Other agent ids tagged for this task type (primary excluded). */
  fallbackAgents: string[];
  /** Skill ids whose tags include the source tag. */
  relevantSkills: string[];
  /** Rule ids whose tags include the source tag. */
  relevantRules: string[];
}

/** Map a raw tag to a human-friendly task-type label used in the routing table. */
function humanizeTaskType(tag: string): string {
  switch (tag) {
    case "core":
      return "core-workflow";
    case "planning":
      return "planning";
    case "implementation":
      return "implementation";
    case "review":
      return "review";
    case "devops":
      return "devops";
    case "maintenance":
      return "maintenance";
    case "board":
      return "board";
    case "security":
      return "security-review";
    case "a11y":
      return "accessibility";
    case "performance":
      return "performance";
    case "customize":
      return "customize";
    default:
      return tag;
  }
}

/** Tags considered non-substantive for ranking focus (context/team filters). */
const CONTEXT_RANK_TAGS = new Set<string>(["greenfield", "brownfield", "solo", "team"]);

/**
 * Score how strongly a catalog item matches a target tag when choosing a
 * primary. Lower is better. The ranking applies uniformly to agents,
 * commands, and skills so fallback resolution (agent → command → skill)
 * can use a single comparator.
 *
 * 1. Explicit `id` match with the tag name (e.g. `hatch3r-reviewer` for `review`).
 * 2. For workflow tags: prefer items that also carry `core` (orchestration
 *    generalists), then items with fewer extra domain tags so the row points
 *    at a focused workflow owner rather than a sub-domain specialist.
 * 3. For domain tags: prefer items with more domain coverage (specialists).
 * 4. Alphabetical `id` as the final tie-break so ordering is stable.
 */
function rankItemForTag(
  item: CatalogItem,
  tag: string,
  tagKind: "workflow" | "domain",
): number[] {
  const idLower = item.id.toLowerCase();
  const tagLower = tag.toLowerCase();
  // Prefer an id that contains the tag name verbatim; otherwise accept a
  // morphological root match (first 5 chars) so "implementation" still maps
  // to "hatch3r-implementer". The 5-char floor avoids false positives like
  // tag "a11y" matching unrelated ids.
  let idMatch = 2;
  if (idLower.includes(tagLower)) idMatch = 0;
  else if (tagLower.length >= 5 && idLower.includes(tagLower.slice(0, 5))) idMatch = 1;
  const hasCore = item.tags.includes("core") ? 0 : 1;
  const substantiveTags = item.tags.filter((t) => !CONTEXT_RANK_TAGS.has(t));
  const domainCount = substantiveTags.filter((t) => (DOMAIN_TAGS as string[]).includes(t)).length;
  const focusScore =
    tagKind === "workflow"
      ? substantiveTags.length // fewer tags = more workflow-focused
      : -domainCount; // more domain tags = more specialised
  return [idMatch, hasCore, focusScore];
}

/** Compare two number-tuple rank vectors lexicographically. */
function compareRankVectors(a: number[], b: number[]): number {
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const av = a[i] ?? 0;
    const bv = b[i] ?? 0;
    if (av !== bv) return av - bv;
  }
  return 0;
}

/**
 * Rank a set of tag-matched catalog items deterministically: rank vector
 * first, alphabetical id as final tie-break.
 */
function rankMatches(
  items: CatalogItem[],
  tag: string,
  kind: "workflow" | "domain",
): CatalogItem[] {
  return [...items].sort((a, b) => {
    const rankDiff = compareRankVectors(rankItemForTag(a, tag, kind), rankItemForTag(b, tag, kind));
    if (rankDiff !== 0) return rankDiff;
    return a.id.localeCompare(b.id);
  });
}

/**
 * Build the task-type → routing model from a {@link ContentIndex}.
 *
 * Produces one row per workflow tag (`core`, `planning`, `implementation`,
 * `review`, `devops`, `maintenance`) and per domain tag (`board`, `security`,
 * `a11y`, `performance`, `customize`) that has at least one matching
 * agent, command, or skill. When no agent carries the tag the primary
 * falls back to a command, then a skill, so tags like `board` (commands
 * only) and `customize` (commands + skills) still surface. Rows are
 * omitted only when none of the three content types has a match.
 *
 * Exported for testability; `generateBridgeOrchestration` calls it to fill
 * the `Task Type` column in the skill dispatch table and to render the
 * `## Task Type → Routing` section.
 */
export function buildTaskRouterModel(index: ContentIndex): TaskRouterRow[] {
  const agents = index.byType["agent"] ?? [];
  const commands = index.byType["command"] ?? [];
  const skills = index.byType["skill"] ?? [];
  const rules = index.byType["rule"] ?? [];

  const rows: TaskRouterRow[] = [];

  const build = (tag: string, kind: "workflow" | "domain"): TaskRouterRow | null => {
    // Resolve primary in priority order: agent → command → skill.
    const rankedAgents = rankMatches(agents.filter((a) => a.tags.includes(tag)), tag, kind);
    // Fallbacks remain agent-only so the `Fallback Agents` column only lists
    // Task-tool delegates. When no agent matches, the slice is empty.
    const fallbackAgents = rankedAgents.slice(1).map((a) => a.id);

    let primary: { kind: TaskRouterPrimaryKind; id: string } | null = null;
    if (rankedAgents.length > 0) {
      primary = { kind: "agent", id: rankedAgents[0].id };
    } else {
      const rankedCommands = rankMatches(commands.filter((c) => c.tags.includes(tag)), tag, kind);
      if (rankedCommands.length > 0) {
        primary = { kind: "command", id: rankedCommands[0].id };
      } else {
        const rankedSkills = rankMatches(skills.filter((s) => s.tags.includes(tag)), tag, kind);
        if (rankedSkills.length > 0) {
          primary = { kind: "skill", id: rankedSkills[0].id };
        }
      }
    }

    if (!primary) return null;

    const matchingSkills = skills.filter((s) => s.tags.includes(tag)).map((s) => s.id);
    const matchingRules = rules.filter((r) => r.tags.includes(tag)).map((r) => r.id);
    matchingSkills.sort((a, b) => a.localeCompare(b));
    matchingRules.sort((a, b) => a.localeCompare(b));

    return {
      taskType: humanizeTaskType(tag),
      tag,
      tagKind: kind,
      primary,
      fallbackAgents,
      relevantSkills: matchingSkills,
      relevantRules: matchingRules,
    };
  };

  for (const tag of WORKFLOW_TAGS) {
    const row = build(tag, "workflow");
    if (row) rows.push(row);
  }
  for (const tag of DOMAIN_TAGS) {
    const row = build(tag, "domain");
    if (row) rows.push(row);
  }

  return rows;
}

/**
 * Pick the best-matching task-type label for a skill from the router model.
 * Prefers domain matches over workflow matches so a `[review, a11y]` skill
 * lands in the `accessibility` column rather than the generic `review` one.
 * Returns the tag name itself when no router row matches — this keeps the
 * fallback compact and still informative. Returns undefined only when the
 * skill has no tags at all.
 */
function bestTaskTypeForSkill(skillTags: string[], rows: TaskRouterRow[]): string | undefined {
  if (skillTags.length === 0) return undefined;
  const tagSet = new Set(skillTags);
  // Prefer a domain row first, then workflow row.
  const domainMatch = rows.find((r) => r.tagKind === "domain" && tagSet.has(r.tag));
  if (domainMatch) return domainMatch.taskType;
  const workflowMatch = rows.find((r) => r.tagKind === "workflow" && tagSet.has(r.tag));
  if (workflowMatch) return workflowMatch.taskType;
  // No router row matched but skill does have tags — fall back to the first
  // tag so the column is still informative rather than "—".
  return humanizeTaskType(skillTags[0]);
}

/**
 * Render a {@link TaskRouterRow} primary entry with a visible kind hint so
 * readers know how to invoke it:
 *   - agent:   `hatch3r-researcher`
 *   - command: `/hatch3r-board-pickup` (cmd- index prefix stripped)
 *   - skill:   `hatch3r-agent-customize` _(skill)_
 */
function renderPrimary(primary: { kind: TaskRouterPrimaryKind; id: string }): string {
  switch (primary.kind) {
    case "agent":
      return `\`${primary.id}\``;
    case "command": {
      // Command IDs in the content index carry the `cmd-` collision-safety
      // prefix; strip it so the cell shows the real slash-command a user
      // types into the chat (e.g. `/hatch3r-board-pickup`).
      const slashId = primary.id.startsWith(COMMAND_ID_PREFIX)
        ? primary.id.slice(COMMAND_ID_PREFIX.length)
        : primary.id;
      return `\`/${slashId}\``;
    }
    case "skill":
      return `\`${primary.id}\` _(skill)_`;
  }
}

/**
 * Render a list of ids as a comma-separated backtick-quoted string with a
 * top-N cap. Surplus entries collapse into a `+N more` suffix so the bridge
 * cell stays narrow for platforms that render markdown tables in fixed-width
 * columns.
 */
function renderIdList(ids: string[], max = 3): string {
  if (ids.length === 0) return "—";
  const top = ids.slice(0, max).map((id) => `\`${id}\``).join(", ");
  const remainder = ids.length - max;
  return remainder > 0 ? `${top}, +${remainder} more` : top;
}

/**
 * Generate bridge orchestration with an inline skill dispatch table.
 * Falls back to the static BRIDGE_ORCHESTRATION if agentsDir is unavailable.
 *
 * @param preset - Content preset from the manifest. When "minimal", the Getting
 *   Started section is replaced with minimal-specific messaging that sets
 *   expectations about reduced content and explains how to expand later.
 */
export async function generateBridgeOrchestration(agentsDir: string, preset?: string): Promise<string> {
  let base = BRIDGE_ORCHESTRATION;

  // Swap Getting Started section for minimal preset users (#99 D19)
  if (preset === "minimal") {
    const gsStart = base.indexOf("## Getting Started");
    if (gsStart !== -1) {
      base = base.slice(0, gsStart) + GETTING_STARTED_MINIMAL;
    }
  }

  const skills = await readSkillDirs(join(agentsDir, "skills"));
  if (skills.length === 0) return base;

  // Build the router model from the installed content index so the skill
  // dispatch table's `Task Type` column and the new routing section stay in
  // sync with what the user actually has on disk. The index also feeds the
  // skill-id → tags lookup used to fill the `Task Type` column.
  let routerRows: TaskRouterRow[] = [];
  const skillTagMap = new Map<string, string[]>();
  try {
    const index = await buildContentIndex(agentsDir);
    routerRows = buildTaskRouterModel(index);
    for (const s of index.byType["skill"] ?? []) {
      skillTagMap.set(s.id, s.tags);
    }
  } catch (err) {
    // Index building is best-effort: on any error (missing dirs, unreadable
    // files) we fall through and emit the skill table with `—` placeholders
    // rather than failing the entire bridge generation. Emit a diagnostic
    // so the failure is not invisible (P5 anti-silent-failure).
    if (process.env.DEBUG) {
      console.warn(`[hatch3r] bridge router index failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  const skillTable = [
    "\n## Skill Dispatch Table\n",
    "Load the matching skill before implementation. Full content in `/.agents/skills/{id}/SKILL.md`.\n",
    "| Task Type | Skill | Description |",
    "|-----------|-------|-------------|",
  ];
  for (const skill of skills) {
    const tags = skillTagMap.get(skill.id) ?? [];
    const taskType = bestTaskTypeForSkill(tags, routerRows) ?? "—";
    skillTable.push(`| ${taskType} | \`${skill.id}\` | ${skill.description.slice(0, 80)} |`);
  }

  // Append the task-type routing section when we have at least one router row.
  if (routerRows.length > 0) {
    skillTable.push("");
    skillTable.push("## Task Type → Routing\n");
    skillTable.push(
      "Use this table when the task type is clear but the right entry isn't. Primary shows an agent (invoke via Task tool), a slash-command (type directly), or a skill (auto-selected by description):\n",
    );
    skillTable.push("| Task Type | Primary | Fallback Agents | Skills | Rules |");
    skillTable.push("|-----------|---------|-----------------|--------|-------|");
    for (const row of routerRows) {
      skillTable.push(
        `| ${row.taskType} | ${renderPrimary(row.primary)} | ${renderIdList(row.fallbackAgents)} | ${renderIdList(row.relevantSkills)} | ${renderIdList(row.relevantRules)} |`,
      );
    }
  }

  // Insert skill table after the Agent Quick Reference table
  const insertPoint = "Do not edit `hatch3r-` prefixed files";
  const idx = base.indexOf(insertPoint);
  if (idx === -1) return base;

  return (
    base.slice(0, idx) +
    skillTable.join("\n") +
    "\n\n" +
    base.slice(idx)
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

export const AGENTS_MD_FULL = wrapInManagedBlock(AGENTS_MD_INNER);

/**
 * Generate a rich root-level AGENTS.md from what's on disk.
 *
 * Platforms like GitHub Copilot, Cursor, and others scan for AGENTS.md at the
 * project root. This function produces inline agent/skill/command rosters so
 * those platforms discover available agents without following a pointer to
 * `/.agents/AGENTS.md`.
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
  sections.push("Full canonical instructions are at `/.agents/AGENTS.md`.");

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
  sections.push("- Rules: `/.agents/rules/`");
  sections.push("- Agents: `/.agents/agents/`");
  sections.push("- Skills: `/.agents/skills/`");
  sections.push("- Commands: `/.agents/commands/`");
  sections.push("- MCP: `/.agents/mcp/mcp.json`");
  sections.push("- Learnings: `/.agents/learnings/`");

  // If nothing dynamic was found, fall back to the static stub
  if (agents.length === 0 && skills.length === 0 && commands.length === 0) {
    return { full: AGENTS_MD_FULL, inner: AGENTS_MD_INNER };
  }

  const inner = sections.join("\n");
  const full = wrapInManagedBlock(inner);
  return { full, inner };
}

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
  } catch (err) {
    recordAgentsContentProbeFailure(`readDirFiles(${dir}) → [] — directory missing`, err);
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
      } catch (err) {
        recordAgentsContentProbeFailure(
          `readSkillDirs: readFile(${dir}/${entry.name}/SKILL.md) skipped`,
          err,
        );
      }
    }
    return skills.sort((a, b) => a.id.localeCompare(b.id));
  } catch (err) {
    recordAgentsContentProbeFailure(
      `readSkillDirs(${dir}) → [] — directory missing`,
      err,
    );
    return [];
  }
}
