import inquirer from "inquirer";
import { ORCHESTRATION_REQUIRED_AGENTS, type CatalogItem } from "../../content/index.js";
import { admitsUnconditionally } from "../../content/tags.js";

/** Display labels for primary content tags (custom profile checkbox groups). */
const CONTENT_TAG_LABELS: Record<string, string> = {
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
  | {
      name: string;
      value: string;
      checked: boolean;
      description?: string;
      // D10-13: a string makes the row non-toggleable in @inquirer/checkbox and
      // renders as a dimmed suffix (the floor lock label). Omitted on optional rows.
      disabled?: string;
    };

/**
 * Build inquirer checkbox choices grouped by each item's primary tag (init/config custom preset).
 *
 * D10-M18 (Cycle 10 rollover): each item carries an optional `description`
 * field that names its orchestration role inline. Items in the 4-phase
 * pipeline allowlist (`ORCHESTRATION_REQUIRED_AGENTS`) render
 * `Required by the 4-phase pipeline (research → implement → review →
 * quality). Deselecting will trip a validateOrchestrationDependencies
 * warning.` so a user deselecting them sees the chain consequence at the
 * row, not only in the post-submission warning loop.
 *
 * D10-13 (Cycle 11): floor items (`admitsUnconditionally` — `protected` OR
 * any `floor:*` tag) render checked AND `disabled: "Floor — always included"`.
 * `@inquirer/checkbox` paints a disabled+checked row with the `disabledChecked`
 * glyph and a dimmed label suffix, and rejects the toggle keypress
 * (`disabledError`), so the row is non-removable. This matches the selection
 * layer: `resolveSelection` Stage 1 re-admits every `protected`/`floor:*` item
 * for `custom` regardless of the checkbox, so a user who deselected everything
 * else still ships them. Before this fix the picker keyed the floor affordance
 * on the retired `core` tag (only 6 of 69 floor items were `protected`), so 63
 * floor rows rendered as plain unchecked/removable, hiding the invariant.
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
      // D10-13 (Cycle 11): floor items (`protected` OR any `floor:*` tag) are
      // admitted unconditionally by `resolveSelection` Stage 1 even in the
      // `custom` preset, so the picker must show them as locked-on, not optional.
      const isFloor = admitsUnconditionally(item);
      let description: string | undefined;
      if (
        item.type === "agent" &&
        (ORCHESTRATION_REQUIRED_AGENTS as readonly string[]).includes(item.id)
      ) {
        description =
          "Required by the 4-phase pipeline (research → implement → review → quality). " +
          "Deselecting trips a validateOrchestrationDependencies warning.";
      } else if (isFloor) {
        // Floor rows are rendered checked + disabled below; this hint explains
        // the lock when the row is the active cursor line.
        description = "Floor — admitted in every preset, including custom; cannot be deselected.";
      }
      groupedChoices.push({
        name: `${item.type}: ${item.id.replace(/^(cmd-)?hatch3r-/, "")} — ${item.description.slice(0, 60)}`,
        value: item.id,
        // Pre-check floor / protected items so the default selection reflects
        // the universal-floor invariant (D16-2/D10-13). The caller's `isChecked`
        // still governs non-floor items.
        checked: isChecked(item) || isFloor,
        ...(description ? { description } : {}),
        // D10-13: lock floor rows. A string `disabled` makes the row
        // non-toggleable in @inquirer/checkbox and prints the lock label as a
        // dimmed suffix; the row's value is still emitted because the prompt
        // collects every `checked` item regardless of `disabled`.
        ...(isFloor ? { disabled: "Floor — always included" } : {}),
      });
    }
  }
  return groupedChoices;
}
