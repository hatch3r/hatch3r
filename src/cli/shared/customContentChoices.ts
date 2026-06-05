import inquirer from "inquirer";
import { ORCHESTRATION_REQUIRED_AGENTS, type CatalogItem } from "../../content/index.js";
import { admitsUnconditionally } from "../../content/tags.js";

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
    // D10-SA10.6-F10.6-8: group under the item's PRIMARY tag = `tags[0]`.
    // This is a documented authoring contract, not an arbitrary pick — the
    // first tag must be a capability tag (never a `ctx:*` / `floor:*` tag),
    // so grouping is deterministic. See `.claude/rules/content-authoring.md`
    // item 12 (Tag ordering — primary classification first).
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
      } else if (admitsUnconditionally(item)) {
        // D16-2 (Cycle 11): mark every unconditionally-admitted item
        // (`protected` OR any `floor:*` tag) with the floor affordance — not
        // only `protected`/legacy-`core`. ~40+ floor-tagged-unprotected items
        // previously rendered as plain unchecked rows, hiding the
        // universal-floor invariant from the picker. The selection layer still
        // ships these in non-`custom` presets regardless of the checkbox; this
        // affordance surfaces that at the row in the `custom` picker.
        description = "Floor — admitted in every non-custom preset; recommend keeping selected.";
      }
      groupedChoices.push({
        name: `${item.type}: ${item.id.replace(/^(cmd-)?hatch3r-/, "")} — ${item.description.slice(0, 60)}`,
        value: item.id,
        // Pre-check floor / protected items so the default selection reflects
        // the universal-floor invariant (D16-2). The caller's `isChecked`
        // still governs non-floor items.
        checked: isChecked(item) || admitsUnconditionally(item),
        ...(description ? { description } : {}),
      });
    }
  }
  return groupedChoices;
}
