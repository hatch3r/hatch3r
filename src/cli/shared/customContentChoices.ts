import inquirer from "inquirer";
import { ORCHESTRATION_REQUIRED_AGENTS, type CatalogItem } from "../../content/index.js";

/** Display labels for primary content tags (custom profile checkbox groups). */
const CONTENT_TAG_LABELS: Record<string, string> = {
  core: "Core",
  planning: "Planning",
  implementation: "Implementation",
  review: "Review",
  devops: "DevOps",
  maintenance: "Maintenance",
  greenfield: "Greenfield",
  brownfield: "Brownfield",
  board: "Board",
  security: "Security",
  a11y: "Accessibility",
  performance: "Performance",
  customize: "Customization",
  other: "Other",
};

type TagGroupedCustomContentChoice =
  | InstanceType<typeof inquirer.Separator>
  | { name: string; value: string; checked: boolean; description?: string };

/**
 * Build inquirer checkbox choices grouped by each item's primary tag (init/config custom preset).
 *
 * D10-M18 (Cycle 10 rollover): each item carries an optional `description`
 * field that names its orchestration role inline. Items in the 4-phase
 * pipeline allowlist (`ORCHESTRATION_REQUIRED_AGENTS`) render
 * `Required by the 4-phase pipeline (research → implement → review →
 * quality). Deselecting will trip a validateOrchestrationDependencies
 * warning.` so a user deselecting them sees the chain consequence at the
 * row, not only in the post-submission warning loop. Items tagged
 * `protected` or `core` carry a shorter `Floor / core` note so the
 * structural-invariant items are visibly distinct from optional ones.
 */
export function buildTagGroupedCustomContentChoices(
  items: CatalogItem[],
  isChecked: (item: CatalogItem) => boolean,
): TagGroupedCustomContentChoice[] {
  const tagGroups = new Map<string, CatalogItem[]>();
  for (const item of items) {
    const primaryTag = item.tags[0] ?? "other";
    if (!tagGroups.has(primaryTag)) tagGroups.set(primaryTag, []);
    tagGroups.get(primaryTag)!.push(item);
  }

  const groupedChoices: TagGroupedCustomContentChoice[] = [];
  for (const [tag, groupItems] of tagGroups) {
    groupedChoices.push(
      new inquirer.Separator(`── ${CONTENT_TAG_LABELS[tag] ?? tag} (${groupItems.length}) ──`),
    );
    for (const item of groupItems) {
      let description: string | undefined;
      if (
        item.type === "agent" &&
        (ORCHESTRATION_REQUIRED_AGENTS as readonly string[]).includes(item.id)
      ) {
        description =
          "Required by the 4-phase pipeline (research → implement → review → quality). " +
          "Deselecting trips a validateOrchestrationDependencies warning.";
      } else if (item.protected || item.tags.includes("core")) {
        description = "Floor / core — pre-checked; recommend keeping selected.";
      }
      groupedChoices.push({
        name: `${item.type}: ${item.id.replace(/^(cmd-)?hatch3r-/, "")} — ${item.description.slice(0, 60)}`,
        value: item.id,
        checked: isChecked(item),
        ...(description ? { description } : {}),
      });
    }
  }
  return groupedChoices;
}
