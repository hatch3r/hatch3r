// DD-D3 (release/2.8.5): moved verbatim from src/cli/shared/taskRouter.ts
// (import-boundary Rule 1 — consumed by the bridge-orchestration domain module).
// The old path is a re-export shim for one minor release.
import {
  type ContentIndex,
  type CatalogItem,
} from "../../content/index.js";
import { tagsForFacet } from "../../content/tags.js";

/**
 * D1-SA1.7-F9 (Cycle 10 Wave 4, D1/CQ8): the task-type → routing model,
 * extracted from the former monolithic `agentsContent.ts` so it is
 * separately coverable. The model has independent callers beyond bridge
 * generation and carries no shared mutable state with the bridge or
 * AGENTS.md generators. No behavior change — bodies moved verbatim.
 */

/**
 * Capability tags drive the task-router "workflow" rows (formerly WORKFLOW_TAGS).
 * Sourced from the capability facet in TAG_REGISTRY so additions are picked up
 * automatically — Wave 1 of the content-pack redesign replaced the flat
 * WORKFLOW_TAGS array with the capability facet of TAG_REGISTRY.
 */
const WORKFLOW_TAGS: string[] = tagsForFacet("capability");

/**
 * Domain-like specialisation tags drive the task-router "domain" rows. The new
 * taxonomy splits the old DOMAIN_TAGS into floor markers (`floor:*`),
 * customize, and UI/UX specialisations. The router needs every tag that can
 * meaningfully label a task type, so we concatenate all three facets.
 */
export const DOMAIN_TAGS: string[] = [
  ...tagsForFacet("floor"),
  ...tagsForFacet("customize"),
  ...tagsForFacet("ui-ux-specialisation"),
];

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
export function humanizeTaskType(tag: string): string {
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
export function bestTaskTypeForSkill(skillTags: string[], rows: TaskRouterRow[]): string | undefined {
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
