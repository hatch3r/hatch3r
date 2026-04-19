import inquirer from "inquirer";
import type { CatalogItem } from "../../content/index.js";

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
  | { name: string; value: string; checked: boolean };

/**
 * Build inquirer checkbox choices grouped by each item's primary tag (init/config custom preset).
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
      groupedChoices.push({
        name: `${item.type}: ${item.id.replace(/^(cmd-)?hatch3r-/, "")} — ${item.description.slice(0, 60)}`,
        value: item.id,
        checked: isChecked(item),
      });
    }
  }
  return groupedChoices;
}
