import { join } from "node:path";
import {
  buildContentIndex,
  COMMAND_ID_PREFIX,
} from "../../content/index.js";
import { readSkillDirs } from "./agentsContentShared.js";
import {
  buildTaskRouterModel,
  bestTaskTypeForSkill,
  type TaskRouterRow,
  type TaskRouterPrimaryKind,
} from "./taskRouter.js";

/**
 * D1-SA1.7-F9 (Cycle 10 Wave 4, D1/CQ8): bridge-orchestration text builder
 * and generator, extracted from the former monolithic `agentsContent.ts`.
 * No behavior change — bodies moved verbatim; the task-router model and the
 * shared filesystem readers are now imported from their own modules.
 *
 * Wave 4: bridge orchestration is now adapter-aware. The 3 retained adapters
 * (claude/cursor/copilot) materialise their canonical content under distinct
 * native paths (`.claude/`, `.cursor/`, `.github/`), so the bridge text in
 * each adapter's CLAUDE.md / `.cursor/rules/hatch3r-bridge.mdc` /
 * `.github/copilot-instructions.md` references the correct on-disk locations.
 *
 * Per-adapter native paths used by {@link bridgeAdapterPaths}:
 *   - claude:  rules `.claude/rules/`, agents `.claude/agents/`,
 *              skills `.claude/skills/`, commands `.claude/commands/`
 *   - cursor:  rules `.cursor/rules/`, agents `.cursor/agents/`,
 *              skills `.cursor/skills/`, commands `.cursor/commands/`
 *   - copilot: rules `.github/instructions/`, agents `.github/agents/`,
 *              skills `.github/skills/`, commands `.github/prompts/`
 *
 * Shared `.hatch3r/` paths apply uniformly across adapters (learnings,
 * handoffs, overrides, mcp). Wave 5+6 establish the `.hatch3r/` subtree;
 * the bridge text references the destination paths now so the file is
 * forward-compatible.
 */
export type BridgeAdapter = "claude" | "cursor" | "copilot";

interface BridgeAdapterPaths {
  rulesDir: string;
  agentsDir: string;
  skillsDir: string;
  commandsDir: string;
}

const BRIDGE_ADAPTER_PATHS: Record<BridgeAdapter, BridgeAdapterPaths> = {
  claude: {
    rulesDir: ".claude/rules/",
    agentsDir: ".claude/agents/",
    skillsDir: ".claude/skills/",
    commandsDir: ".claude/commands/",
  },
  cursor: {
    rulesDir: ".cursor/rules/",
    agentsDir: ".cursor/agents/",
    skillsDir: ".cursor/skills/",
    commandsDir: ".cursor/commands/",
  },
  copilot: {
    rulesDir: ".github/instructions/",
    agentsDir: ".github/agents/",
    skillsDir: ".github/skills/",
    commandsDir: ".github/prompts/",
  },
};

function bridgeAdapterPaths(adapter?: string): BridgeAdapterPaths {
  // Default to claude paths when no adapter is named — keeps standalone
  // callers (and the static BRIDGE_ORCHESTRATION export) compiling without
  // forcing every caller to thread the adapter id immediately.
  return BRIDGE_ADAPTER_PATHS[(adapter ?? "claude") as BridgeAdapter]
    ?? BRIDGE_ADAPTER_PATHS.claude;
}

/**
 * Build the bridge orchestration body with adapter-native paths. Templated
 * over the four canonical content directories so each adapter's bridge file
 * cites the on-disk paths the user actually has after sync.
 */
function buildBridgeOrchestration(adapter?: string): string {
  const p = bridgeAdapterPaths(adapter);
  return `## Sub-Agent Pipeline (mandatory, no exceptions)

All tasks use this four-phase pipeline. Never implement inline; always delegate.

**Phase 1 — Research:** Spawn \`hatch3r-researcher\`. Skip only for trivial edits. Score complexity per \`hatch3r-deep-context\` and add tier modes.
**Phase 2 — Implement:** Spawn \`hatch3r-implementer\` (one per task). Pass research context.
**Phase 3 — Review Loop:** \`hatch3r-reviewer\` → if Critical/Warning: \`hatch3r-fixer\` → re-review → repeat (max 3). After clean verdict: one confirmation pass (regressions, acceptance criteria). Remaining findings after max iterations → surface to user.
**Phase 4 — Final Quality** (after clean review): \`hatch3r-testability\` + \`hatch3r-security\` (always), \`hatch3r-docs-writer\` (evaluate), then conditional CQ specialists: \`hatch3r-ui\`, \`hatch3r-ux\`, \`hatch3r-reliability\`, \`hatch3r-scalability\`, \`hatch3r-performance\`, \`hatch3r-maintainability\`, \`hatch3r-enhancability\`, plus \`hatch3r-lint-fixer\`.

## Mandatory Behaviors

1. **Load skill** from \`${p.skillsDir}\` matching task type before implementation.
2. **Task tool** (\`subagent_type: "generalPurpose"\`) for all delegations. Max parallelism.
3. **Propagate rules**: include \`scope: always\` directives in subagent prompts.
4. **Consult learnings**: check \`.hatch3r/learnings/\` before implementation.
5. **Consult specs**: if \`docs/specs/\` exists, read relevant specifications before implementation and cross-reference during review.

## Agent Quick Reference

| Agent | When |
|-------|------|
| \`hatch3r-researcher\` | Always before impl (skip trivial edits) |
| \`hatch3r-implementer\` | Always — one per task |
| \`hatch3r-reviewer\` | Always (Phase 3 loop) |
| \`hatch3r-fixer\` | Critical/Warning findings (Phase 3) |
| \`hatch3r-testability\` (CQ5) | Always for code changes (Phase 4) |
| \`hatch3r-security\` (CQ3) | Always for code changes (Phase 4); dependency-file changes |
| \`hatch3r-docs-writer\` | Evaluate; spawn if doc impact (Phase 4) |
| \`hatch3r-lint-fixer\` | Lint/type errors after impl |
| \`hatch3r-ui\` (CQ1) | UI/accessibility changes |
| \`hatch3r-architect\` | Architectural decisions, API design |
| \`hatch3r-performance\` (CQ7) | Performance-sensitive changes |
| \`hatch3r-ci-watcher\` | CI failures |
| \`hatch3r-devops\` | Infra, deployment, CI/CD changes |

Full protocol: \`hatch3r-agent-orchestration\` rule in \`${p.rulesDir}\`.

## Canonical Structure

- Rules: \`${p.rulesDir}\` — Agents: \`${p.agentsDir}\` — Skills: \`${p.skillsDir}\`
- Commands: \`${p.commandsDir}\` — MCP: \`.hatch3r/mcp/mcp.json\` — Learnings: \`.hatch3r/learnings/\` — Handoffs: \`.hatch3r/handoffs/\` — Overrides: \`.hatch3r/overrides/\`

Do not edit \`hatch3r-\` prefixed files — managed by hatch3r, overwritten on update.

## Getting Started (staged introduction)

New to hatch3r? Start here and expand as you go:

**Day 1 — Core workflow:** Use the 4-phase pipeline above for any task. Start by invoking \`hatch3r-researcher\` for context, then \`hatch3r-implementer\` for changes.
**Week 1 — Skills & commands:** Load skills from \`${p.skillsDir}\` matching your task type. Try \`/hatch3r-feature-plan\` or \`/hatch3r-bug-plan\` commands.
**Week 2 — Board & team:** If using project management, invoke the \`hatch3r-board-init\` skill to set up your board. Use \`/hatch3r-board-pickup\` for structured delivery.
**Ongoing — Customization:** Override agent behavior via \`.hatch3r/overrides/{type}/{id}.customize.yaml\`. Add project learnings to \`.hatch3r/learnings/\`.`;
}

/**
 * Backwards-compatible default export — equivalent to the claude-adapter
 * shape. Kept exported because external tooling and tests may reference it.
 * New callers should prefer {@link generateBridgeOrchestration} with an
 * explicit adapter id, which routes through {@link buildBridgeOrchestration}.
 */
export const BRIDGE_ORCHESTRATION = buildBridgeOrchestration("claude");

const GETTING_STARTED_MINIMAL = `## Getting Started (minimal preset)

You are running the **minimal** content preset — only core agents and workflows are installed. This keeps token usage low and focuses on essentials.

**Day 1 — Core workflow:** Use the 4-phase pipeline above for any task. Start by invoking \`hatch3r-researcher\` for context, then \`hatch3r-implementer\` for changes.
**Expanding later:** Run \`npx hatch3r config\` to switch to the Standard or Full preset and unlock additional skills, commands, and audits.`;

/**
 * Render a {@link TaskRouterRow} primary entry with a visible kind hint so
 * readers know how to invoke it:
 *   - agent:   `hatch3r-researcher`
 *   - command: `/hatch3r-board-pickup` (cmd- index prefix stripped)
 *   - skill:   `hatch3r-customize` _(skill)_
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
 * Falls back to the adapter-shaped static template if `canonicalRoot` is
 * unavailable (no skills directory).
 *
 * @param canonicalRoot - Bundled canonical-content root (see
 *   `src/content/contentRoot.ts::resolveBundledContentRoot`). Used to read
 *   the skills directory for the dispatch table.
 * @param preset - Content preset from the manifest. When "minimal", the
 *   Getting Started section is replaced with minimal-specific messaging.
 * @param adapter - Adapter id (`claude` | `cursor` | `copilot`). Drives the
 *   adapter-native path templating in the orchestration body. Defaults to
 *   `claude` to preserve backwards-compatible output when the caller does
 *   not name an adapter.
 */
export async function generateBridgeOrchestration(
  canonicalRoot: string,
  preset?: string,
  adapter?: string,
): Promise<string> {
  let base = buildBridgeOrchestration(adapter);

  // Swap Getting Started section for minimal preset users (#99 D19)
  if (preset === "minimal") {
    const gsStart = base.indexOf("## Getting Started");
    if (gsStart !== -1) {
      base = base.slice(0, gsStart) + GETTING_STARTED_MINIMAL;
    }
  }

  const skills = await readSkillDirs(join(canonicalRoot, "skills"));
  if (skills.length === 0) return base;

  // Build the router model from the bundled content index so the skill
  // dispatch table's `Task Type` column and the new routing section stay in
  // sync with the canonical catalogue. The index also feeds the
  // skill-id → tags lookup used to fill the `Task Type` column.
  let routerRows: TaskRouterRow[] = [];
  const skillTagMap = new Map<string, string[]>();
  try {
    const index = await buildContentIndex(canonicalRoot);
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

  const p = bridgeAdapterPaths(adapter);
  const skillTable = [
    "\n## Skill Dispatch Table\n",
    `Load the matching skill before implementation. Full content in \`${p.skillsDir}{id}/SKILL.md\`.\n`,
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

  // F6.1.7 (D6-SA6.1, cycle 10 wave 4): append the dynamic Skill Dispatch
  // Table + Task Type → Routing section at the very END of the bridge body,
  // AFTER the static "Getting Started" appendix. Previously this content was
  // spliced mid-body (before the "Do not edit hatch3r- prefixed files"
  // anchor), which placed variable-length content (skill-row count grows with
  // the canonical catalogue) inside the otherwise-static frame. Keeping all
  // variable content at the bottom preserves a stable static prefix for
  // prompt-cache reuse per the static-first principle
  // (agents/shared/efficiency-patterns.md P1; Anthropic/OpenAI prompt-caching
  // guidance: place static content first, variable content last).
  const trimmedBase = base.replace(/\s+$/, "");
  return trimmedBase + "\n" + skillTable.join("\n") + "\n";
}
