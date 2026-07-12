import inquirer from "inquirer";
import { ORCHESTRATION_REQUIRED_AGENTS, type CatalogItem } from "../../content/index.js";
import { admitsUnconditionally } from "../../content/tags.js";

/**
 * Explicit display labels for primary content tags whose header text differs
 * from a mechanical Title-Case of the tag (acronyms like `devops`→"DevOps",
 * re-spellings like `a11y`→"Accessibility" / `customize`→"Customization", and
 * the slash-styled `floor:ui-ux`→"UI/UX Floor"). Tags absent here fall through
 * to {@link humanizeTag}, so this map only needs the special cases and never
 * goes fully stale as the 76-tag registry (2.0.0) grows — D2-SA2.6-06.
 */
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
  "floor:ui-ux": "UI/UX Floor",
  other: "Other",
};

/**
 * Acronyms / stylized tokens that a mechanical first-letter capitalization
 * would mangle, keyed on the lowercased kebab/colon token. Grounded in the live
 * tag registry (`src/content/tags.ts` — `cli`, `ui`, `ux`, `ai` appear as tag
 * tokens; `api` added defensively for future tags). D2-SA2.6-06.
 */
const TAG_ACRONYMS: Record<string, string> = {
  cli: "CLI",
  ui: "UI",
  ux: "UX",
  ai: "AI",
  api: "API",
};

/**
 * Title-Case a primary tag into a picker group header when it has no explicit
 * {@link CONTENT_TAG_LABELS} entry. Strips a `floor:` / `ctx:` facet prefix
 * (appending " Floor" for the former, so `floor:security`→"Security Floor"),
 * splits the remainder on `-`, `_`, `:`, and upper-cases each token (acronyms
 * via {@link TAG_ACRONYMS}). This is the future-proof fallback that keeps every
 * realized group header consistent instead of leaking raw kebab/facet syntax
 * like "── floor:security (5) ──" or "── cli-tools (6) ──" (D2-SA2.6-06). The
 * picker's own authoring contract says a `floor:*`/`ctx:*` facet must never
 * lead a header, so this humanizes it rather than printing it verbatim.
 */
export function humanizeTag(tag: string): string {
  let base = tag;
  let suffix = "";
  if (base.startsWith("floor:")) {
    base = base.slice("floor:".length);
    suffix = " Floor";
  } else if (base.startsWith("ctx:")) {
    base = base.slice("ctx:".length);
  }
  const titled = base
    .split(/[-_:]/)
    .filter((token) => token.length > 0)
    .map((token) => TAG_ACRONYMS[token] ?? token.charAt(0).toUpperCase() + token.slice(1))
    .join(" ");
  // Fall back to the raw tag only if humanization produced nothing (empty tag).
  return (titled + suffix).trim() || tag;
}

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
    // D2-SA2.6-06: explicit label when one exists, else Title-Case the tag via
    // `humanizeTag` — never render a raw kebab/facet header (e.g. "floor:security").
    groupedChoices.push(
      new inquirer.Separator(`── ${CONTENT_TAG_LABELS[tag] ?? humanizeTag(tag)} (${groupItems.length}) ──`),
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
